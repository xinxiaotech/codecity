import { useMemo } from "react";
import * as THREE from "three";
import type { LayoutRect } from "../types";

const PIXELS_PER_UNIT = 32;
const PAD_EXTRA = 0.15;
const CORNER_RADIUS = 0.35;
const MERGE_BLUR = 8;
const THRESHOLD = 60;

// Earthy palette for folder patches — visually distinct but cohesive
const FOLDER_COLORS = [
  "#c4956a", // warm sand
  "#8a9e6c", // sage green
  "#7a8fb0", // dusty blue
  "#b0846d", // terracotta
  "#9b8bb0", // muted purple
  "#6d9e8f", // teal
  "#b09a6d", // khaki
  "#9e6d6d", // clay red
  "#6d7f9e", // slate blue
  "#8f9e6d", // olive
  "#9e7f6d", // mocha
  "#6d9e9e", // sea green
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getFolderColor(folder: string): string {
  return FOLDER_COLORS[hashStr(folder) % FOLDER_COLORS.length];
}

function getParentFolder(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.substring(0, i) : ".";
}

function parseHex(color: string): [number, number, number] {
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ];
}

interface GroundPatchesProps {
  layouts: LayoutRect[];
}

interface FolderInfo {
  color: string;
  rgb: [number, number, number];
  rects: { x: number; z: number; hw: number; hd: number }[];
  // pixel-space seed points (building centers)
  seeds: { px: number; py: number }[];
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, w: number, h: number, r: number,
) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();
}

/** Build a binary mask for one folder: rounded rects → blur → threshold → hole fill */
function buildFolderMask(
  folder: FolderInfo,
  canvasW: number, canvasH: number,
  cornerPx: number,
  boundsMinX: number, boundsMinZ: number,
): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";

  for (const r of folder.rects) {
    const px = (r.x - boundsMinX) * PIXELS_PER_UNIT;
    const py = (r.z - boundsMinZ) * PIXELS_PER_UNIT;
    const pw = r.hw * 2 * PIXELS_PER_UNIT;
    const ph = r.hd * 2 * PIXELS_PER_UNIT;
    drawRoundedRect(ctx, px, py, pw, ph, cornerPx);
  }

  // Blur to merge nearby sibling files
  ctx.filter = `blur(${MERGE_BLUR}px)`;
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = "none";

  const data = ctx.getImageData(0, 0, canvasW, canvasH).data;
  const totalPx = canvasW * canvasH;

  // Threshold
  const solid = new Uint8Array(totalPx);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > THRESHOLD) solid[i >> 2] = 1;
  }

  // Flood-fill exterior from edges
  const exterior = new Uint8Array(totalPx);
  const queue: number[] = [];
  for (let x = 0; x < canvasW; x++) {
    if (!solid[x]) { exterior[x] = 1; queue.push(x); }
    const b = (canvasH - 1) * canvasW + x;
    if (!solid[b]) { exterior[b] = 1; queue.push(b); }
  }
  for (let y = 1; y < canvasH - 1; y++) {
    const l = y * canvasW;
    const r = l + canvasW - 1;
    if (!solid[l]) { exterior[l] = 1; queue.push(l); }
    if (!solid[r]) { exterior[r] = 1; queue.push(r); }
  }
  while (queue.length > 0) {
    const idx = queue.pop()!;
    const x = idx % canvasW;
    const y = (idx - x) / canvasW;
    if (y > 0 && !solid[idx - canvasW] && !exterior[idx - canvasW]) { exterior[idx - canvasW] = 1; queue.push(idx - canvasW); }
    if (y < canvasH - 1 && !solid[idx + canvasW] && !exterior[idx + canvasW]) { exterior[idx + canvasW] = 1; queue.push(idx + canvasW); }
    if (x > 0 && !solid[idx - 1] && !exterior[idx - 1]) { exterior[idx - 1] = 1; queue.push(idx - 1); }
    if (x < canvasW - 1 && !solid[idx + 1] && !exterior[idx + 1]) { exterior[idx + 1] = 1; queue.push(idx + 1); }
  }

  // Final mask: solid + filled interior holes
  const mask = new Uint8Array(totalPx);
  for (let i = 0; i < totalPx; i++) {
    if (solid[i] || !exterior[i]) mask[i] = 1;
  }
  return mask;
}

export function GroundPatches({ layouts }: GroundPatchesProps) {
  const files = useMemo(() => layouts.filter((r) => !r.isFolder), [layouts]);

  const folders = useMemo(() => {
    const groups = new Map<string, FolderInfo>();
    for (const f of files) {
      const folder = getParentFolder(f.path);
      if (!groups.has(folder)) {
        const color = getFolderColor(folder);
        groups.set(folder, { color, rgb: parseHex(color), rects: [], seeds: [] });
      }
      const g = groups.get(folder)!;
      g.rects.push({
        x: f.x, z: f.z,
        hw: f.width / 2 + PAD_EXTRA,
        hd: f.depth / 2 + PAD_EXTRA,
      });
      // Seeds will be computed in pixel space during texture build
    }
    return Array.from(groups.values());
  }, [files]);

  const bounds = useMemo(() => {
    if (files.length === 0) return { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const f of files) {
      const hw = f.width / 2 + PAD_EXTRA;
      const hd = f.depth / 2 + PAD_EXTRA;
      minX = Math.min(minX, f.x - hw);
      maxX = Math.max(maxX, f.x + hw);
      minZ = Math.min(minZ, f.z - hd);
      maxZ = Math.max(maxZ, f.z + hd);
    }
    const pad = 1;
    return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
  }, [files]);

  const worldW = bounds.maxX - bounds.minX;
  const worldD = bounds.maxZ - bounds.minZ;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;

  // Single composited texture — no overlap possible
  const texture = useMemo(() => {
    const canvasW = Math.ceil(worldW * PIXELS_PER_UNIT);
    const canvasH = Math.ceil(worldD * PIXELS_PER_UNIT);
    if (canvasW <= 0 || canvasH <= 0) return null;
    const cornerPx = CORNER_RADIUS * PIXELS_PER_UNIT;
    const totalPx = canvasW * canvasH;

    // 1. Build per-folder masks and seed points
    const folderMasks: Uint8Array[] = [];
    const folderSeeds: { px: number; py: number }[][] = [];

    for (const f of folders) {
      folderMasks.push(buildFolderMask(f, canvasW, canvasH, cornerPx, bounds.minX, bounds.minZ));
      folderSeeds.push(f.rects.map(r => ({
        px: (r.x - bounds.minX) * PIXELS_PER_UNIT,
        py: (r.z - bounds.minZ) * PIXELS_PER_UNIT,
      })));
    }

    // 2. Assign ownership: each pixel gets at most one folder
    const owner = new Int16Array(totalPx).fill(-1);

    for (let i = 0; i < totalPx; i++) {
      // Collect which folders claim this pixel
      let claimCount = 0;
      let singleClaim = -1;
      for (let fi = 0; fi < folders.length; fi++) {
        if (folderMasks[fi][i]) {
          claimCount++;
          singleClaim = fi;
        }
      }

      if (claimCount === 0) continue;
      if (claimCount === 1) {
        owner[i] = singleClaim;
        continue;
      }

      // Contested: nearest building center wins
      const px = i % canvasW;
      const py = (i - px) / canvasW;
      let bestDist = Infinity;
      let bestFolder = -1;
      for (let fi = 0; fi < folders.length; fi++) {
        if (!folderMasks[fi][i]) continue;
        for (const s of folderSeeds[fi]) {
          const dx = px - s.px;
          const dy = py - s.py;
          const dist = dx * dx + dy * dy;
          if (dist < bestDist) {
            bestDist = dist;
            bestFolder = fi;
          }
        }
      }
      owner[i] = bestFolder;
    }

    // 3. Paint single output canvas
    const outCanvas = document.createElement("canvas");
    outCanvas.width = canvasW;
    outCanvas.height = canvasH;
    const outCtx = outCanvas.getContext("2d")!;
    const outData = outCtx.createImageData(canvasW, canvasH);
    const out = outData.data;

    for (let i = 0; i < totalPx; i++) {
      const fi = owner[i];
      if (fi < 0) continue;
      const [r, g, b] = folders[fi].rgb;
      const j = i << 2;
      out[j] = r;
      out[j + 1] = g;
      out[j + 2] = b;
      out[j + 3] = 140;
    }

    outCtx.putImageData(outData, 0, 0);

    const tex = new THREE.CanvasTexture(outCanvas);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    return tex;
  }, [folders, bounds, worldW, worldD]);

  if (!texture) return null;

  return (
    <mesh position={[centerX, 0.015, centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[worldW, worldD]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

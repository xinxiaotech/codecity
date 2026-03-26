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

interface GroundPatchesProps {
  layouts: LayoutRect[];
}

interface Rect {
  x: number;
  z: number;
  hw: number;
  hd: number;
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

export function GroundPatches({ layouts }: GroundPatchesProps) {
  const files = useMemo(() => layouts.filter((r) => !r.isFolder), [layouts]);

  // Group files by parent folder
  const folderGroups = useMemo(() => {
    const groups = new Map<string, { color: string; rects: Rect[] }>();
    for (const f of files) {
      const folder = getParentFolder(f.path);
      if (!groups.has(folder)) {
        groups.set(folder, { color: getFolderColor(folder), rects: [] });
      }
      groups.get(folder)!.rects.push({
        x: f.x,
        z: f.z,
        hw: f.width / 2 + PAD_EXTRA,
        hd: f.depth / 2 + PAD_EXTRA,
      });
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

  const textures = useMemo(() => {
    const canvasW = Math.ceil(worldW * PIXELS_PER_UNIT);
    const canvasH = Math.ceil(worldD * PIXELS_PER_UNIT);
    if (canvasW <= 0 || canvasH <= 0) return [];
    const cornerPx = CORNER_RADIUS * PIXELS_PER_UNIT;

    return folderGroups.map(({ color, rects }) => {
      const accCanvas = document.createElement("canvas");
      accCanvas.width = canvasW;
      accCanvas.height = canvasH;
      const accCtx = accCanvas.getContext("2d")!;
      accCtx.fillStyle = "#fff";

      for (const r of rects) {
        const px = (r.x - bounds.minX) * PIXELS_PER_UNIT;
        const py = (r.z - bounds.minZ) * PIXELS_PER_UNIT;
        const pw = r.hw * 2 * PIXELS_PER_UNIT;
        const ph = r.hd * 2 * PIXELS_PER_UNIT;
        drawRoundedRect(accCtx, px, py, pw, ph, cornerPx);
      }

      // Blur to merge nearby sibling files, then threshold back to crisp
      accCtx.filter = `blur(${MERGE_BLUR}px)`;
      accCtx.drawImage(accCanvas, 0, 0);
      accCtx.filter = "none";

      const accData = accCtx.getImageData(0, 0, canvasW, canvasH);
      const pixels = accData.data;

      const cr = parseInt(color.slice(1, 3), 16);
      const cg = parseInt(color.slice(3, 5), 16);
      const cb = parseInt(color.slice(5, 7), 16);

      const outCanvas = document.createElement("canvas");
      outCanvas.width = canvasW;
      outCanvas.height = canvasH;
      const outCtx = outCanvas.getContext("2d")!;
      const outData = outCtx.createImageData(canvasW, canvasH);
      const out = outData.data;

      // Build a solid mask from the threshold
      const solid = new Uint8Array(canvasW * canvasH);
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > THRESHOLD) solid[i >> 2] = 1;
      }

      // Flood-fill from edges to mark exterior pixels
      const exterior = new Uint8Array(canvasW * canvasH);
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
        const neighbors = [
          y > 0 ? idx - canvasW : -1,
          y < canvasH - 1 ? idx + canvasW : -1,
          x > 0 ? idx - 1 : -1,
          x < canvasW - 1 ? idx + 1 : -1,
        ];
        for (const n of neighbors) {
          if (n >= 0 && !solid[n] && !exterior[n]) {
            exterior[n] = 1;
            queue.push(n);
          }
        }
      }

      // Fill: solid pixels + interior holes (non-exterior, non-solid)
      for (let i = 0; i < solid.length; i++) {
        if (solid[i] || !exterior[i]) {
          const j = i << 2;
          out[j] = cr;
          out[j + 1] = cg;
          out[j + 2] = cb;
          out[j + 3] = 140;
        }
      }

      outCtx.putImageData(outData, 0, 0);

      const tex = new THREE.CanvasTexture(outCanvas);
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      return { texture: tex, color };
    });
  }, [folderGroups, bounds, worldW, worldD]);

  if (files.length === 0) return null;

  return (
    <group>
      {textures.map(({ texture }, i) => (
        <mesh
          key={i}
          position={[centerX, 0.015, centerZ]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[worldW, worldD]} />
          <meshBasicMaterial
            map={texture}
            transparent
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

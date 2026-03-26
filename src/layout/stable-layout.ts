import type { LayoutRect } from "../types";

const MIN_HEIGHT = 0.3;
const MAX_HEIGHT = 12;

const DOC_EXTS = new Set(["md", "mdx", "txt", "rst"]);
const DATA_EXTS = new Set(["json", "yaml", "yml", "toml", "xml", "env", "csv"]);

function fileHeight(lines: number, ext?: string): number {
  if (lines <= 0) return MIN_HEIGHT;
  if (ext && DOC_EXTS.has(ext)) {
    return Math.min(3, 0.8 + Math.log2(Math.max(1, lines)) * 0.35);
  }
  if (ext && DATA_EXTS.has(ext)) {
    return Math.min(2, 0.5 + Math.log2(Math.max(1, lines)) * 0.15);
  }
  const LINEAR_CAP = 100;
  const LINEAR_SCALE = 0.04;
  if (lines <= LINEAR_CAP) return Math.max(MIN_HEIGHT, lines * LINEAR_SCALE);
  const linearPart = LINEAR_CAP * LINEAR_SCALE;
  const logPart = Math.log2(lines / LINEAR_CAP) * 1.8;
  return Math.min(MAX_HEIGHT, linearPart + logPart);
}

const CLEARANCE = 0.5;
const GRID_CELL = 2.0;

interface Rect { x: number; z: number; halfW: number; halfD: number; }
interface BuildingPlot { path: string; x: number; z: number; w: number; d: number; }

function toCell(v: number): number { return Math.floor(v / GRID_CELL); }
function cellKey(cx: number, cz: number): string { return `${cx},${cz}`; }

class SpatialGrid {
  private grid = new Map<string, Set<string>>();
  private itemCells = new Map<string, string[]>();

  add(id: string, r: Rect) {
    const cells = this.cellsFor(r);
    this.itemCells.set(id, cells);
    for (const k of cells) {
      let s = this.grid.get(k);
      if (!s) { s = new Set(); this.grid.set(k, s); }
      s.add(id);
    }
  }

  remove(id: string) {
    const cells = this.itemCells.get(id);
    if (!cells) return;
    for (const k of cells) {
      const s = this.grid.get(k);
      if (s) { s.delete(id); if (s.size === 0) this.grid.delete(k); }
    }
    this.itemCells.delete(id);
  }

  candidates(r: Rect): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const k of this.cellsFor(r)) {
      const s = this.grid.get(k);
      if (s) for (const id of s) {
        if (!seen.has(id)) { seen.add(id); out.push(id); }
      }
    }
    return out;
  }

  private cellsFor(r: Rect): string[] {
    const keys: string[] = [];
    const x0 = toCell(r.x - r.halfW), x1 = toCell(r.x + r.halfW);
    const z0 = toCell(r.z - r.halfD), z1 = toCell(r.z + r.halfD);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++)
        keys.push(cellKey(cx, cz));
    return keys;
  }
}

/**
 * Simple land-acquisition layout: each building acquires a plot near
 * the city center. No zones, no folder rects. Buildings cluster by
 * top-level folder (same-group buildings target their group centroid).
 */
export class StableLayoutManager {
  private spatial = new SpatialGrid();
  private rects = new Map<string, Rect>();
  private buildings = new Map<string, BuildingPlot>();

  computeLayout(files: Map<string, number>): LayoutRect[] {
    // Release deleted files
    for (const path of this.buildings.keys()) {
      if (!files.has(path)) {
        this.buildings.delete(path);
        this.spatial.remove(path);
        this.rects.delete(path);
      }
    }

    // Place new files
    for (const [path, lines] of files) {
      if (!this.buildings.has(path)) {
        this.placeBuilding(path, lines);
      }
    }

    // Build results — buildings only, no folder rects
    const results: LayoutRect[] = [];
    for (const [path, lines] of files) {
      const bp = this.buildings.get(path)!;
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const folder = getFolderPath(path);
      results.push({
        path,
        x: bp.x, z: bp.z,
        width: bp.w, depth: bp.d,
        height: fileHeight(lines, ext),
        lines,
        isFolder: false,
        extension: ext,
        folderDepth: folder.split("/").filter(Boolean).length,
      });
    }

    return results;
  }

  private placeBuilding(path: string, lines: number) {
    const size = getBuildingSize(path, lines);
    const halfW = (size.width + CLEARANCE) / 2;
    const halfD = (size.depth + CLEARANCE) / 2;

    // Target: centroid of same top-level group, or city center
    const target = this.findTarget(path);
    const pos = this.findFreeSpot(target.x, target.z, halfW, halfD);

    this.buildings.set(path, { path, x: pos.x, z: pos.z, w: size.width, d: size.depth });
    const rect: Rect = { x: pos.x, z: pos.z, halfW, halfD };
    this.rects.set(path, rect);
    this.spatial.add(path, rect);
  }

  private findTarget(filePath: string): { x: number; z: number } {
    const folder = getFolderPath(filePath);

    // 1st priority: centroid of same-folder mates (tightest clustering)
    let sx = 0, sz = 0, n = 0;
    for (const bp of this.buildings.values()) {
      if (getFolderPath(bp.path) === folder) { sx += bp.x; sz += bp.z; n++; }
    }
    if (n > 0) return { x: sx / n, z: sz / n };

    // 2nd priority: centroid of same top-level group
    const group = getTopFolder(filePath);
    sx = 0; sz = 0; n = 0;
    for (const bp of this.buildings.values()) {
      if (getTopFolder(bp.path) === group) { sx += bp.x; sz += bp.z; n++; }
    }
    if (n > 0) return { x: sx / n, z: sz / n };

    // 3rd: NEW folder/group — target the city center.
    // findFreeSpot will spiral outward, naturally landing just outside
    // existing buildings. The gap emerges organically from CLEARANCE.
    if (this.rects.size === 0) return { x: 0, z: 0 };

    let sx2 = 0, sz2 = 0, n2 = 0;
    for (const r of this.rects.values()) { sx2 += r.x; sz2 += r.z; n2++; }
    return { x: sx2 / n2, z: sz2 / n2 };
  }

  private findFreeSpot(
    nearX: number, nearZ: number, halfW: number, halfD: number,
  ): { x: number; z: number } {
    if (!this.overlapsAny(nearX, nearZ, halfW, halfD)) {
      return { x: nearX, z: nearZ };
    }
    const step = CLEARANCE + Math.max(halfW, halfD);
    for (let ring = 1; ring <= 60; ring++) {
      // Collect all candidates on this ring, sort by distance to target
      const candidates: { x: number; z: number; d2: number }[] = [];
      for (let i = -ring; i <= ring; i++) {
        for (let j = -ring; j <= ring; j++) {
          if (Math.abs(i) !== ring && Math.abs(j) !== ring) continue;
          const x = nearX + i * step;
          const z = nearZ + j * step;
          candidates.push({ x, z, d2: i * i + j * j });
        }
      }
      candidates.sort((a, b) => a.d2 - b.d2);
      for (const c of candidates) {
        if (!this.overlapsAny(c.x, c.z, halfW, halfD)) return { x: c.x, z: c.z };
      }
    }
    return { x: nearX, z: nearZ + 100 };
  }

  private overlapsAny(cx: number, cz: number, halfW: number, halfD: number): boolean {
    for (const id of this.spatial.candidates({ x: cx, z: cz, halfW, halfD })) {
      const r = this.rects.get(id)!;
      if (Math.abs(cx - r.x) < halfW + r.halfW && Math.abs(cz - r.z) < halfD + r.halfD)
        return true;
    }
    return false;
  }
}

function getFolderPath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 1) return "__root__";
  return parts.slice(0, -1).join("/");
}

function getTopFolder(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 1) return "__root__";
  return parts[0];
}

function getBuildingSize(filePath: string, lines: number): { width: number; depth: number } {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (DOC_EXTS.has(ext)) {
    const base = 1.0 + Math.sqrt(Math.min(lines, 3000)) * 0.03;
    const side = Math.min(3.5, Math.max(1.0, base));
    return { width: side, depth: side * 0.85 };
  }
  if (DATA_EXTS.has(ext)) {
    const base = 0.6 + Math.sqrt(Math.min(lines, 5000)) * 0.01;
    const side = Math.min(1.5, Math.max(0.5, base));
    return { width: side, depth: side };
  }
  const base = 0.8 + Math.sqrt(Math.max(1, lines)) * 0.08;
  const width = Math.min(3, Math.max(0.6, base));
  const depth = Math.min(2.5, Math.max(0.5, base * 0.8));
  return { width, depth };
}

import type { LayoutRect } from "../types";

const MIN_HEIGHT = 0.3;
const MAX_HEIGHT = 12; // cap so no building dominates the scene

const DOC_EXTS = new Set(["md", "mdx", "txt", "rst"]);
const DATA_EXTS = new Set(["json", "yaml", "yml", "toml", "xml", "env", "csv"]);

/** Log-scaled height: linear up to ~100 lines, then logarithmic */
function fileHeight(lines: number, ext?: string): number {
  if (lines <= 0) return MIN_HEIGHT;

  // Docs (md/txt) — low, wide library buildings (cap at 3)
  if (ext && DOC_EXTS.has(ext)) {
    const h = 0.8 + Math.log2(Math.max(1, lines)) * 0.35;
    return Math.min(3, h);
  }

  // Data files (json/yaml) — height doesn't matter (rendered as trees),
  // but keep a small value for layout purposes
  if (ext && DATA_EXTS.has(ext)) {
    return Math.min(2, 0.5 + Math.log2(Math.max(1, lines)) * 0.15);
  }

  // Source code — normal log scaling
  const LINEAR_CAP = 100;
  const LINEAR_SCALE = 0.04;
  if (lines <= LINEAR_CAP) {
    return Math.max(MIN_HEIGHT, lines * LINEAR_SCALE);
  }
  const linearPart = LINEAR_CAP * LINEAR_SCALE;
  const logPart = Math.log2(lines / LINEAR_CAP) * 1.8;
  return Math.min(MAX_HEIGHT, linearPart + logPart);
}

const CLEARANCE = 0.6; // minimum gap enforced between any two buildings
const FOLDER_PAD = 0.4; // extra padding around folder ground planes
const GRID_CELL = 2.0; // coarse spatial grid cell size
const MAX_EVENTS = 10_000; // cap on the events history array

interface Plot {
  path: string;
  x: number; // center X in world
  z: number; // center Z in world
  lotW: number; // half-width of reserved land (building + clearance)
  lotD: number; // half-depth of reserved land
  buildingW: number;
  buildingD: number;
}

interface LayoutEvent {
  type: "acquire" | "release";
  path: string;
  x: number;
  z: number;
  timestamp: number;
}

/** Convert world coordinate to grid key component */
function toCell(v: number): number {
  return Math.floor(v / GRID_CELL);
}

/** Produce a string key for a grid cell */
function cellKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/**
 * Land-acquisition layout: every building individually acquires a plot of
 * land nearby its folder-mates.  The plot is exclusively reserved until
 * the file is deleted, at which point the land is released and can be
 * reused by future files.
 */
export class StableLayoutManager {
  private plots = new Map<string, Plot>();

  // --- Spatial grid index (optimization 1) ---
  // Maps cell key -> set of plot paths occupying that cell
  private grid = new Map<string, Set<string>>();
  // Maps plot path -> list of cell keys it occupies
  private plotCells = new Map<string, string[]>();

  // --- Folder index (optimization 2) ---
  // Maps folder path -> array of plots in that folder
  private folderIndex = new Map<string, Plot[]>();

  // --- Incremental frontier tracking (optimization 3) ---
  private cityMaxZ = -Infinity;

  // --- Capped events array (optimization 4) ---
  private events: LayoutEvent[] = [];

  computeLayout(files: Map<string, number>): LayoutRect[] {
    // Release land for deleted files
    for (const path of this.plots.keys()) {
      if (!files.has(path)) this.releasePlot(path);
    }

    // Acquire land for new files
    for (const [filePath, lines] of files) {
      if (!this.plots.has(filePath)) {
        this.acquirePlot(filePath, lines);
      }
    }

    // Build layout results
    const results: LayoutRect[] = [];

    for (const [filePath, lines] of files) {
      const plot = this.plots.get(filePath)!;
      const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
      const folder = getFolderPath(filePath);
      results.push({
        path: filePath,
        x: plot.x,
        z: plot.z,
        width: plot.buildingW,
        depth: plot.buildingD,
        height: fileHeight(lines, ext),
        lines,
        isFolder: false,
        extension: ext,
        folderDepth: folder.split("/").filter(Boolean).length,
      });
    }

    // Folder ground planes — use the folder index directly
    for (const [folder, plots] of this.folderIndex) {
      if (plots.length === 0) continue;
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (const p of plots) {
        minX = Math.min(minX, p.x - p.buildingW / 2);
        maxX = Math.max(maxX, p.x + p.buildingW / 2);
        minZ = Math.min(minZ, p.z - p.buildingD / 2);
        maxZ = Math.max(maxZ, p.z + p.buildingD / 2);
      }
      results.push({
        path: folder,
        x: (minX + maxX) / 2,
        z: (minZ + maxZ) / 2,
        width: maxX - minX + FOLDER_PAD * 2,
        depth: maxZ - minZ + FOLDER_PAD * 2,
        height: 0,
        lines: 0,
        isFolder: true,
        extension: "",
        folderDepth: folder.split("/").filter(Boolean).length,
      });
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Land acquisition & release
  // ---------------------------------------------------------------------------

  private acquirePlot(filePath: string, lines: number) {
    const size = getBuildingSize(filePath, lines);
    const lotW = (size.width + CLEARANCE) / 2;
    const lotD = (size.depth + CLEARANCE) / 2;

    // Pick a target location: near folder-mates, or at the city frontier
    const target = this.findTarget(filePath, lotW, lotD);

    // Search outward from target for the nearest free spot
    const pos = this.findFreeSpot(target.x, target.z, lotW, lotD);

    const plot: Plot = {
      path: filePath,
      x: pos.x,
      z: pos.z,
      lotW,
      lotD,
      buildingW: size.width,
      buildingD: size.depth,
    };

    this.plots.set(filePath, plot);

    // Update spatial grid
    this.addToGrid(plot);

    // Update folder index
    const folder = getFolderPath(filePath);
    let list = this.folderIndex.get(folder);
    if (!list) {
      list = [];
      this.folderIndex.set(folder, list);
    }
    list.push(plot);

    // Update incremental frontier
    const plotMaxZ = pos.z + lotD;
    if (plotMaxZ > this.cityMaxZ) {
      this.cityMaxZ = plotMaxZ;
    }

    // Record event (capped)
    this.pushEvent({ type: "acquire", path: filePath, x: pos.x, z: pos.z, timestamp: Date.now() });
  }

  private releasePlot(path: string) {
    const plot = this.plots.get(path);
    if (!plot) return;

    // Remove from spatial grid
    this.removeFromGrid(path);

    // Remove from folder index
    const folder = getFolderPath(path);
    const list = this.folderIndex.get(folder);
    if (list) {
      const idx = list.indexOf(plot);
      if (idx !== -1) list.splice(idx, 1);
      if (list.length === 0) this.folderIndex.delete(folder);
    }

    this.plots.delete(path);

    // Recompute cityMaxZ if the removed plot was at the frontier
    const removedMaxZ = plot.z + plot.lotD;
    if (removedMaxZ >= this.cityMaxZ) {
      this.recomputeCityMaxZ();
    }

    // Record event (capped)
    this.pushEvent({ type: "release", path, x: plot.x, z: plot.z, timestamp: Date.now() });
  }

  // ---------------------------------------------------------------------------
  // Spatial grid helpers
  // ---------------------------------------------------------------------------

  /** Compute which grid cells a plot occupies and register them */
  private addToGrid(plot: Plot) {
    const cells = this.getCellsForPlot(plot);
    this.plotCells.set(plot.path, cells);
    for (const key of cells) {
      let set = this.grid.get(key);
      if (!set) {
        set = new Set();
        this.grid.set(key, set);
      }
      set.add(plot.path);
    }
  }

  /** Remove a plot from the grid */
  private removeFromGrid(path: string) {
    const cells = this.plotCells.get(path);
    if (!cells) return;
    for (const key of cells) {
      const set = this.grid.get(key);
      if (set) {
        set.delete(path);
        if (set.size === 0) this.grid.delete(key);
      }
    }
    this.plotCells.delete(path);
  }

  /** Return all grid cell keys that a plot's AABB covers */
  private getCellsForPlot(plot: Plot): string[] {
    const minCX = toCell(plot.x - plot.lotW);
    const maxCX = toCell(plot.x + plot.lotW);
    const minCZ = toCell(plot.z - plot.lotD);
    const maxCZ = toCell(plot.z + plot.lotD);
    const keys: string[] = [];
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        keys.push(cellKey(cx, cz));
      }
    }
    return keys;
  }

  /** Return all grid cell keys that a candidate AABB covers */
  private getCellsForAABB(cx: number, cz: number, lotW: number, lotD: number): string[] {
    const minCX = toCell(cx - lotW);
    const maxCX = toCell(cx + lotW);
    const minCZ = toCell(cz - lotD);
    const maxCZ = toCell(cz + lotD);
    const keys: string[] = [];
    for (let gx = minCX; gx <= maxCX; gx++) {
      for (let gz = minCZ; gz <= maxCZ; gz++) {
        keys.push(cellKey(gx, gz));
      }
    }
    return keys;
  }

  // ---------------------------------------------------------------------------
  // Target finding & overlap detection
  // ---------------------------------------------------------------------------

  /**
   * Find a good target position for a new file:
   *  - If the folder already has buildings, aim for the spot just to the
   *    right of the rightmost one (extends the neighborhood naturally).
   *  - Otherwise, aim for the frontier of the city.
   */
  private findTarget(
    filePath: string,
    lotW: number,
    lotD: number,
  ): { x: number; z: number } {
    const folder = getFolderPath(filePath);

    // Use folder index instead of scanning all plots
    const mates = this.folderIndex.get(folder);
    if (mates && mates.length > 0) {
      // Find the rightmost building in the same folder
      let rightmost = mates[0];
      for (let i = 1; i < mates.length; i++) {
        const m = mates[i];
        if (m.x + m.lotW > rightmost.x + rightmost.lotW) {
          rightmost = m;
        }
      }
      return {
        x: rightmost.x + rightmost.lotW + lotW,
        z: rightmost.z,
      };
    }

    // New folder — place at the city frontier
    return this.getCityFrontier(lotW, lotD);
  }

  /**
   * Find a spot at the edge of the current city so new folders
   * don't land on top of existing ones.
   * Uses incrementally tracked cityMaxZ instead of scanning all plots.
   */
  private getCityFrontier(lotW: number, lotD: number): { x: number; z: number } {
    if (this.plots.size === 0) return { x: 0, z: 0 };
    return { x: lotW, z: this.cityMaxZ + lotD + CLEARANCE * 2 };
  }

  /** Recompute cityMaxZ from scratch (only called when a frontier plot is removed) */
  private recomputeCityMaxZ() {
    let maxZ = -Infinity;
    for (const p of this.plots.values()) {
      const pz = p.z + p.lotD;
      if (pz > maxZ) maxZ = pz;
    }
    this.cityMaxZ = maxZ;
  }

  /**
   * Starting from (nearX, nearZ), search outward in an expanding grid
   * for the nearest position where the lot doesn't overlap any existing plot.
   */
  private findFreeSpot(
    nearX: number,
    nearZ: number,
    lotW: number,
    lotD: number,
  ): { x: number; z: number } {
    // Try the exact target first
    if (!this.overlapsAny(nearX, nearZ, lotW, lotD)) {
      return { x: nearX, z: nearZ };
    }

    // Expand in rings — step size matches the lot so the grid packs tightly
    const stepX = lotW * 2;
    const stepZ = lotD * 2;

    for (let ring = 1; ring <= 50; ring++) {
      // Walk the perimeter of the ring
      for (let i = -ring; i <= ring; i++) {
        for (let j = -ring; j <= ring; j++) {
          if (Math.abs(i) !== ring && Math.abs(j) !== ring) continue;
          const x = nearX + i * stepX;
          const z = nearZ + j * stepZ;
          if (!this.overlapsAny(x, z, lotW, lotD)) {
            return { x, z };
          }
        }
      }
    }

    // Fallback (should never happen with 50 rings)
    return { x: nearX, z: nearZ + 100 };
  }

  /**
   * AABB overlap test using the spatial grid index.
   * Only checks candidates from overlapping grid cells instead of all plots.
   */
  private overlapsAny(cx: number, cz: number, lotW: number, lotD: number): boolean {
    // Collect unique candidate paths from the grid cells this AABB covers
    const cellKeys = this.getCellsForAABB(cx, cz, lotW, lotD);
    const checked = new Set<string>();

    for (const key of cellKeys) {
      const set = this.grid.get(key);
      if (!set) continue;
      for (const path of set) {
        if (checked.has(path)) continue;
        checked.add(path);
        const p = this.plots.get(path)!;
        if (
          Math.abs(cx - p.x) < lotW + p.lotW &&
          Math.abs(cz - p.z) < lotD + p.lotD
        ) {
          return true;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Capped events log
  // ---------------------------------------------------------------------------

  private pushEvent(event: LayoutEvent) {
    if (this.events.length >= MAX_EVENTS) {
      // Drop the oldest half to avoid repeated shifting
      this.events = this.events.slice(MAX_EVENTS >> 1);
    }
    this.events.push(event);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFolderPath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 1) return "__root__";
  return parts.slice(0, -1).join("/");
}

function getFileExt(filePath: string): string {
  return filePath.split(".").pop()?.toLowerCase() ?? "";
}

function getBuildingSize(filePath: string, lines: number): { width: number; depth: number } {
  const ext = getFileExt(filePath);

  if (DOC_EXTS.has(ext)) {
    // Libraries/museums: wide and square footprint, scales gently with size
    const base = 1.0 + Math.sqrt(Math.min(lines, 3000)) * 0.03;
    const side = Math.min(3.5, Math.max(1.0, base));
    return { width: side, depth: side * 0.85 };
  }

  if (DATA_EXTS.has(ext)) {
    // Trees: compact footprint, just enough for the trunk
    const base = 0.6 + Math.sqrt(Math.min(lines, 5000)) * 0.01;
    const side = Math.min(1.5, Math.max(0.5, base));
    return { width: side, depth: side };
  }

  // Source code: default
  const base = 0.8 + Math.sqrt(Math.max(1, lines)) * 0.08;
  const width = Math.min(3, Math.max(0.6, base));
  const depth = Math.min(2.5, Math.max(0.5, base * 0.8));
  return { width, depth };
}

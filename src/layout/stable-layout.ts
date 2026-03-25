import type { LayoutRect } from "../types";

const HEIGHT_SCALE = 0.04;
const MIN_HEIGHT = 0.3;
const BUILDING_GAP = 0.7;
const BLOCK_PADDING = 0.6;
const BLOCK_GAP = 1.2; // road width between blocks

interface PlacedBuilding {
  path: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

interface FolderBlock {
  folderPath: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  buildings: PlacedBuilding[];
  nextX: number; // cursor for placing next building in this block
  nextZ: number;
  rowHeight: number; // tallest depth in current row
}

/**
 * Stable layout manager - buildings keep their positions.
 * New files get placed in available space. Edits only change height.
 * Deleted files free their spot for future use.
 */
export class StableLayoutManager {
  private placements = new Map<string, PlacedBuilding>();
  private folderBlocks = new Map<string, FolderBlock>();
  private freedSpots: PlacedBuilding[] = [];
  private nextBlockX = 0;
  private nextBlockZ = 0;
  private blockRowMaxDepth = 0;
  private blocksInRow = 0;
  private readonly maxBlocksPerRow = 4;

  /**
   * Update layout with current file state.
   * Returns stable LayoutRect[] - positions don't change for existing files.
   */
  computeLayout(files: Map<string, number>): LayoutRect[] {
    const results: LayoutRect[] = [];

    // Find removed files and free their spots
    for (const [path, placement] of this.placements) {
      if (!files.has(path)) {
        this.freedSpots.push(placement);
        this.placements.delete(path);
      }
    }

    // Process all current files
    for (const [filePath, lines] of files) {
      const existing = this.placements.get(filePath);
      if (existing) {
        // File still exists - keep position, just update height
        const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
        const folderPath = this.getFolderPath(filePath);
        const block = this.folderBlocks.get(folderPath);
        results.push({
          path: filePath,
          x: existing.x,
          z: existing.z,
          width: existing.width,
          depth: existing.depth,
          height: Math.max(MIN_HEIGHT, lines * HEIGHT_SCALE),
          isFolder: false,
          extension: ext,
          folderDepth: folderPath.split("/").filter(Boolean).length,
        });
      } else {
        // New file - find a spot
        const placement = this.placeNewFile(filePath, lines);
        this.placements.set(filePath, placement);
        const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
        const folderPath = this.getFolderPath(filePath);
        results.push({
          path: filePath,
          x: placement.x,
          z: placement.z,
          width: placement.width,
          depth: placement.depth,
          height: Math.max(MIN_HEIGHT, lines * HEIGHT_SCALE),
          isFolder: false,
          extension: ext,
          folderDepth: folderPath.split("/").filter(Boolean).length,
        });
      }
    }

    // Add folder block ground planes
    for (const [folderPath, block] of this.folderBlocks) {
      // Recompute block bounds based on actual buildings inside it
      const blockBuildings = Array.from(this.placements.values()).filter(
        (p) => this.getFolderPath(p.path) === folderPath
      );
      if (blockBuildings.length === 0) continue;

      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const b of blockBuildings) {
        minX = Math.min(minX, b.x - b.width / 2);
        maxX = Math.max(maxX, b.x + b.width / 2);
        minZ = Math.min(minZ, b.z - b.depth / 2);
        maxZ = Math.max(maxZ, b.z + b.depth / 2);
      }

      const pad = 0.3;
      const depth = folderPath.split("/").filter(Boolean).length;
      results.push({
        path: folderPath,
        x: (minX + maxX) / 2,
        z: (minZ + maxZ) / 2,
        width: maxX - minX + pad * 2,
        depth: maxZ - minZ + pad * 2,
        height: 0,
        isFolder: true,
        extension: "",
        folderDepth: depth,
      });
    }

    return results;
  }

  private getFolderPath(filePath: string): string {
    const parts = filePath.split("/");
    if (parts.length <= 1) return "__root__";
    return parts.slice(0, -1).join("/");
  }

  private getBuildingSize(lines: number): { width: number; depth: number } {
    // Building footprint scales with sqrt of lines for variety
    const base = 0.8 + Math.sqrt(Math.max(1, lines)) * 0.08;
    const width = Math.min(3, Math.max(0.6, base));
    const depth = Math.min(2.5, Math.max(0.5, base * 0.8));
    return { width, depth };
  }

  private placeNewFile(filePath: string, lines: number): PlacedBuilding {
    const size = this.getBuildingSize(lines);
    const folderPath = this.getFolderPath(filePath);

    // Try to reuse a freed spot first (in same folder preferably)
    const freedIdx = this.freedSpots.findIndex(
      (s) => this.getFolderPath(s.path) === folderPath &&
        s.width >= size.width * 0.7 && s.depth >= size.depth * 0.7
    );
    if (freedIdx >= 0) {
      const spot = this.freedSpots.splice(freedIdx, 1)[0];
      return {
        path: filePath,
        x: spot.x,
        z: spot.z,
        width: size.width,
        depth: size.depth,
      };
    }

    // Get or create folder block
    let block = this.folderBlocks.get(folderPath);
    if (!block) {
      block = this.createBlock(folderPath);
      this.folderBlocks.set(folderPath, block);
    }

    // Place within the block using row-based packing
    const bw = size.width + BUILDING_GAP;
    const bd = size.depth + BUILDING_GAP;

    // Check if fits in current row
    if (block.nextX + bw > block.width - BLOCK_PADDING) {
      // Start new row
      block.nextX = BLOCK_PADDING;
      block.nextZ += block.rowHeight + BUILDING_GAP;
      block.rowHeight = bd;

      // Expand block if needed
      if (block.nextZ + bd > block.depth - BLOCK_PADDING) {
        block.depth = block.nextZ + bd + BLOCK_PADDING;
      }
    }

    block.rowHeight = Math.max(block.rowHeight, bd);

    const placement: PlacedBuilding = {
      path: filePath,
      x: block.x - block.width / 2 + block.nextX + size.width / 2,
      z: block.z - block.depth / 2 + block.nextZ + size.depth / 2,
      width: size.width,
      depth: size.depth,
    };

    block.nextX += bw;
    block.buildings.push(placement);

    return placement;
  }

  private createBlock(folderPath: string): FolderBlock {
    const initialWidth = 8;
    const initialDepth = 6;

    // Place block in a grid
    const x = this.nextBlockX + initialWidth / 2;
    const z = this.nextBlockZ + initialDepth / 2;

    this.blocksInRow++;
    this.blockRowMaxDepth = Math.max(this.blockRowMaxDepth, initialDepth);

    if (this.blocksInRow >= this.maxBlocksPerRow) {
      this.nextBlockX = 0;
      this.nextBlockZ += this.blockRowMaxDepth + BLOCK_GAP;
      this.blockRowMaxDepth = 0;
      this.blocksInRow = 0;
    } else {
      this.nextBlockX += initialWidth + BLOCK_GAP;
    }

    return {
      folderPath,
      x,
      z,
      width: initialWidth,
      depth: initialDepth,
      buildings: [],
      nextX: BLOCK_PADDING,
      nextZ: BLOCK_PADDING,
      rowHeight: 0,
    };
  }
}

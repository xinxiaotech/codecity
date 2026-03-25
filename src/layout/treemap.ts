import type { TreeNode, LayoutRect } from "../types";
import { totalLines } from "../utils/tree";

interface Rect {
  x: number;
  z: number;
  width: number;
  depth: number;
}

const HEIGHT_SCALE = 0.04;
const MIN_HEIGHT = 0.3;
const PADDING = 0.15;

export function computeLayout(
  root: TreeNode,
  bounds: Rect = { x: 0, z: 0, width: 40, depth: 40 }
): LayoutRect[] {
  const results: LayoutRect[] = [];
  layoutNode(root, bounds, 0, results);
  return results;
}

function layoutNode(
  node: TreeNode,
  bounds: Rect,
  depth: number,
  results: LayoutRect[]
): void {
  if (!node.children || node.children.length === 0) return;

  // Add folder ground plane (skip root)
  if (depth > 0) {
    results.push({
      path: node.path,
      x: bounds.x,
      z: bounds.z,
      width: bounds.width,
      depth: bounds.depth,
      height: 0,
      isFolder: true,
      extension: "",
      folderDepth: depth,
    });
  }

  // Inset bounds for padding
  const padded: Rect = {
    x: bounds.x,
    z: bounds.z,
    width: Math.max(0.1, bounds.width - PADDING * 2),
    depth: Math.max(0.1, bounds.depth - PADDING * 2),
  };

  // Sort children alphabetically for stability
  const sorted = [...node.children].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // Filter out empty nodes
  const children = sorted.filter(
    (c) => c.lines !== undefined || totalLines(c) > 0
  );
  if (children.length === 0) return;

  const totalArea = padded.width * padded.depth;
  const totalWeight = children.reduce(
    (sum, c) => sum + Math.max(1, totalLines(c)),
    0
  );

  // Squarified treemap
  const rects = squarify(
    children.map((c) => ({
      node: c,
      weight: Math.max(1, totalLines(c)),
    })),
    padded,
    totalArea,
    totalWeight
  );

  for (const { node: child, rect } of rects) {
    if (child.lines !== undefined) {
      // Leaf node → building
      const ext = child.name.split(".").pop()?.toLowerCase() ?? "";
      results.push({
        path: child.path,
        x: rect.x,
        z: rect.z,
        width: rect.width * 0.9,
        depth: rect.depth * 0.9,
        height: Math.max(MIN_HEIGHT, child.lines * HEIGHT_SCALE),
        isFolder: false,
        extension: ext,
        folderDepth: depth + 1,
      });
    } else {
      // Folder → recurse
      layoutNode(child, rect, depth + 1, results);
    }
  }
}

interface WeightedNode {
  node: TreeNode;
  weight: number;
}

interface PlacedNode {
  node: TreeNode;
  rect: Rect;
}

function squarify(
  items: WeightedNode[],
  bounds: Rect,
  totalArea: number,
  totalWeight: number
): PlacedNode[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    return [{ node: items[0].node, rect: bounds }];
  }

  const results: PlacedNode[] = [];
  let remaining = [...items];
  let currentBounds = { ...bounds };

  while (remaining.length > 0) {
    const isHorizontal = currentBounds.width >= currentBounds.depth;
    const side = isHorizontal ? currentBounds.depth : currentBounds.width;

    // Greedy row building
    const row: WeightedNode[] = [remaining[0]];
    remaining = remaining.slice(1);

    let rowWeight = row[0].weight;

    while (remaining.length > 0) {
      const nextWeight = rowWeight + remaining[0].weight;
      if (
        worstRatio(row, rowWeight, side, totalArea, totalWeight) >=
        worstRatio(
          [...row, remaining[0]],
          nextWeight,
          side,
          totalArea,
          totalWeight
        )
      ) {
        row.push(remaining[0]);
        rowWeight = nextWeight;
        remaining = remaining.slice(1);
      } else {
        break;
      }
    }

    // Layout the row
    const rowArea = (rowWeight / totalWeight) * totalArea;
    const rowThickness = rowArea / side;

    let offset = 0;
    for (const item of row) {
      const itemFraction = item.weight / rowWeight;
      const itemLength = side * itemFraction;

      let rect: Rect;
      if (isHorizontal) {
        rect = {
          x: currentBounds.x + rowThickness / 2 - currentBounds.width / 2,
          z: currentBounds.z + offset + itemLength / 2 - currentBounds.depth / 2,
          width: rowThickness,
          depth: itemLength,
        };
      } else {
        rect = {
          x: currentBounds.x + offset + itemLength / 2 - currentBounds.width / 2,
          z: currentBounds.z + rowThickness / 2 - currentBounds.depth / 2,
          width: itemLength,
          depth: rowThickness,
        };
      }

      results.push({ node: item.node, rect });
      offset += itemLength;
    }

    // Shrink bounds
    if (isHorizontal) {
      currentBounds = {
        x: currentBounds.x + rowThickness,
        z: currentBounds.z,
        width: currentBounds.width - rowThickness,
        depth: currentBounds.depth,
      };
    } else {
      currentBounds = {
        x: currentBounds.x,
        z: currentBounds.z + rowThickness,
        width: currentBounds.width,
        depth: currentBounds.depth - rowThickness,
      };
    }
  }

  return results;
}

function worstRatio(
  row: WeightedNode[],
  rowWeight: number,
  side: number,
  totalArea: number,
  totalWeight: number
): number {
  const rowArea = (rowWeight / totalWeight) * totalArea;
  const rowWidth = rowArea / side;

  let worst = 0;
  for (const item of row) {
    const itemArea = (item.weight / totalWeight) * totalArea;
    const itemLength = itemArea / rowWidth;
    const ratio = Math.max(rowWidth / itemLength, itemLength / rowWidth);
    worst = Math.max(worst, ratio);
  }
  return worst;
}

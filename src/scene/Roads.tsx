import { useMemo } from "react";
import * as THREE from "three";
import type { LayoutRect } from "../types";
import type { DepEdge } from "../hooks/useCityData";

interface RoadsProps {
  layouts: LayoutRect[];
  deps: DepEdge[];
  highlightedPaths?: Set<string>;
}

// Grid resolution for snapping route waypoints
const GRID = 0.4;
const ROAD_Y = 0.03;

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

// Unique key for a segment (order-independent)
function segKey(ax: number, az: number, bx: number, bz: number): string {
  if (ax < bx || (ax === bx && az < bz)) return `${ax},${az}|${bx},${bz}`;
  return `${bx},${bz}|${ax},${az}`;
}

/**
 * PCB-style Manhattan router.
 *
 * Strategy:
 * - Each route is strictly horizontal + vertical segments
 * - Routes use a "channel" between source and target:
 *   source → horizontal to shared X channel → vertical to target Z → horizontal to target
 * - Overlapping segments merge into wider, brighter shared trunks
 * - Channel X is chosen from a set of grid-snapped corridors spaced between buildings
 */
export function Roads({ layouts, deps, highlightedPaths }: RoadsProps) {
  const mergedSegments = useMemo(() => {
    // Build position lookup (files only)
    const posMap = new Map<string, { x: number; z: number }>();
    for (const l of layouts) {
      if (!l.isFolder) {
        posMap.set(l.path, { x: l.x, z: l.z });
      }
    }

    if (deps.length === 0) return [];

    // Collect all snapped building positions to define corridor grid
    const allX = new Set<number>();
    const allZ = new Set<number>();
    for (const pos of posMap.values()) {
      allX.add(snap(pos.x));
      allZ.add(snap(pos.z));
    }

    // Build corridor positions: midpoints between adjacent snapped coords
    const sortedX = [...allX].sort((a, b) => a - b);
    const sortedZ = [...allZ].sort((a, b) => a - b);
    const corridorX: number[] = [];
    const corridorZ: number[] = [];
    for (let i = 0; i < sortedX.length - 1; i++) {
      corridorX.push(snap((sortedX[i] + sortedX[i + 1]) / 2));
    }
    for (let i = 0; i < sortedZ.length - 1; i++) {
      corridorZ.push(snap((sortedZ[i] + sortedZ[i + 1]) / 2));
    }
    // Add edges as corridors too
    if (sortedX.length > 0) {
      corridorX.unshift(snap(sortedX[0] - GRID * 2));
      corridorX.push(snap(sortedX[sortedX.length - 1] + GRID * 2));
    }
    if (sortedZ.length > 0) {
      corridorZ.unshift(snap(sortedZ[0] - GRID * 2));
      corridorZ.push(snap(sortedZ[sortedZ.length - 1] + GRID * 2));
    }

    function nearestCorridor(arr: number[], v: number): number {
      let best = arr[0] ?? v;
      let bestD = Math.abs(v - best);
      for (const c of arr) {
        const d = Math.abs(v - c);
        if (d < bestD) { best = c; bestD = d; }
      }
      return best;
    }

    // Route each edge and collect segments
    const segCounts = new Map<string, { x1: number; z1: number; x2: number; z2: number; count: number; highlighted: boolean }>();

    function addSeg(x1: number, z1: number, x2: number, z2: number, highlighted: boolean) {
      // Only allow H or V segments
      if (Math.abs(x1 - x2) > 0.01 && Math.abs(z1 - z2) > 0.01) return;
      if (Math.abs(x1 - x2) < 0.01 && Math.abs(z1 - z2) < 0.01) return;
      const key = segKey(x1, z1, x2, z2);
      const existing = segCounts.get(key);
      if (existing) {
        existing.count++;
        if (highlighted) existing.highlighted = true;
      } else {
        segCounts.set(key, { x1, z1, x2, z2, count: 1, highlighted });
      }
    }

    for (const edge of deps) {
      const from = posMap.get(edge.from);
      const to = posMap.get(edge.to);
      if (!from || !to) continue;

      const sx = snap(from.x);
      const sz = snap(from.z);
      const ex = snap(to.x);
      const ez = snap(to.z);

      if (sx === ex && sz === ez) continue;

      const hl = !!(highlightedPaths && (highlightedPaths.has(edge.from) || highlightedPaths.has(edge.to)));

      // If buildings share same snapped X or Z, do a direct L-route
      if (sx === ex) {
        addSeg(sx, sz, ex, ez, hl);
        continue;
      }
      if (sz === ez) {
        addSeg(sx, sz, ex, ez, hl);
        continue;
      }

      // General case: Z-route through a corridor
      const midX = (from.x + to.x) / 2;
      const chanX = nearestCorridor(corridorX, midX);

      addSeg(sx, sz, chanX, sz, hl);
      addSeg(chanX, sz, chanX, ez, hl);
      addSeg(chanX, ez, ex, ez, hl);
    }

    return [...segCounts.values()];
  }, [layouts, deps, highlightedPaths]);

  // Build a single merged geometry for all road segments
  const geometry = useMemo(() => {
    if (mergedSegments.length === 0) return null;

    const hasAnyHighlight = mergedSegments.some(s => s.highlighted);
    const positions: number[] = [];
    const colors: number[] = [];
    const maxCount = Math.max(1, ...mergedSegments.map(s => s.count));

    const dimColor = new THREE.Color("#888888");
    const normalColor = new THREE.Color("#404040");
    const brightColor = new THREE.Color("#ee7700");

    for (const seg of mergedSegments) {
      const t = Math.min(1, seg.count / maxCount);
      const halfW = 0.05 + t * 0.08;

      // Pick color: if any highlights exist, dim non-highlighted, brighten highlighted
      let color: THREE.Color;
      if (hasAnyHighlight) {
        color = seg.highlighted ? brightColor : dimColor;
      } else {
        color = normalColor;
      }

      const isH = Math.abs(seg.z1 - seg.z2) < 0.01;

      if (isH) {
        const z = seg.z1;
        const x1 = Math.min(seg.x1, seg.x2);
        const x2 = Math.max(seg.x1, seg.x2);
        positions.push(
          x1, ROAD_Y, z - halfW,  x2, ROAD_Y, z - halfW,  x2, ROAD_Y, z + halfW,
          x1, ROAD_Y, z - halfW,  x2, ROAD_Y, z + halfW,  x1, ROAD_Y, z + halfW,
        );
      } else {
        const x = seg.x1;
        const z1 = Math.min(seg.z1, seg.z2);
        const z2 = Math.max(seg.z1, seg.z2);
        positions.push(
          x - halfW, ROAD_Y, z1,  x + halfW, ROAD_Y, z1,  x + halfW, ROAD_Y, z2,
          x - halfW, ROAD_Y, z1,  x + halfW, ROAD_Y, z2,  x - halfW, ROAD_Y, z2,
        );
      }
      for (let v = 0; v < 6; v++) colors.push(color.r, color.g, color.b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, [mergedSegments]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.7}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

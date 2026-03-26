import React, { useRef, useState, useMemo } from "react";
import * as THREE from "three";
import type { LayoutRect } from "../types";

interface TreeProps {
  layout: LayoutRect;
  dimmed?: boolean;
  onHover?: (info: TreeHoverInfo | null) => void;
  onClick?: (path: string) => void;
}

export interface TreeHoverInfo {
  path: string;
  fileName: string;
  folder: string;
  lines: number;
  extension: string;
}

// Scale tree size by line count: small JSON = small tree, big JSON = big tree
// Capped so nothing gets absurdly large
const MIN_SCALE = 0.4;
const MAX_SCALE = 1.6;

function treeScale(lines: number): number {
  if (lines <= 0) return MIN_SCALE;
  // sqrt scaling: grows fast for small files, plateaus for large
  const s = MIN_SCALE + Math.sqrt(Math.min(lines, 5000)) * 0.016;
  return Math.min(MAX_SCALE, s);
}

// Deterministic pseudo-random from path string (for variety)
function hashPath(path: string): number {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) - h + path.charCodeAt(i)) | 0;
  }
  return (h & 0x7fffffff) / 0x7fffffff; // 0..1
}

const TRUNK_COLOR = "#6b4226";
const LEAF_COLORS = ["#2d6e2e", "#3a8c3b", "#4a9e4a", "#357a36", "#2b7d3e"];

export const Tree = React.memo(function Tree({ layout, dimmed, onHover, onClick }: TreeProps) {
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef<THREE.Group>(null);

  const scale = useMemo(() => treeScale(layout.lines), [layout.lines]);
  const rng = useMemo(() => hashPath(layout.path), [layout.path]);

  const leafColor = useMemo(() => {
    return LEAF_COLORS[Math.floor(rng * LEAF_COLORS.length)];
  }, [rng]);

  // Slight random rotation so trees don't all face the same way
  const yRotation = useMemo(() => rng * Math.PI * 2, [rng]);

  const fileName = layout.path.split("/").pop() ?? layout.path;
  const folder = layout.path.includes("/")
    ? layout.path.substring(0, layout.path.lastIndexOf("/"))
    : "";

  const trunkH = 0.6 * scale;
  const trunkR = 0.08 * scale;
  const canopyR = 0.5 * scale;
  const canopyY = trunkH + canopyR * 0.6;
  const opacity = dimmed ? 0.25 : 1;

  return (
    <group
      ref={groupRef}
      position={[layout.x, 0, layout.z]}
      rotation={[0, yRotation, 0]}
      onClick={(e) => { e.stopPropagation(); onClick?.(layout.path); }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        onHover?.({ path: layout.path, fileName, folder, lines: layout.lines, extension: layout.extension || "json" });
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => { setHovered(false); onHover?.(null); document.body.style.cursor = "auto"; }}
    >
      {/* Trunk */}
      <mesh position={[0, trunkH / 2, 0]}>
        <cylinderGeometry args={[trunkR * 0.6, trunkR, trunkH, 6]} />
        <meshStandardMaterial
          color={TRUNK_COLOR}
          roughness={0.9}
          transparent={dimmed}
          opacity={opacity}
        />
      </mesh>

      {/* Main canopy — dodecahedron for organic look */}
      <mesh position={[0, canopyY, 0]}>
        <dodecahedronGeometry args={[canopyR, 1]} />
        <meshStandardMaterial
          color={hovered ? "#5ccc5c" : leafColor}
          roughness={0.8}
          transparent={dimmed}
          opacity={opacity}
        />
      </mesh>

      {/* Second smaller canopy cluster offset for fullness */}
      <mesh position={[canopyR * 0.3, canopyY + canopyR * 0.3, canopyR * 0.2]}>
        <dodecahedronGeometry args={[canopyR * 0.65, 1]} />
        <meshStandardMaterial
          color={hovered ? "#5ccc5c" : leafColor}
          roughness={0.8}
          transparent={dimmed}
          opacity={opacity}
        />
      </mesh>

      {/* Hover ring */}
      {hovered && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[canopyR + 0.1, canopyR + 0.2, 24]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.5} />
        </mesh>
      )}
    </group>
  );
}, (prev, next) =>
  prev.layout === next.layout &&
  prev.dimmed === next.dimmed
);

import { useMemo } from "react";
import * as THREE from "three";
import type { LayoutRect } from "../types";

interface BlockProps {
  layout: LayoutRect;
}

export function Block({ layout }: BlockProps) {
  const depth = layout.folderDepth;

  // Ground color - light green grass at depth 1, lighter gray for deeper
  const groundColor = useMemo(() => {
    if (depth <= 1) return "#4a9a3a"; // rich green grass
    if (depth === 2) return "#5aaa48"; // slightly lighter
    return "#60b050";
  }, [depth]);

  // Border/curb color - light concrete
  const curbColor = useMemo(() => {
    if (depth <= 1) return "#c0c4c8";
    return "#b8bcc0";
  }, [depth]);

  const yPos = -0.05 * depth;

  return (
    <group position={[layout.x, yPos, layout.z]}>
      {/* Main ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[layout.width, layout.depth]} />
        <meshStandardMaterial
          color={groundColor}
          roughness={0.95}
          metalness={0.0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Sidewalk / curb - raised border around the block */}
      {depth <= 2 && (
        <>
          {/* Front curb */}
          <mesh position={[0, 0.02, layout.depth / 2]}>
            <boxGeometry args={[layout.width, 0.04, 0.08]} />
            <meshStandardMaterial color={curbColor} roughness={0.8} />
          </mesh>
          {/* Back curb */}
          <mesh position={[0, 0.02, -layout.depth / 2]}>
            <boxGeometry args={[layout.width, 0.04, 0.08]} />
            <meshStandardMaterial color={curbColor} roughness={0.8} />
          </mesh>
          {/* Left curb */}
          <mesh position={[-layout.width / 2, 0.02, 0]}>
            <boxGeometry args={[0.08, 0.04, layout.depth]} />
            <meshStandardMaterial color={curbColor} roughness={0.8} />
          </mesh>
          {/* Right curb */}
          <mesh position={[layout.width / 2, 0.02, 0]}>
            <boxGeometry args={[0.08, 0.04, layout.depth]} />
            <meshStandardMaterial color={curbColor} roughness={0.8} />
          </mesh>
        </>
      )}
    </group>
  );
}

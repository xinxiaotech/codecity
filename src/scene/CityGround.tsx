import * as THREE from "three";
import type { LayoutRect } from "../types";

interface CityGroundProps {
  layouts: LayoutRect[];
}

export function CityGround({ layouts }: CityGroundProps) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
      <planeGeometry args={[300, 300]} />
      <meshStandardMaterial
        color="#5a7a50"
        roughness={0.95}
        metalness={0.0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

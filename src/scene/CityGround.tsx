import * as THREE from "three";
import type { LayoutRect } from "../types";

interface CityGroundProps {
  layouts: LayoutRect[];
}

export function CityGround({ layouts }: CityGroundProps) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.25, 0]} receiveShadow>
      <planeGeometry args={[200, 200]} />
      <meshStandardMaterial
        color="#3a3e44"
        roughness={0.9}
        metalness={0.05}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

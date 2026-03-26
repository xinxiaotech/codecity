import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface CraneProps {
  height: number;
  buildingWidth: number;
}

const ARM_LENGTH = 0.8;
const HEAD_HEIGHT = 0.08;
const MAST_HEIGHT = 0.3;

export function Crane({ height, buildingWidth }: CraneProps) {
  const hookRef = useRef<THREE.Group>(null);

  const roofY = height;
  const mastTop = roofY + MAST_HEIGHT;
  const offset = buildingWidth / 2 + 0.15;

  // Only animate the hook swing — not the whole crane
  useFrame((state) => {
    if (hookRef.current) {
      hookRef.current.position.x = Math.sin(state.clock.elapsedTime * 0.8) * 0.05;
    }
  });

  return (
    <group position={[offset, 0, 0]}>
      {/* Mast */}
      <mesh position={[0, roofY + MAST_HEIGHT / 2, 0]}>
        <boxGeometry args={[HEAD_HEIGHT, MAST_HEIGHT, HEAD_HEIGHT]} />
        <meshStandardMaterial color="#e8b830" roughness={0.5} />
      </mesh>
      {/* Jib arm */}
      <mesh position={[ARM_LENGTH / 2, mastTop, 0]}>
        <boxGeometry args={[ARM_LENGTH, 0.04, 0.04]} />
        <meshStandardMaterial color="#e8b830" roughness={0.5} />
      </mesh>
      {/* Counter-arm */}
      <mesh position={[-0.2, mastTop, 0]}>
        <boxGeometry args={[0.4, 0.04, 0.04]} />
        <meshStandardMaterial color="#e8b830" roughness={0.5} />
      </mesh>
      {/* Counterweight */}
      <mesh position={[-0.35, mastTop - 0.06, 0]}>
        <boxGeometry args={[0.12, 0.08, 0.08]} />
        <meshStandardMaterial color="#555" roughness={0.7} />
      </mesh>
      {/* Hook */}
      <group ref={hookRef} position={[0, mastTop - 0.15, 0]}>
        <mesh>
          <boxGeometry args={[0.02, 0.12, 0.02]} />
          <meshStandardMaterial color="#888" metalness={0.6} />
        </mesh>
      </group>
    </group>
  );
}

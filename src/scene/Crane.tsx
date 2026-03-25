import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface CraneProps {
  heightRef: React.RefObject<number>;
  buildingWidth: number;
}

// Fixed head dimensions regardless of building size
const ARM_LENGTH = 0.8;
const HEAD_HEIGHT = 0.08;
const MAST_HEIGHT = 0.3;

export function Crane({ heightRef, buildingWidth }: CraneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!groupRef.current) return;
    // Track the animated building height
    const h = heightRef.current ?? 1;
    const roofY = h;
    const mastTop = roofY + MAST_HEIGHT;
    const children = groupRef.current.children;

    // Mast
    if (children[0]) {
      children[0].position.y = roofY + MAST_HEIGHT / 2;
    }
    // Jib arm
    if (children[1]) {
      children[1].position.y = mastTop;
    }
    // Counter-arm
    if (children[2]) {
      children[2].position.y = mastTop;
    }
    // Counterweight
    if (children[3]) {
      children[3].position.y = mastTop - 0.06;
    }
    // Hook
    if (hookRef.current) {
      hookRef.current.position.y = mastTop - 0.15;
      hookRef.current.position.x = Math.sin(state.clock.elapsedTime * 0.8) * 0.05;
    }
  });

  return (
    <group ref={groupRef} position={[buildingWidth * 0.3, 0, 0]}>
      {/* Short mast sitting on rooftop */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.08, MAST_HEIGHT, 0.08]} />
        <meshStandardMaterial color="#e8b830" roughness={0.5} metalness={0.4} />
      </mesh>

      {/* Jib arm */}
      <mesh position={[-ARM_LENGTH / 2, 0, 0]}>
        <boxGeometry args={[ARM_LENGTH, HEAD_HEIGHT, HEAD_HEIGHT]} />
        <meshStandardMaterial color="#e8b830" roughness={0.5} metalness={0.4} />
      </mesh>

      {/* Counter-arm */}
      <mesh position={[ARM_LENGTH * 0.2, 0, 0]}>
        <boxGeometry args={[ARM_LENGTH * 0.35, HEAD_HEIGHT, HEAD_HEIGHT]} />
        <meshStandardMaterial color="#e8b830" roughness={0.5} metalness={0.4} />
      </mesh>

      {/* Counterweight */}
      <mesh position={[ARM_LENGTH * 0.35, 0, 0]}>
        <boxGeometry args={[0.12, 0.1, 0.1]} />
        <meshStandardMaterial color="#555" roughness={0.7} metalness={0.3} />
      </mesh>

      {/* Hook block */}
      <group ref={hookRef} position={[-ARM_LENGTH * 0.35, 0, 0]}>
        <mesh>
          <boxGeometry args={[0.04, 0.04, 0.04]} />
          <meshStandardMaterial color="#aaa" metalness={0.7} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}

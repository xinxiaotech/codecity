import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface DustCloudProps {
  width: number;
  depth: number;
  height: number;
}

const PARTICLE_COUNT = 20;

export function DustCloud({ width, depth, height }: DustCloudProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Each particle: [offsetX, offsetZ, speed, phase, startY]
  const particles = useMemo(() => {
    const arr: [number, number, number, number, number][] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      arr.push([
        (Math.random() - 0.5) * width * 0.8,
        (Math.random() - 0.5) * depth * 0.8,
        0.15 + Math.random() * 0.25,
        Math.random() * Math.PI * 2,
        height * 0.4 + Math.random() * height * 0.6, // concentrate around rooftop
      ]);
    }
    return arr;
  }, [width, depth]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const halfW = width / 2;
  const halfD = depth / 2;

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const [ox, oz, speed, phase, startY] = particles[i];
      const cycle = ((t * speed + phase) % 3) / 3;

      const y = startY + cycle * height * 0.2;
      const driftX = Math.sin(t * 0.3 + phase) * 0.1;
      const driftZ = Math.cos(t * 0.4 + phase * 1.3) * 0.08;

      // Clamp position within building footprint
      const px = Math.max(-halfW, Math.min(halfW, ox + driftX));
      const pz = Math.max(-halfD, Math.min(halfD, oz + driftZ));

      const scale = (0.15 + Math.sin(cycle * Math.PI) * 0.15) * Math.max(width, depth);

      dummy.position.set(px, y, pz);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PARTICLE_COUNT]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial
        color="#aaaaaa"
        transparent
        opacity={0.1}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

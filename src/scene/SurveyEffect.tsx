import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface SurveyEffectProps {
  width: number;
  depth: number;
  height: number;
}

/** Tiny person standing and looking at the building. */
function SurveyPerson({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={0.07}>
      {/* Body */}
      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[0.4, 0.6, 0.25]} />
        <meshStandardMaterial color="#e8a030" roughness={0.7} />
      </mesh>
      {/* Head (hard hat) */}
      <mesh position={[0, 1.05, 0]}>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <meshStandardMaterial color="#f5d740" roughness={0.5} />
      </mesh>
      {/* Legs */}
      <mesh position={[-0.1, 0.15, 0]}>
        <boxGeometry args={[0.15, 0.3, 0.2]} />
        <meshStandardMaterial color="#334" roughness={0.8} />
      </mesh>
      <mesh position={[0.1, 0.15, 0]}>
        <boxGeometry args={[0.15, 0.3, 0.2]} />
        <meshStandardMaterial color="#334" roughness={0.8} />
      </mesh>
    </group>
  );
}

/** Tiny survey car / van parked near the building. */
function SurveyCar({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={0.1}>
      {/* Body */}
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[1.2, 0.35, 0.5]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} />
      </mesh>
      {/* Cabin */}
      <mesh position={[0.2, 0.52, 0]}>
        <boxGeometry args={[0.6, 0.2, 0.45]} />
        <meshStandardMaterial color="#ddeeff" roughness={0.3} metalness={0.1} />
      </mesh>
      {/* Wheels */}
      {[-0.35, 0.35].map((x) => (
        <mesh key={x} position={[x, 0.08, 0.28]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.06, 8]} />
          <meshStandardMaterial color="#222" roughness={0.9} />
        </mesh>
      ))}
      {[-0.35, 0.35].map((x) => (
        <mesh key={x} position={[x, 0.08, -0.28]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.06, 8]} />
          <meshStandardMaterial color="#222" roughness={0.9} />
        </mesh>
      ))}
      {/* Orange stripe */}
      <mesh position={[0, 0.25, 0.26]}>
        <boxGeometry args={[1.2, 0.08, 0.01]} />
        <meshStandardMaterial color="#f5a623" roughness={0.6} />
      </mesh>
    </group>
  );
}

export function SurveyEffect({ width, depth, height }: SurveyEffectProps) {
  const beamRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const personRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Sweep beam up and down the building
    const y = height / 2 + Math.sin(t * 2) * (height / 2);
    if (beamRef.current) beamRef.current.position.y = y;
    if (glowRef.current) {
      glowRef.current.position.y = y;
      glowRef.current.scale.x = 1 + Math.sin(t * 4) * 0.1;
    }
    // Person walks slowly around the building
    if (personRef.current) {
      const angle = t * 0.5;
      const rx = (width / 2 + 0.25) * Math.cos(angle);
      const rz = (depth / 2 + 0.25) * Math.sin(angle);
      personRef.current.position.set(rx, 0, rz);
      personRef.current.rotation.y = -angle + Math.PI / 2;
    }
  });

  const beamW = width + 0.15;
  const beamD = depth + 0.15;

  return (
    <group>
      {/* Scanning beam ring */}
      <mesh ref={beamRef} position={[0, height / 2, 0]}>
        <boxGeometry args={[beamW, 0.02, beamD]} />
        <meshBasicMaterial color="#44aaff" transparent opacity={0.5} />
      </mesh>
      {/* Glow around building */}
      <mesh ref={glowRef} position={[0, height / 2, 0]}>
        <boxGeometry args={[beamW + 0.1, 0.06, beamD + 0.1]} />
        <meshBasicMaterial color="#44aaff" transparent opacity={0.12} />
      </mesh>
      {/* Subtle overall tint */}
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[width + 0.05, height + 0.02, depth + 0.05]} />
        <meshBasicMaterial color="#44aaff" transparent opacity={0.06} depthWrite={false} />
      </mesh>

      {/* Walking surveyor */}
      <group ref={personRef}>
        <SurveyPerson position={[0, 0, 0]} />
      </group>

      {/* Stationary person with clipboard */}
      <SurveyPerson
        position={[width / 2 + 0.3, 0, depth / 2 + 0.15]}
        rotation={-Math.PI / 4}
      />

      {/* Survey van parked nearby */}
      <SurveyCar
        position={[-(width / 2 + 0.4), 0, depth / 2 + 0.3]}
        rotation={Math.PI / 6}
      />
    </group>
  );
}

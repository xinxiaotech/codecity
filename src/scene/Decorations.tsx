import { useMemo } from "react";
import * as THREE from "three";

// Low-poly tree — uses seeded rng from index for determinism
function DecoTree({ position, seed }: { position: [number, number, number]; seed: number }) {
  const rng = mulberry32(seed);
  const scale = 0.6 + rng() * 0.5;
  const tilt = (rng() - 0.5) * 0.1;
  return (
    <group position={position} scale={scale} rotation={[tilt, rng() * Math.PI * 2, 0]}>
      {/* Trunk */}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.06, 0.08, 0.6, 6]} />
        <meshStandardMaterial color="#5a3a20" roughness={0.9} />
      </mesh>
      {/* Foliage layers */}
      <mesh position={[0, 0.75, 0]}>
        <coneGeometry args={[0.4, 0.6, 7]} />
        <meshStandardMaterial color="#2d6b3a" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.05, 0]}>
        <coneGeometry args={[0.3, 0.5, 7]} />
        <meshStandardMaterial color="#358844" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.3, 0]}>
        <coneGeometry args={[0.2, 0.4, 7]} />
        <meshStandardMaterial color="#40a050" roughness={0.8} />
      </mesh>
    </group>
  );
}

// Round bush tree (variety)
function BushTree({ position, seed }: { position: [number, number, number]; seed: number }) {
  const scale = 0.5 + mulberry32(seed)() * 0.4;
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.04, 0.06, 0.4, 6]} />
        <meshStandardMaterial color="#4a3018" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.55, 0]}>
        <sphereGeometry args={[0.35, 8, 6]} />
        <meshStandardMaterial color="#2a7a35" roughness={0.85} />
      </mesh>
    </group>
  );
}

// Street lamp
function StreetLamp({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Pole */}
      <mesh position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.025, 0.035, 1.6, 8]} />
        <meshStandardMaterial color="#3a3a3a" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Arm */}
      <mesh position={[0.15, 1.5, 0]} rotation={[0, 0, -0.3]}>
        <cylinderGeometry args={[0.015, 0.015, 0.35, 6]} />
        <meshStandardMaterial color="#3a3a3a" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Light */}
      <mesh position={[0.25, 1.55, 0]}>
        <sphereGeometry args={[0.06, 8, 6]} />
        <meshStandardMaterial
          color="#ffeeaa"
          emissive="#ffcc44"
          emissiveIntensity={2}
        />
      </mesh>
      {/* Emissive glow — no pointLight needed (16 lights kill perf) */}
    </group>
  );
}

// Park bench
function Bench({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Seat */}
      <mesh position={[0, 0.18, 0]}>
        <boxGeometry args={[0.5, 0.03, 0.15]} />
        <meshStandardMaterial color="#6a4a2a" roughness={0.85} />
      </mesh>
      {/* Back rest */}
      <mesh position={[0, 0.32, -0.06]} rotation={[0.15, 0, 0]}>
        <boxGeometry args={[0.5, 0.15, 0.02]} />
        <meshStandardMaterial color="#6a4a2a" roughness={0.85} />
      </mesh>
      {/* Legs */}
      {[-0.2, 0.2].map((x) => (
        <mesh key={x} position={[x, 0.08, 0]}>
          <boxGeometry args={[0.03, 0.16, 0.12]} />
          <meshStandardMaterial color="#333" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

// Fire hydrant
function Hydrant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 0.24, 8]} />
        <meshStandardMaterial color="#cc2222" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.26, 0]}>
        <sphereGeometry args={[0.045, 8, 6]} />
        <meshStandardMaterial color="#cc2222" roughness={0.6} />
      </mesh>
    </group>
  );
}

interface DecorationsProps {
  citySize: number; // approximate size of city area
}

export function Decorations({ citySize }: DecorationsProps) {
  const items = useMemo(() => {
    const trees: [number, number, number][] = [];
    const bushes: [number, number, number][] = [];
    const lamps: [number, number, number][] = [];
    const benches: { pos: [number, number, number]; rot: number }[] = [];
    const hydrants: [number, number, number][] = [];

    const half = citySize / 2;
    const margin = 2;
    const rng = mulberry32(42); // seeded random for stability

    // Trees around the perimeter and scattered
    for (let i = 0; i < 40; i++) {
      const angle = (i / 40) * Math.PI * 2;
      const r = half + margin + rng() * 4;
      trees.push([Math.cos(angle) * r, 0, Math.sin(angle) * r]);
    }
    // Some random trees inside
    for (let i = 0; i < 15; i++) {
      trees.push([
        (rng() - 0.5) * citySize * 1.2,
        0,
        (rng() - 0.5) * citySize * 1.2,
      ]);
    }

    // Bushes
    for (let i = 0; i < 20; i++) {
      bushes.push([
        (rng() - 0.5) * citySize * 1.4,
        0,
        (rng() - 0.5) * citySize * 1.4,
      ]);
    }

    // Street lamps along edges
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      const r2 = half + 1;
      lamps.push([Math.cos(t) * r2, 0, Math.sin(t) * r2]);
    }

    // Benches
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2;
      const r3 = half + 2;
      benches.push({
        pos: [Math.cos(t) * r3, 0, Math.sin(t) * r3],
        rot: t + Math.PI / 2,
      });
    }

    // Hydrants
    for (let i = 0; i < 6; i++) {
      const t = ((i + 0.5) / 6) * Math.PI * 2;
      const r4 = half + 0.8;
      hydrants.push([Math.cos(t) * r4, 0, Math.sin(t) * r4]);
    }

    return { trees, bushes, lamps, benches, hydrants };
  }, [citySize]);

  return (
    <group>
      {items.trees.map((pos, i) => (
        <DecoTree key={`t${i}`} position={pos} seed={i * 7 + 1} />
      ))}
      {items.bushes.map((pos, i) => (
        <BushTree key={`b${i}`} position={pos} seed={i * 13 + 100} />
      ))}
      {items.lamps.map((pos, i) => (
        <StreetLamp key={`l${i}`} position={pos} />
      ))}
      {items.benches.map(({ pos, rot }, i) => (
        <Bench key={`bn${i}`} position={pos} rotation={rot} />
      ))}
      {items.hydrants.map((pos, i) => (
        <Hydrant key={`h${i}`} position={pos} />
      ))}
    </group>
  );
}

// Seeded random for consistent decoration placement
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

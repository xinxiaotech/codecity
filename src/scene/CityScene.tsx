import { useMemo, useCallback, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text, Stars } from "@react-three/drei";
import type { LayoutRect } from "../types";
import { Building, type BuildingHoverInfo } from "./Building";
import { Block } from "./Block";
import { CityGround } from "./CityGround";
import { Roads } from "./Roads";
import type { DepEdge } from "../hooks/useCityData";

interface CitySceneProps {
  layouts: LayoutRect[];
  previousPaths?: Set<string>;
  activeEditing?: Set<string>;
  activeSurveying?: Set<string>;
  deps?: DepEdge[];
  onBuildingHover?: (info: BuildingHoverInfo | null) => void;
}

export function CityScene({ layouts, previousPaths, activeEditing, activeSurveying, deps, onBuildingHover: onBuildingHoverProp }: CitySceneProps) {
  const folders = layouts.filter((r) => r.isFolder);
  const files = layouts.filter((r) => !r.isFolder);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  const onBuildingHover = useCallback((info: BuildingHoverInfo | null) => {
    setHoveredPath(info?.path ?? null);
    onBuildingHoverProp?.(info);
  }, [onBuildingHoverProp]);

  // Collect all highlighted file paths (editing, surveying, new, or hovered)
  const highlightedPaths = useMemo(() => {
    const s = new Set<string>();
    if (hoveredPath) s.add(hoveredPath);
    if (activeEditing) for (const p of activeEditing) s.add(p);
    if (activeSurveying) for (const p of activeSurveying) s.add(p);
    if (previousPaths) {
      for (const f of files) {
        if (!previousPaths.has(f.path)) s.add(f.path);
      }
    }
    return s;
  }, [hoveredPath, activeEditing, activeSurveying, previousPaths, files]);

  const hasHighlighted = highlightedPaths.size > 0;

  return (
    <Canvas
      camera={{ position: [25, 30, 25], fov: 50, near: 0.1, far: 1000 }}
      shadows
    >
      {/* Night sky */}
      <color attach="background" args={["#0a0a14"]} />
      <Stars radius={200} depth={80} count={3000} factor={3} fade speed={0.5} />

      {/* Ambient — moonlight */}
      <ambientLight intensity={0.35} color="#8899cc" />

      {/* Moon light */}
      <directionalLight
        position={[40, 60, 30]}
        intensity={0.7}
        color="#aabbdd"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={200}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />

      {/* Fill light */}
      <directionalLight position={[-30, 40, -30]} intensity={0.25} color="#667799" />

      <hemisphereLight
        color="#334466"
        groundColor="#1a1a2e"
        intensity={0.3}
      />

      <fog attach="fog" args={["#0a0a14", 80, 250]} />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.15}
        minPolarAngle={Math.PI / 10}
        minDistance={5}
        maxDistance={150}
      />

      {/* Ground */}
      <CityGround layouts={layouts} />

      {/* Dependency roads between files */}
      {deps && deps.length > 0 && <Roads layouts={layouts} deps={deps} highlightedPaths={highlightedPaths} />}

      {/* Folder blocks with labels */}
      {folders.map((f) => (
        <group key={f.path}>
          <Block layout={f} />
          {f.folderDepth <= 1 && (
            <Text
              position={[f.x, 0.15, f.z + f.depth / 2 + 0.5]}
              rotation={[-Math.PI / 5, 0, 0]}
              fontSize={0.55}
              color="#2a4a3a"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.03}
              outlineColor="#ffffff"
              font={undefined}
            >
              {f.path.split("/").pop()}
            </Text>
          )}
        </group>
      ))}

      {/* Buildings */}
      {files.map((f) => {
        const isNew = previousPaths ? !previousPaths.has(f.path) : false;
        const isEditing = activeEditing?.has(f.path) ?? false;
        const isSurveying = activeSurveying?.has(f.path) ?? false;
        const isHighlighted = isEditing || isSurveying || isNew;
        return (
          <Building
            key={f.path}
            layout={f}
            isNew={isNew}
            isEditing={isEditing}
            isSurveying={isSurveying}
            dimmed={hasHighlighted && !isHighlighted}
            onHover={onBuildingHover}
          />
        );
      })}
    </Canvas>
  );
}

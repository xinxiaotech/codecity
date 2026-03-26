import { useMemo, useCallback, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import type { LayoutRect } from "../types";
import { Building, type BuildingHoverInfo } from "./Building";
import { Tree, type TreeHoverInfo } from "./Tree";
import { CityGround } from "./CityGround";
import { Roads } from "./Roads";
import type { DepEdge } from "../hooks/useCityData";

const DATA_EXTS = new Set(["json", "yaml", "yml", "toml", "xml", "env", "csv"]);

interface CitySceneProps {
  layouts: LayoutRect[];
  previousPaths?: Set<string>;
  activeEditing?: Set<string>;
  activeSurveying?: Set<string>;
  deps?: DepEdge[];
  onBuildingHover?: (info: BuildingHoverInfo | null) => void;
  onBuildingClick?: (path: string) => void;
}

export function CityScene({ layouts, previousPaths, activeEditing, activeSurveying, deps, onBuildingHover: onBuildingHoverProp, onBuildingClick }: CitySceneProps) {
  const buildings = useMemo(() => layouts.filter((r) => !r.isFolder && !DATA_EXTS.has(r.extension)), [layouts]);
  const trees = useMemo(() => layouts.filter((r) => !r.isFolder && DATA_EXTS.has(r.extension)), [layouts]);
  const files = useMemo(() => layouts.filter((r) => !r.isFolder), [layouts]);

  // Hover stored in a ref — does NOT trigger re-render of the scene.
  // Only the tooltip in App.tsx re-renders (via the onBuildingHoverProp callback).
  const hoveredPathRef = useRef<string | null>(null);

  const onBuildingHover = useCallback((info: BuildingHoverInfo | null) => {
    hoveredPathRef.current = info?.path ?? null;
    onBuildingHoverProp?.(info);
  }, [onBuildingHoverProp]);

  const onTreeHover = useCallback((info: TreeHoverInfo | null) => {
    hoveredPathRef.current = info?.path ?? null;
    if (info) {
      onBuildingHoverProp?.({
        ...info,
        styleLabel: "Data",
        styleColor: "#4a9e4a",
        styleType: "warehouse",
      });
    } else {
      onBuildingHoverProp?.(null);
    }
  }, [onBuildingHoverProp]);

  // Highlighted paths — only editing/surveying/new files trigger dimming.
  // Hover is excluded so it doesn't cause mass re-renders.
  const highlightedPaths = useMemo(() => {
    const s = new Set<string>();
    if (activeEditing) for (const p of activeEditing) s.add(p);
    if (activeSurveying) for (const p of activeSurveying) s.add(p);
    if (previousPaths) {
      for (const f of files) {
        if (!previousPaths.has(f.path)) s.add(f.path);
      }
    }
    return s;
  }, [activeEditing, activeSurveying, previousPaths, files]);

  const hasHighlighted = highlightedPaths.size > 0;

  return (
    <Canvas
      camera={{ position: [25, 30, 25], fov: 50, near: 0.1, far: 1000 }}
    >
      {/* Bright blue sky */}
      <color attach="background" args={["#4da6e8"]} />

      {/* Warm ambient */}
      <ambientLight intensity={0.6} color="#ffffff" />

      {/* Sun — no shadow map (was rendering all ~1200 meshes twice per frame) */}
      <directionalLight
        position={[50, 80, 40]}
        intensity={1.4}
        color="#fff8e8"
      />

      {/* Fill light from opposite side */}
      <directionalLight position={[-30, 40, -30]} intensity={0.4} color="#aaccff" />

      {/* Sky/ground color bounce */}
      <hemisphereLight
        color="#87CEEB"
        groundColor="#a0d060"
        intensity={0.4}
      />

      <fog attach="fog" args={["#4da6e8", 80, 300]} />

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

      {/* Buildings (source code) */}
      {buildings.map((f) => {
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
            onClick={onBuildingClick}
          />
        );
      })}

      {/* Trees (data/config files) */}
      {trees.map((f) => (
        <Tree
          key={f.path}
          layout={f}
          dimmed={hasHighlighted && !highlightedPaths.has(f.path)}
          onHover={onTreeHover}
          onClick={onBuildingClick}
        />
      ))}
    </Canvas>
  );
}

import React, { useRef, useState, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import type { LayoutRect } from "../types";
import { getBuildingStyle, type BuildingType } from "../utils/colors";
import { createFacadeTexture } from "./BuildingTextures";
import { Crane } from "./Crane";
import { DustCloud } from "./DustCloud";
import { SurveyEffect } from "./SurveyEffect";

interface BuildingProps {
  layout: LayoutRect;
  isNew?: boolean;
  isEditing?: boolean;
  isSurveying?: boolean;
  dimmed?: boolean;
  onHover?: (info: BuildingHoverInfo | null) => void;
  onClick?: (path: string) => void;
}

export interface BuildingHoverInfo {
  path: string;
  fileName: string;
  folder: string;
  lines: number;
  extension: string;
  styleLabel: string;
  styleColor: string;
  styleType: string;
}

const BASE_HEIGHT = 1;
const FENCE_HEIGHT = 0.2;
const FENCE_MARGIN = 0.15;
const POST_SPACING = 0.5;

function ConstructionFence({ width, depth }: { width: number; depth: number }) {
  const hw = width / 2 + FENCE_MARGIN;
  const hd = depth / 2 + FENCE_MARGIN;

  // Generate post positions along each side
  const postsX: number[] = [];
  const countX = Math.max(2, Math.ceil(width / POST_SPACING) + 1);
  for (let i = 0; i < countX; i++) postsX.push(-hw + (2 * hw / (countX - 1)) * i);

  const postsZ: number[] = [];
  const countZ = Math.max(2, Math.ceil(depth / POST_SPACING) + 1);
  for (let i = 0; i < countZ; i++) postsZ.push(-hd + (2 * hd / (countZ - 1)) * i);

  return (
    <group>
      {/* Front rail (+Z) */}
      <mesh position={[0, FENCE_HEIGHT / 2, hd]}>
        <boxGeometry args={[hw * 2, 0.02, 0.02]} />
        <meshStandardMaterial color="#f5c518" roughness={0.5} />
      </mesh>
      {/* Back rail (-Z) */}
      <mesh position={[0, FENCE_HEIGHT / 2, -hd]}>
        <boxGeometry args={[hw * 2, 0.02, 0.02]} />
        <meshStandardMaterial color="#f5c518" roughness={0.5} />
      </mesh>
      {/* Left rail (-X) */}
      <mesh position={[-hw, FENCE_HEIGHT / 2, 0]}>
        <boxGeometry args={[0.02, 0.02, hd * 2]} />
        <meshStandardMaterial color="#f5c518" roughness={0.5} />
      </mesh>
      {/* Right rail (+X) */}
      <mesh position={[hw, FENCE_HEIGHT / 2, 0]}>
        <boxGeometry args={[0.02, 0.02, hd * 2]} />
        <meshStandardMaterial color="#f5c518" roughness={0.5} />
      </mesh>

      {/* Posts along front and back */}
      {postsX.map((x, i) => (
        <group key={`fb${i}`}>
          <mesh position={[x, FENCE_HEIGHT / 2, hd]}>
            <boxGeometry args={[0.03, FENCE_HEIGHT, 0.03]} />
            <meshStandardMaterial color="#e8b830" roughness={0.5} />
          </mesh>
          <mesh position={[x, FENCE_HEIGHT / 2, -hd]}>
            <boxGeometry args={[0.03, FENCE_HEIGHT, 0.03]} />
            <meshStandardMaterial color="#e8b830" roughness={0.5} />
          </mesh>
        </group>
      ))}
      {/* Posts along left and right */}
      {postsZ.map((z, i) => (
        <group key={`lr${i}`}>
          <mesh position={[-hw, FENCE_HEIGHT / 2, z]}>
            <boxGeometry args={[0.03, FENCE_HEIGHT, 0.03]} />
            <meshStandardMaterial color="#e8b830" roughness={0.5} />
          </mesh>
          <mesh position={[hw, FENCE_HEIGHT / 2, z]}>
            <boxGeometry args={[0.03, FENCE_HEIGHT, 0.03]} />
            <meshStandardMaterial color="#e8b830" roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const HIGHLIGHT_COLORS = {
  editing: "#ff8c00",
  surveying: "#44aaff",
  newFile: "#44dd66",
};


function BuildingHighlight({ width, depth, height, color }: {
  width: number; depth: number; height: number; color: string;
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const pulse = 0.5 + Math.sin(state.clock.elapsedTime * 3) * 0.3;
    if (ringRef.current) {
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = pulse * 0.25;
    }
    if (beamRef.current) {
      (beamRef.current.material as THREE.MeshBasicMaterial).opacity = pulse * 0.08;
    }
  });

  const margin = 0.2;
  return (
    <group>
      {/* Ground glow ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <planeGeometry args={[width + margin * 2, depth + margin * 2]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} depthWrite={false} />
      </mesh>
      {/* Vertical light beam */}
      <mesh ref={beamRef} position={[0, height / 2, 0]}>
        <boxGeometry args={[width + margin, height, depth + margin]} />
        <meshBasicMaterial color={color} transparent opacity={0.06} depthWrite={false} />
      </mesh>
      {/* Emissive glow only — no point light (expensive per-fragment cost) */}
    </group>
  );
}

function getWindowStyle(type: BuildingType): "grid" | "bands" | "sparse" | "columns" | "industrial" {
  switch (type) {
    case "glass": return "bands";
    case "brick": return "grid";
    case "artdeco": return "grid";
    case "warehouse": return "sparse";
    case "library": return "columns";
    case "factory": return "industrial";
  }
}

function getWindowColor(type: BuildingType): string {
  switch (type) {
    case "glass": return "rgba(60,150,230,0.9)";
    case "brick": return "rgba(60,140,220,0.85)";
    case "artdeco": return "rgba(70,145,225,0.85)";
    case "warehouse": return "rgba(80,150,210,0.7)";
    case "library": return "rgba(90,155,215,0.6)";
    case "factory": return "rgba(70,140,210,0.8)";
  }
}

export const Building = React.memo(function Building({ layout, isNew, isEditing, isSurveying, dimmed, onHover, onClick }: BuildingProps) {
  const effectsRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const style = useMemo(() => getBuildingStyle(layout.path, layout.height), [layout.path, layout.height]);
  const floors = Math.max(2, Math.round(Math.max(1, Math.round(layout.height / 0.8)) / 2) * 2);
  const windowCols = Math.max(2, Math.round(Math.max(2, Math.floor(Math.max(layout.width, layout.depth) / 0.4)) / 2) * 2);

  const facadeTexture = useMemo(() => {
    const base = createFacadeTexture(
      style.color,
      getWindowColor(style.type),
      1,
      windowCols,
      getWindowStyle(style.type)
    );
    const tex = base.clone();
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, floors);
    tex.needsUpdate = true;
    return tex;
  }, [style.color, style.type, windowCols, floors]);

  const roofColor = useMemo(() => {
    const c = new THREE.Color(style.color);
    c.multiplyScalar(0.55);
    return c;
  }, [style.color]);

  // Height set directly — no per-frame animation (114 useFrame callbacks was the perf killer)
  const h = Math.max(0.01, layout.height);
  const yScale = h / BASE_HEIGHT;

  const fileName = layout.path.split("/").pop() ?? layout.path;
  const folder = layout.path.includes("/")
    ? layout.path.substring(0, layout.path.lastIndexOf("/"))
    : "";
  const w = layout.width;
  const d = layout.depth;
  return (
    <>
    <group
      position={[layout.x, h / 2, layout.z]}
      scale={[1, yScale, 1]}
      onClick={(e) => { e.stopPropagation(); onClick?.(layout.path); }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        onHover?.({ path: layout.path, fileName, folder, lines: layout.lines, extension: layout.extension || "?", styleLabel: style.label, styleColor: style.color, styleType: style.type });
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => { setHovered(false); onHover?.(null); document.body.style.cursor = "auto"; }}
    >
      {/* Hover outline */}
      {hovered && (
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(w + 0.08, BASE_HEIGHT + 0.04, d + 0.08)]} />
          <lineBasicMaterial color="#ffffff" linewidth={1} />
        </lineSegments>
      )}

      {/* Main body - 6 faces, front/back/left/right use facade texture */}
      {/* Front face (+Z) */}
      <mesh position={[0, 0, d / 2]} rotation={[0, 0, 0]}>
        <planeGeometry args={[w, BASE_HEIGHT]} />
        <meshStandardMaterial map={facadeTexture} roughness={0.6} metalness={0.15} transparent={dimmed} opacity={dimmed ? 0.25 : 1} />
      </mesh>
      {/* Back face (-Z) */}
      <mesh position={[0, 0, -d / 2]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[w, BASE_HEIGHT]} />
        <meshStandardMaterial map={facadeTexture} roughness={0.6} metalness={0.15} transparent={dimmed} opacity={dimmed ? 0.25 : 1} />
      </mesh>
      {/* Right face (+X) */}
      <mesh position={[w / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[d, BASE_HEIGHT]} />
        <meshStandardMaterial map={facadeTexture} roughness={0.6} metalness={0.15} transparent={dimmed} opacity={dimmed ? 0.25 : 1} />
      </mesh>
      {/* Left face (-X) */}
      <mesh position={[-w / 2, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[d, BASE_HEIGHT]} />
        <meshStandardMaterial map={facadeTexture} roughness={0.6} metalness={0.15} transparent={dimmed} opacity={dimmed ? 0.25 : 1} />
      </mesh>
      {/* Top (roof) */}
      <mesh position={[0, BASE_HEIGHT / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={roofColor} roughness={0.8} metalness={0.2} transparent={dimmed} opacity={dimmed ? 0.25 : 1} />
      </mesh>
      {/* Bottom */}
      <mesh position={[0, -BASE_HEIGHT / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#222" transparent={dimmed} opacity={dimmed ? 0.25 : 1} />
      </mesh>

      {/* Roof ledge */}
      <mesh position={[0, BASE_HEIGHT / 2 + 0.015, 0]}>
        <boxGeometry args={[w + 0.06, 0.03, d + 0.06]} />
        <meshStandardMaterial color={roofColor} metalness={0.3} roughness={0.5} transparent={dimmed} opacity={dimmed ? 0.25 : 1} />
      </mesh>


    </group>

    {/* Rooftop signs — one on each edge of the roof */}
    {[
      // Front edge (positive Z)
      { pos: [layout.x, h + 0.25, layout.z + d / 2 + 0.01] as const, rotY: 0, signW: w },
      // Back edge (negative Z)
      { pos: [layout.x, h + 0.25, layout.z - d / 2 - 0.01] as const, rotY: Math.PI, signW: w },
      // Right edge (positive X)
      { pos: [layout.x + w / 2 + 0.01, h + 0.25, layout.z] as const, rotY: Math.PI / 2, signW: d },
      // Left edge (negative X)
      { pos: [layout.x - w / 2 - 0.01, h + 0.25, layout.z] as const, rotY: -Math.PI / 2, signW: d },
    ].map((edge, i) => (
      <group key={i} position={edge.pos} rotation={[0, edge.rotY, 0]}>
        <group rotation={[-0.35, 0, 0]}>
          <mesh>
            <boxGeometry args={[edge.signW * 0.95, 0.3, 0.04]} />
            <meshStandardMaterial color={style.color} roughness={0.3} metalness={0.4} transparent={dimmed} opacity={dimmed ? 0.25 : 1} />
          </mesh>
          <Text
            position={[0, 0, 0.025]}
            fontSize={Math.min(0.22, edge.signW * 0.88 / Math.max(1, fileName.length) * 1.8)}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.01}
            outlineColor="#000000"
            whiteSpace="nowrap"
            font={undefined}
            material-transparent={dimmed}
            material-opacity={dimmed ? 0.25 : 1}
          >
            {fileName}
          </Text>
        </group>
      </group>
    ))}

    {/* Effects — not scaled, positioned at building ground level */}
    <group ref={effectsRef} position={[layout.x, 0, layout.z]}>
      {isEditing && (
        <>
          <DustCloud width={w} depth={d} height={layout.height} />
          <Crane height={h} buildingWidth={w} />
          <ConstructionFence width={w} depth={d} />
          <BuildingHighlight width={w} depth={d} height={layout.height} color={HIGHLIGHT_COLORS.editing} />
        </>
      )}

      {isSurveying && (
        <>
          <SurveyEffect width={w} depth={d} height={layout.height} />
          <BuildingHighlight width={w} depth={d} height={layout.height} color={HIGHLIGHT_COLORS.surveying} />
        </>
      )}

      {isNew && !isEditing && !isSurveying && (
        <BuildingHighlight width={w} depth={d} height={layout.height} color={HIGHLIGHT_COLORS.newFile} />
      )}
    </group>
    </>
  );
}, (prev, next) =>
  prev.layout === next.layout &&
  prev.isNew === next.isNew &&
  prev.isEditing === next.isEditing &&
  prev.isSurveying === next.isSurveying &&
  prev.dimmed === next.dimmed
);

const tt = {
  card: {
    background: "rgba(12, 16, 28, 0.95)",
    border: "1px solid rgba(100, 160, 255, 0.25)",
    borderRadius: "10px",
    padding: "12px 16px",
    minWidth: "200px",
    backdropFilter: "blur(12px)",
    boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 20px rgba(80,140,255,0.08)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#fff",
  },
  header: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" },
  badge: {
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "10px",
    fontWeight: 700,
    color: "#fff",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  name: { fontSize: "14px", fontWeight: 700, color: "#fff", wordBreak: "break-all" as const },
  folder: { fontSize: "11px", color: "#5a7090", marginBottom: "8px", fontFamily: "monospace" },
  stats: {
    display: "flex",
    gap: "16px",
    borderTop: "1px solid rgba(100,160,255,0.12)",
    paddingTop: "8px",
  },
  stat: { display: "flex", flexDirection: "column" as const, gap: "2px" },
  statLabel: { fontSize: "10px", color: "#5a7090", textTransform: "uppercase" as const, letterSpacing: "0.5px" },
  statValue: { fontSize: "13px", fontWeight: 600, color: "#8cb4ff", fontFamily: "monospace" },
};

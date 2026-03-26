import { useMemo } from "react";
import * as THREE from "three";
import type { LayoutRect } from "../types";

interface BlockProps {
  layout: LayoutRect;
}

// Folder name → ground color based on purpose
function getFolderColor(folderName: string): string {
  const name = folderName.toLowerCase();

  // Frontend / UI
  if (name === "components" || name === "scene" || name === "views" || name === "pages" || name === "ui")
    return "#4a9a5a"; // lush green
  // Backend / server
  if (name === "server" || name === "api" || name === "backend" || name === "worker" || name === "workers")
    return "#6a8a5a"; // olive green
  // Utilities / helpers
  if (name === "utils" || name === "lib" || name === "helpers" || name === "shared" || name === "common")
    return "#7a9a6a"; // sage green
  // Layout / logic
  if (name === "layout" || name === "logic" || name === "state" || name === "store")
    return "#5a9a7a"; // teal green
  // Hooks / middleware
  if (name === "hooks" || name === "middleware" || name === "plugins")
    return "#5aaa80"; // mint green
  // Config / scripts
  if (name === "config" || name === "scripts" || name === "tools" || name === "build")
    return "#8a9a70"; // dusty green
  // Tests
  if (name === "test" || name === "tests" || name === "__tests__" || name === "spec")
    return "#6aaa6a"; // bright green
  // Docs / content
  if (name === "docs" || name === "documentation" || name === "content" || name === "podcasts" || name === "memory")
    return "#8a9060"; // warm olive
  // Styles
  if (name === "styles" || name === "css" || name === "scss")
    return "#6a8aaa"; // blue-green
  // Assets / static / public
  if (name === "assets" || name === "static" || name === "public" || name === "images")
    return "#7a8a60"; // earthy green
  // Source root
  if (name === "src")
    return "#4a9a4a"; // rich green
  // Extensions / plugins
  if (name === "extensions" || name === "studio")
    return "#6a9a90"; // aqua green

  // Default — vary by hash of name for variety
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  const hue = 90 + (Math.abs(h) % 60); // 90-150 = green spectrum
  const sat = 30 + (Math.abs(h >> 8) % 20);
  const lit = 35 + (Math.abs(h >> 16) % 15);
  return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

export function Block({ layout }: BlockProps) {
  const depth = layout.folderDepth;
  const folderName = layout.path.split("/").pop() ?? layout.path;

  const groundColor = useMemo(() => getFolderColor(folderName), [folderName]);

  const curbColor = useMemo(() => {
    if (depth <= 1) return "#c0c4c8";
    return "#b8bcc0";
  }, [depth]);

  const yPos = -0.05 * depth;

  return (
    <group position={[layout.x, yPos, layout.z]}>
      {/* Main ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[layout.width, layout.depth]} />
        <meshStandardMaterial
          color={groundColor}
          roughness={0.95}
          metalness={0.0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Sidewalk / curb - raised border around the block */}
      {depth <= 2 && (
        <>
          {/* Front curb */}
          <mesh position={[0, 0.02, layout.depth / 2]}>
            <boxGeometry args={[layout.width, 0.04, 0.08]} />
            <meshStandardMaterial color={curbColor} roughness={0.8} />
          </mesh>
          {/* Back curb */}
          <mesh position={[0, 0.02, -layout.depth / 2]}>
            <boxGeometry args={[layout.width, 0.04, 0.08]} />
            <meshStandardMaterial color={curbColor} roughness={0.8} />
          </mesh>
          {/* Left curb */}
          <mesh position={[-layout.width / 2, 0.02, 0]}>
            <boxGeometry args={[0.08, 0.04, layout.depth]} />
            <meshStandardMaterial color={curbColor} roughness={0.8} />
          </mesh>
          {/* Right curb */}
          <mesh position={[layout.width / 2, 0.02, 0]}>
            <boxGeometry args={[0.08, 0.04, layout.depth]} />
            <meshStandardMaterial color={curbColor} roughness={0.8} />
          </mesh>
        </>
      )}
    </group>
  );
}

import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { useCityData } from "./hooks/useCityData";
import { useTimeline } from "./hooks/useTimeline";
import { StableLayoutManager } from "./layout/stable-layout";
import { CityScene } from "./scene/CityScene";
import { Timeline } from "./timeline/Timeline";
import type { BuildingHoverInfo } from "./scene/Building";

export default function App() {
  const cityData = useCityData();
  const timeline = useTimeline(cityData.snapshots.length);
  const previousPathsRef = useRef<Set<string>>(new Set());
  const layoutManagerRef = useRef<StableLayoutManager>(new StableLayoutManager());
  const [hoverInfo, setHoverInfo] = useState<BuildingHoverInfo | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const onBuildingHover = useCallback((info: BuildingHoverInfo | null) => {
    setHoverInfo(info);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  const currentSnapshot = cityData.snapshots[timeline.currentIndex];

  const layouts = useMemo(() => {
    if (!currentSnapshot || currentSnapshot.files.size === 0) return [];
    return layoutManagerRef.current.computeLayout(currentSnapshot.files);
  }, [currentSnapshot]);

  const previousPaths = useMemo(() => {
    const prev = new Set(previousPathsRef.current);
    if (currentSnapshot) {
      previousPathsRef.current = new Set(currentSnapshot.files.keys());
    }
    return prev;
  }, [currentSnapshot]);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      {!cityData.connected && cityData.snapshots.length === 0 ? (
        <div style={styles.splash}>
          <h1 style={styles.title}>CodeCity</h1>
          <p style={styles.subtitle}>
            Visualize your code being built in real-time
          </p>
          <div style={styles.instructions}>
            <p>Start the watcher server:</p>
            <code style={styles.code}>
              npx tsx server/index.ts /path/to/your/project
            </code>
            <p style={{ marginTop: "12px", color: "#888", fontSize: "13px" }}>
              Then open this page. The city will build as files change.
            </p>
          </div>
        </div>
      ) : (
        <>
          <CityScene layouts={layouts} previousPaths={previousPaths} activeEditing={cityData.activeEditing} activeSurveying={cityData.activeSurveying} deps={cityData.deps} onBuildingHover={onBuildingHover} />
          <Timeline
            timeline={timeline}
            repoName={cityData.repoName}
            fileCount={currentSnapshot?.files.size ?? 0}
            isLive={cityData.isLive}
            connected={cityData.connected}
          />
          {hoverInfo && (
            <div style={{ ...tt.card, position: "fixed", left: mousePos.x + 16, top: mousePos.y - 10, zIndex: 1000, pointerEvents: "none" }}>
              <div style={tt.header}>
                <div style={{ ...tt.badge, background: hoverInfo.styleColor }}>{hoverInfo.styleLabel}</div>
                <span style={tt.name}>{hoverInfo.fileName}</span>
              </div>
              {hoverInfo.folder && <div style={tt.folder}>{hoverInfo.folder}/</div>}
              <div style={tt.stats}>
                <div style={tt.stat}>
                  <span style={tt.statLabel}>Lines</span>
                  <span style={tt.statValue}>{hoverInfo.lines}</span>
                </div>
                <div style={tt.stat}>
                  <span style={tt.statLabel}>Type</span>
                  <span style={tt.statValue}>.{hoverInfo.extension}</span>
                </div>
                <div style={tt.stat}>
                  <span style={tt.statLabel}>Style</span>
                  <span style={tt.statValue}>{hoverInfo.styleType}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

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
  header: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" } as const,
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

const styles = {
  splash: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    background: "#87CEEB",
    color: "#333",
    fontFamily: "system-ui, sans-serif",
  },
  title: {
    fontSize: "48px",
    fontWeight: 800,
    margin: 0,
    background: "linear-gradient(135deg, #2d6cb4, #40a050)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  subtitle: {
    fontSize: "18px",
    color: "#555",
    marginTop: "8px",
  },
  instructions: {
    marginTop: "40px",
    padding: "24px",
    background: "rgba(255,255,255,0.8)",
    borderRadius: "12px",
    border: "1px solid rgba(0,0,0,0.1)",
    textAlign: "center" as const,
    color: "#444",
  },
  code: {
    display: "block",
    marginTop: "8px",
    padding: "12px 16px",
    background: "rgba(0,0,0,0.06)",
    borderRadius: "8px",
    fontFamily: "monospace",
    fontSize: "14px",
    color: "#2d6cb4",
  },
};

import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { useCityData } from "./hooks/useCityData";
import { useTimeline } from "./hooks/useTimeline";
import { StableLayoutManager } from "./layout/stable-layout";
import { CityScene } from "./scene/CityScene";
import { Timeline } from "./timeline/Timeline";
import { FilePanel } from "./components/FilePanel";
import { ProjectSelector } from "./components/ProjectSelector";
import type { BuildingHoverInfo } from "./scene/Building";

export default function App() {
  const cityData = useCityData();
  const timeline = useTimeline(cityData.snapshots.length);
  const previousPathsRef = useRef<Set<string>>(new Set());
  const layoutManagerRef = useRef<StableLayoutManager>(new StableLayoutManager());
  const [hoverInfo, setHoverInfo] = useState<BuildingHoverInfo | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Reset layout and selection when project changes
  const prevProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (cityData.currentProjectId !== prevProjectRef.current) {
      prevProjectRef.current = cityData.currentProjectId;
      layoutManagerRef.current = new StableLayoutManager();
      previousPathsRef.current = new Set();
      setSelectedFile(null);
      setHoverInfo(null);
    }
  }, [cityData.currentProjectId]);

  const onBuildingHover = useCallback((info: BuildingHoverInfo | null) => {
    setHoverInfo(info);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedFile(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    return () => clearTimeout(t);
  }, [selectedFile]);

  const currentSnapshot = cityData.snapshots[timeline.currentIndex];

  const layouts = useMemo(() => {
    if (!currentSnapshot || currentSnapshot.files.size === 0) return [];
    return layoutManagerRef.current.computeLayout(currentSnapshot.files);
  }, [currentSnapshot]);

  const previousPaths = useMemo(() => {
    const prev = previousPathsRef.current;
    if (currentSnapshot) {
      previousPathsRef.current = new Set(currentSnapshot.files.keys());
    }
    if (prev.size === 0 && currentSnapshot && currentSnapshot.files.size > 0) {
      return new Set(currentSnapshot.files.keys());
    }
    return prev;
  }, [currentSnapshot]);

  // Show project picker when not connected to any project and no snapshots
  if (!cityData.connected && cityData.snapshots.length === 0) {
    return (
      <div style={s.splashWrap}>
        <div style={s.splashCard}>
          <div style={s.splashTitle}>CodeCity</div>
          <div style={s.splashSub}>Real-time 3D codebase visualization</div>
          <div style={s.splashDivider} />
          <div style={s.splashLabel}>Start the server:</div>
          <code style={s.splashCode}>npx tsx server/index.ts</code>
          <div style={s.splashHint}>
            Start without arguments for multi-project mode, or pass a path for single-project mode.
          </div>
        </div>
      </div>
    );
  }

  // Connected but no project selected yet (multi-project mode, waiting for selection)
  if (cityData.connected && cityData.snapshots.length === 0 && cityData.projects.length > 0) {
    return (
      <div style={s.splashWrap}>
        <div style={{ ...s.splashCard, maxWidth: 500 }}>
          <div style={s.splashTitle}>CodeCity</div>
          <div style={s.splashSub}>Select a project to visualize</div>
          <div style={s.splashDivider} />
          <div style={s.projectList}>
            {cityData.projects.map((p) => (
              <button
                key={p.id}
                style={s.projectItem}
                onClick={() => cityData.switchProject(p.id)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "#1a2a24";
                  (e.currentTarget as HTMLElement).style.borderColor = "#00d4aa44";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "#09090b";
                  (e.currentTarget as HTMLElement).style.borderColor = "#27272a";
                }}
              >
                <span style={s.projectName}>{p.name}</span>
                <span style={s.projectPath}>{p.path}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.root}>
      {/* Toolbar */}
      <div style={s.toolbar}>
        <div style={s.toolbarLeft}>
          <span style={s.logo}>CodeCity</span>
          <span style={s.separator} />
          {cityData.projects.length > 0 ? (
            <ProjectSelector
              projects={cityData.projects}
              currentId={cityData.currentProjectId}
              onSelect={cityData.switchProject}
            />
          ) : (
            <span style={s.repoName}>{cityData.repoName || "..."}</span>
          )}
        </div>
        <div style={s.toolbarRight}>
          {cityData.timelapse.playing ? (
            <>
              <span style={s.toolbarStat}>
                Timelapse {cityData.timelapse.currentEvent}/{cityData.timelapse.totalEvents}
              </span>
              <button onClick={cityData.stopTimelapse} style={s.timelapseBtn}>Stop</button>
            </>
          ) : (
            <button onClick={() => cityData.startTimelapse()} style={s.timelapseBtn}>Timelapse</button>
          )}
          <span style={s.separator} />
          <span style={s.toolbarStat}>{currentSnapshot?.files.size ?? 0} files</span>
          <span style={s.separator} />
          <span style={s.toolbarStat}>{cityData.deps.length} deps</span>
          {cityData.isLive && <span style={s.liveDot} />}
        </div>
      </div>

      {/* Main area */}
      <div style={s.main}>
        <div style={s.canvas}>
          <CityScene
            layouts={layouts}
            previousPaths={previousPaths}
            activeEditing={cityData.activeEditing}
            activeSurveying={cityData.activeSurveying}
            deps={cityData.deps}
            onBuildingHover={onBuildingHover}
            onBuildingClick={setSelectedFile}
          />
        </div>

        {selectedFile && (
          <div style={s.rightPanel}>
            <FilePanel
              filePath={selectedFile}
              projectId={cityData.currentProjectId}
              onClose={() => setSelectedFile(null)}
              onNavigate={setSelectedFile}
              deps={cityData.deps}
            />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div style={s.statusBar}>
        <Timeline
          timeline={timeline}
          repoName={cityData.repoName}
          fileCount={currentSnapshot?.files.size ?? 0}
          isLive={cityData.isLive}
          connected={cityData.connected}
        />
      </div>

      {/* Hover tooltip */}
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
          </div>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    width: "100vw",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#18181b",
    overflow: "hidden",
  },
  toolbar: {
    height: 40,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 12px",
    background: "#111113",
    borderBottom: "1px solid #27272a",
  },
  toolbarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  toolbarRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  logo: {
    fontSize: 12,
    fontWeight: 700,
    color: "#00d4aa",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  repoName: {
    fontSize: 12,
    fontWeight: 600,
    color: "#d4d4d8",
  },
  separator: {
    width: 1,
    height: 16,
    background: "#27272a",
  },
  timelapseBtn: {
    fontSize: 10,
    fontWeight: 600,
    color: "#00d4aa",
    background: "transparent",
    border: "1px solid #27272a",
    borderRadius: 4,
    padding: "2px 8px",
    cursor: "pointer",
    fontFamily: "'SF Mono', 'Fira Code', monospace",
  },
  toolbarStat: {
    fontSize: 10,
    fontWeight: 500,
    color: "#71717a",
    fontFamily: "'SF Mono', 'Fira Code', monospace",
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#00d4aa",
    marginLeft: 4,
  },
  main: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
  },
  canvas: {
    flex: 1,
    minWidth: 0,
    position: "relative",
    background: "#09090b",
    overflow: "hidden",
  },
  rightPanel: {
    width: 420,
    flexShrink: 0,
    borderLeft: "1px solid #27272a",
    background: "#111113",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  statusBar: {
    height: 36,
    flexShrink: 0,
    borderTop: "1px solid #27272a",
    background: "#111113",
    display: "flex",
    alignItems: "center",
  },
  // Splash
  splashWrap: {
    width: "100vw",
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#18181b",
  },
  splashCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: 40,
    background: "#111113",
    border: "1px solid #27272a",
    borderRadius: 12,
    maxWidth: 400,
  },
  splashTitle: {
    fontSize: 24,
    fontWeight: 700,
    color: "#00d4aa",
    letterSpacing: 1,
  },
  splashSub: {
    fontSize: 13,
    color: "#71717a",
    marginTop: 4,
  },
  splashDivider: {
    width: "100%",
    height: 1,
    background: "#27272a",
    margin: "20px 0",
  },
  splashLabel: {
    fontSize: 11,
    color: "#a1a1aa",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: 600,
  },
  splashCode: {
    display: "block",
    padding: "10px 16px",
    background: "#09090b",
    border: "1px solid #27272a",
    borderRadius: 6,
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: 12,
    color: "#00d4aa",
  },
  splashHint: {
    fontSize: 11,
    color: "#52525b",
    marginTop: 12,
    textAlign: "center",
  },
  // Project list (splash mode)
  projectList: {
    width: "100%",
    maxHeight: 400,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  projectItem: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    padding: "8px 12px",
    background: "#09090b",
    border: "1px solid #27272a",
    borderRadius: 6,
    cursor: "pointer",
    textAlign: "left",
    gap: 2,
    transition: "background 0.15s, border-color 0.15s",
  },
  projectName: {
    fontSize: 12,
    fontWeight: 600,
    color: "#e4e4e7",
  },
  projectPath: {
    fontSize: 10,
    color: "#52525b",
    fontFamily: "'SF Mono', monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};

const tt = {
  card: {
    background: "rgba(17, 17, 19, 0.95)",
    border: "1px solid #27272a",
    borderRadius: 6,
    padding: "8px 12px",
    minWidth: 160,
    backdropFilter: "blur(12px)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    fontFamily: "'Inter', system-ui, sans-serif",
    color: "#e4e4e7",
  },
  header: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 } as const,
  badge: {
    padding: "1px 6px",
    borderRadius: 3,
    fontSize: 9,
    fontWeight: 700,
    color: "#fff",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  name: { fontSize: 12, fontWeight: 600, color: "#e4e4e7", wordBreak: "break-all" as const },
  folder: { fontSize: 10, color: "#71717a", marginBottom: 6, fontFamily: "'SF Mono', monospace" },
  stats: {
    display: "flex",
    gap: 12,
    borderTop: "1px solid #27272a",
    paddingTop: 6,
  },
  stat: { display: "flex", flexDirection: "column" as const, gap: 1 },
  statLabel: { fontSize: 9, color: "#52525b", textTransform: "uppercase" as const, letterSpacing: "0.5px", fontWeight: 600 },
  statValue: { fontSize: 11, fontWeight: 600, color: "#a1a1aa", fontFamily: "'SF Mono', monospace" },
};

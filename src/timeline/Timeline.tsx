import type { TimelineControls } from "../hooks/useTimeline";

interface TimelineProps {
  timeline: TimelineControls;
  repoName: string;
  fileCount: number;
  isLive: boolean;
  connected: boolean;
}

const SPEEDS = [1, 2, 5, 10, 20];

export function Timeline({
  timeline,
  repoName,
  fileCount,
  isLive,
  connected,
}: TimelineProps) {
  return (
    <div style={styles.container}>
      <div style={styles.top}>
        <div style={styles.info}>
          <span style={styles.repoName}>{repoName || "CodeCity"}</span>
          <span style={styles.dot(connected)} />
          <span style={styles.status}>
            {connected ? (isLive ? "LIVE" : "Connected") : "Disconnected"}
          </span>
          <span style={styles.fileCount}>{fileCount} files</span>
        </div>

        <div style={styles.controls}>
          <button onClick={timeline.toggle} style={styles.playBtn}>
            {timeline.isPlaying ? "⏸" : "▶"}
          </button>

          <input
            type="range"
            min={0}
            max={Math.max(0, timeline.totalFrames - 1)}
            value={timeline.currentIndex}
            onChange={(e) => timeline.seek(Number(e.target.value))}
            style={styles.slider}
          />

          <span style={styles.frame}>
            {timeline.currentIndex + 1} / {timeline.totalFrames}
          </span>

          <div style={styles.speedGroup}>
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => timeline.setSpeed(s)}
                style={styles.speedBtn(s === timeline.speed)}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    position: "absolute" as const,
    bottom: 0,
    left: 0,
    right: 0,
    padding: "12px 20px",
    background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
    pointerEvents: "auto" as const,
  },
  top: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "16px",
  },
  info: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: "#ccc",
    fontSize: "13px",
    flexShrink: 0,
  },
  repoName: {
    fontWeight: 700,
    color: "#fff",
    fontSize: "15px",
  },
  dot: (connected: boolean) => ({
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: connected ? "#4ade80" : "#ef4444",
    display: "inline-block",
  }),
  status: {
    fontSize: "11px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  fileCount: {
    color: "#888",
    marginLeft: "8px",
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flex: 1,
    justifyContent: "flex-end",
  },
  playBtn: {
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: "6px",
    color: "#fff",
    fontSize: "16px",
    width: "36px",
    height: "36px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  slider: {
    flex: 1,
    maxWidth: "300px",
    accentColor: "#3178c6",
    cursor: "pointer",
  },
  frame: {
    color: "#888",
    fontSize: "12px",
    fontFamily: "monospace",
    minWidth: "80px",
    textAlign: "right" as const,
  },
  speedGroup: {
    display: "flex",
    gap: "2px",
  },
  speedBtn: (active: boolean) => ({
    background: active ? "#3178c6" : "rgba(255,255,255,0.05)",
    border: "1px solid " + (active ? "#3178c6" : "rgba(255,255,255,0.15)"),
    borderRadius: "4px",
    color: active ? "#fff" : "#888",
    fontSize: "11px",
    padding: "4px 8px",
    cursor: "pointer",
  }),
};

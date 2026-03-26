import type { TimelineControls } from "../hooks/useTimeline";

interface TimelineProps {
  timeline: TimelineControls;
  repoName: string;
  fileCount: number;
  isLive: boolean;
  connected: boolean;
}

const SPEEDS = [1, 2, 5, 10];

export function Timeline({
  timeline,
  fileCount,
  isLive,
  connected,
}: TimelineProps) {
  return (
    <div style={s.bar}>
      <button onClick={timeline.toggle} style={s.playBtn}>
        {timeline.isPlaying ? "||" : "\u25B6"}
      </button>

      <input
        type="range"
        min={0}
        max={Math.max(0, timeline.totalFrames - 1)}
        value={timeline.currentIndex}
        onChange={(e) => timeline.seek(Number(e.target.value))}
        style={s.slider}
      />

      <span style={s.frame}>
        {timeline.currentIndex + 1}/{timeline.totalFrames}
      </span>

      <span style={s.sep} />

      <div style={s.speedGroup}>
        {SPEEDS.map((sp) => (
          <button
            key={sp}
            onClick={() => timeline.setSpeed(sp)}
            style={sp === timeline.speed ? { ...s.speedBtn, ...s.speedActive } : s.speedBtn}
          >
            {sp}x
          </button>
        ))}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    height: "100%",
    padding: "0 12px",
  },
  playBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    background: "transparent",
    border: "1px solid #27272a",
    borderRadius: 4,
    color: "#a1a1aa",
    fontSize: 10,
    cursor: "pointer",
    flexShrink: 0,
    fontFamily: "system-ui",
  },
  slider: {
    flex: 1,
    maxWidth: 280,
    height: 4,
    accentColor: "#00d4aa",
    cursor: "pointer",
  },
  frame: {
    fontSize: 10,
    fontWeight: 500,
    color: "#52525b",
    fontFamily: "'SF Mono', monospace",
    minWidth: 50,
    flexShrink: 0,
  },
  sep: {
    width: 1,
    height: 14,
    background: "#27272a",
    flexShrink: 0,
  },
  speedGroup: {
    display: "flex",
    gap: 1,
    flexShrink: 0,
  },
  speedBtn: {
    padding: "2px 6px",
    fontSize: 9,
    fontWeight: 600,
    color: "#52525b",
    background: "transparent",
    border: "1px solid #27272a",
    borderRadius: 3,
    cursor: "pointer",
    fontFamily: "'SF Mono', monospace",
  },
  speedActive: {
    color: "#00d4aa",
    borderColor: "#00d4aa",
    background: "rgba(0, 212, 170, 0.08)",
  },
};

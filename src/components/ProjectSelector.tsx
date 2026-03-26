import { useState, useRef, useEffect } from "react";

export interface Project {
  id: string;
  path: string;
  name: string;
}

interface ProjectSelectorProps {
  projects: Project[];
  currentId: string | null;
  onSelect: (id: string) => void;
}

export function ProjectSelector({ projects, currentId, onSelect }: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = projects.find((p) => p.id === currentId);
  const filtered = search
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.path.toLowerCase().includes(search.toLowerCase())
      )
    : projects;

  return (
    <div ref={ref} style={s.wrapper}>
      <button style={s.trigger} onClick={() => setOpen(!open)}>
        <span style={s.triggerName}>{current?.name ?? "Select project"}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
          <path d="M2.5 4L5 6.5L7.5 4" stroke="#71717a" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div style={s.dropdown}>
          <input
            style={s.search}
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div style={s.list}>
            {filtered.map((p) => (
              <button
                key={p.id}
                style={{
                  ...s.item,
                  ...(p.id === currentId ? s.itemActive : {}),
                }}
                onClick={() => {
                  onSelect(p.id);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <span style={s.itemName}>{p.name}</span>
                <span style={s.itemPath}>{shortenPath(p.path)}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div style={s.empty}>No projects found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function shortenPath(p: string): string {
  const home = "/Users/";
  if (p.startsWith(home)) {
    const rest = p.slice(home.length);
    const slash = rest.indexOf("/");
    if (slash !== -1) return "~" + rest.slice(slash);
  }
  return p;
}

const s: Record<string, React.CSSProperties> = {
  wrapper: {
    position: "relative",
  },
  trigger: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 8px",
    background: "transparent",
    border: "1px solid #27272a",
    borderRadius: 4,
    cursor: "pointer",
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    maxWidth: 200,
  },
  triggerName: {
    fontSize: 11,
    fontWeight: 600,
    color: "#d4d4d8",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  dropdown: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    width: 320,
    maxHeight: 400,
    background: "#111113",
    border: "1px solid #27272a",
    borderRadius: 8,
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    zIndex: 100,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  search: {
    padding: "8px 12px",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid #27272a",
    color: "#e4e4e7",
    fontSize: 11,
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    outline: "none",
  },
  list: {
    overflow: "auto",
    maxHeight: 340,
  },
  item: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    padding: "6px 12px",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid #1a1a1d",
    cursor: "pointer",
    textAlign: "left",
    gap: 1,
  },
  itemActive: {
    background: "#1a2a24",
  },
  itemName: {
    fontSize: 11,
    fontWeight: 600,
    color: "#e4e4e7",
  },
  itemPath: {
    fontSize: 9,
    color: "#52525b",
    fontFamily: "'SF Mono', monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: {
    padding: "16px 12px",
    textAlign: "center",
    color: "#52525b",
    fontSize: 11,
  },
};

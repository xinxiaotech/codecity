import { useState, useEffect } from "react";
import { File, MultiFileDiff } from "@pierre/diffs/react";
import type { FileContents } from "@pierre/diffs/react";

interface FilePanelProps {
  filePath: string;
  projectId?: string | null;
  onClose: () => void;
  onNavigate: (path: string) => void;
  deps: { from: string; to: string }[];
}

export function FilePanel({ filePath, projectId, onClose, onNavigate, deps }: FilePanelProps) {
  const [fileData, setFileData] = useState<FileContents | null>(null);
  const [prevData, setPrevData] = useState<FileContents | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [hasDiff, setHasDiff] = useState(false);

  // Find connected files (imports and imported-by)
  const imports = deps.filter((d) => d.from === filePath).map((d) => d.to);
  const importedBy = deps.filter((d) => d.to === filePath).map((d) => d.from);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setPrevData(null);
    setShowDiff(false);
    setHasDiff(false);

    const projectParam = projectId ? `&project=${encodeURIComponent(projectId)}` : "";
    fetch(`http://localhost:3001/api/file?path=${encodeURIComponent(filePath)}${projectParam}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setFileData({ name: filePath, contents: data.content });
          if (data.previous && data.previous !== data.content) {
            setPrevData({ name: filePath, contents: data.previous });
            setHasDiff(true);
            setShowDiff(true);
          }
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [filePath]);

  const ext = filePath.split(".").pop() ?? "";
  const fileName = filePath.split("/").pop() ?? filePath;
  const lineCount = fileData?.contents.split("\n").length ?? 0;

  return (
    <>
      {/* Panel header */}
      <div style={s.header}>
        <div style={s.headerInfo}>
          <div style={s.fileName}>{fileName}</div>
          <div style={s.fileMeta}>{filePath}</div>
        </div>
        <button style={s.closeBtn} onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="#71717a" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        <button
          style={{ ...s.tab, ...(!showDiff ? s.tabActive : {}) }}
          onClick={() => setShowDiff(false)}
        >
          Source
        </button>
        {hasDiff && (
          <button
            style={{ ...s.tab, ...(showDiff ? s.tabActive : {}) }}
            onClick={() => setShowDiff(true)}
          >
            Diff
          </button>
        )}
        <div style={s.tabFill} />
        <span style={s.tabMeta}>.{ext} · {lineCount} lines</span>
      </div>

      {/* Content */}
      <div style={s.content}>
        {loading && <div style={s.message}>Loading...</div>}
        {error && <div style={s.message}>Error: {error}</div>}
        {!loading && !error && fileData && !showDiff && (
          <File file={fileData} options={{ theme: "github-dark" }} style={diffsStyle} />
        )}
        {!loading && !error && showDiff && prevData && fileData && (
          <MultiFileDiff oldFile={prevData} newFile={fileData} options={{ theme: "github-dark" }} style={diffsStyle} />
        )}
      </div>

      {/* Dependencies section */}
      {(imports.length > 0 || importedBy.length > 0) && (
        <div style={s.depsSection}>
          <div style={s.depsSectionTitle}>Dependencies</div>
          {imports.length > 0 && (
            <div style={s.depsGroup}>
              <div style={s.depsLabel}>Imports ({imports.length})</div>
              {imports.map((p) => (
                <button key={p} style={s.depItem} onClick={() => onNavigate(p)}>
                  {p.split("/").pop()}
                  <span style={s.depPath}>{p}</span>
                </button>
              ))}
            </div>
          )}
          {importedBy.length > 0 && (
            <div style={s.depsGroup}>
              <div style={s.depsLabel}>Imported by ({importedBy.length})</div>
              {importedBy.map((p) => (
                <button key={p} style={s.depItem} onClick={() => onNavigate(p)}>
                  {p.split("/").pop()}
                  <span style={s.depPath}>{p}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

const diffsStyle = {
  "--diffs-font-family": "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
  "--diffs-font-size": "11px",
  "--diffs-line-height": "1.5",
  "--diffs-tab-size": "2",
} as React.CSSProperties;

const s: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderBottom: "1px solid #27272a",
    flexShrink: 0,
  },
  headerInfo: {
    overflow: "hidden",
    flex: 1,
  },
  fileName: {
    fontSize: 12,
    fontWeight: 600,
    color: "#e4e4e7",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  fileMeta: {
    fontSize: 10,
    color: "#52525b",
    fontFamily: "'SF Mono', monospace",
    marginTop: 2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  closeBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    border: "1px solid #27272a",
    borderRadius: 4,
    background: "transparent",
    cursor: "pointer",
    flexShrink: 0,
    marginLeft: 8,
  },
  tabs: {
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    gap: 2,
    borderBottom: "1px solid #27272a",
    flexShrink: 0,
  },
  tab: {
    padding: "6px 10px",
    fontSize: 10,
    fontWeight: 600,
    color: "#71717a",
    background: "transparent",
    border: "none",
    borderBottom: "2px solid transparent",
    cursor: "pointer",
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  tabActive: {
    color: "#00d4aa",
    borderBottomColor: "#00d4aa",
  },
  tabFill: { flex: 1 },
  tabMeta: {
    fontSize: 10,
    color: "#3f3f46",
    fontFamily: "'SF Mono', monospace",
  },
  content: {
    flex: 1,
    overflow: "auto",
    fontSize: 12,
  },
  message: {
    padding: 24,
    textAlign: "center",
    color: "#52525b",
    fontSize: 12,
  },
  depsSection: {
    flexShrink: 0,
    borderTop: "1px solid #27272a",
    maxHeight: 180,
    overflow: "auto",
  },
  depsSectionTitle: {
    fontSize: 9,
    fontWeight: 600,
    color: "#52525b",
    textTransform: "uppercase",
    letterSpacing: 1,
    padding: "8px 12px 4px",
  },
  depsGroup: {
    padding: "0 12px 8px",
  },
  depsLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: "#71717a",
    marginBottom: 4,
  },
  depItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    padding: "3px 6px",
    fontSize: 10,
    fontWeight: 500,
    color: "#a1a1aa",
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 3,
    cursor: "pointer",
    fontFamily: "'SF Mono', monospace",
    textAlign: "left" as const,
  },
  depPath: {
    fontSize: 9,
    color: "#3f3f46",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  },
};

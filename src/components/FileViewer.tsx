import { useState, useEffect, useCallback } from "react";
import { File, MultiFileDiff } from "@pierre/diffs/react";
import type { FileContents } from "@pierre/diffs/react";

interface FileViewerProps {
  filePath: string;
  onClose: () => void;
}

export function FileViewer({ filePath, onClose }: FileViewerProps) {
  const [fileData, setFileData] = useState<FileContents | null>(null);
  const [prevData, setPrevData] = useState<FileContents | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [hasDiff, setHasDiff] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setPrevData(null);
    setShowDiff(false);
    setHasDiff(false);

    fetch(`http://localhost:3001/api/file?path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          const current: FileContents = { name: filePath, contents: data.content };
          setFileData(current);

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

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const ext = filePath.split(".").pop() ?? "";
  const lineCount = fileData?.contents.split("\n").length ?? 0;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={styles.filePath}>{filePath}</span>
            {hasDiff && (
              <div style={styles.tabs}>
                <button
                  style={{ ...styles.tab, ...(!showDiff ? styles.tabActive : {}) }}
                  onClick={() => setShowDiff(false)}
                >
                  Source
                </button>
                <button
                  style={{ ...styles.tab, ...(showDiff ? styles.tabActive : {}) }}
                  onClick={() => setShowDiff(true)}
                >
                  Diff
                </button>
              </div>
            )}
          </div>
          <button style={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={styles.content}>
          {loading && <div style={styles.message}>Loading...</div>}
          {error && <div style={styles.message}>Error: {error}</div>}
          {!loading && !error && fileData && !showDiff && (
            <File
              file={fileData}
              options={{ theme: "github-dark" }}
            />
          )}
          {!loading && !error && showDiff && prevData && fileData && (
            <MultiFileDiff
              oldFile={prevData}
              newFile={fileData}
              options={{ theme: "github-dark" }}
            />
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <span style={styles.footerInfo}>
            .{ext} · {lineCount} lines
          </span>
          <span style={styles.footerHint}>ESC to close</span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
    backdropFilter: "blur(4px)",
  },
  panel: {
    width: "80vw",
    maxWidth: "1000px",
    height: "80vh",
    background: "#1a1e2e",
    borderRadius: "12px",
    border: "1px solid rgba(100,160,255,0.2)",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderBottom: "1px solid rgba(100,160,255,0.15)",
    background: "#141822",
    flexShrink: 0,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    overflow: "hidden",
  },
  filePath: {
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: "13px",
    color: "#8cb4ff",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  tabs: {
    display: "flex",
    gap: "4px",
  },
  tab: {
    padding: "4px 12px",
    borderRadius: "4px",
    border: "1px solid rgba(100,160,255,0.15)",
    background: "transparent",
    color: "#6a7a90",
    fontSize: "12px",
    cursor: "pointer",
    fontFamily: "system-ui",
  },
  tabActive: {
    background: "rgba(100,160,255,0.15)",
    color: "#8cb4ff",
    borderColor: "rgba(100,160,255,0.3)",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#6a7a90",
    fontSize: "18px",
    cursor: "pointer",
    padding: "4px 8px",
    borderRadius: "4px",
    flexShrink: 0,
  },
  content: {
    flex: 1,
    overflow: "auto",
    fontSize: "13px",
  },
  message: {
    padding: "40px",
    textAlign: "center",
    color: "#6a7a90",
    fontSize: "14px",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 16px",
    borderTop: "1px solid rgba(100,160,255,0.15)",
    background: "#141822",
    flexShrink: 0,
  },
  footerInfo: {
    fontSize: "12px",
    color: "#6a7a90",
    fontFamily: "'SF Mono', monospace",
  },
  footerHint: {
    fontSize: "12px",
    color: "#4a5a70",
  },
};

import { useState, useEffect, useRef, useCallback } from "react";
import type { FileEvent } from "../types";

export interface CitySnapshot {
  files: Map<string, number>;
  timestamp: number;
}

export interface DepEdge {
  from: string;
  to: string;
}

export interface CityData {
  repoName: string;
  snapshots: CitySnapshot[];
  isLive: boolean;
  connected: boolean;
  activeEditing: Set<string>;
  activeSurveying: Set<string>;
  deps: DepEdge[];
}

const WS_URL = "ws://localhost:3001";

export function useCityData(): CityData {
  const [repoName, setRepoName] = useState("");
  const [snapshots, setSnapshots] = useState<CitySnapshot[]>([]);
  const [connected, setConnected] = useState(false);
  const [activeEditing, setActiveEditing] = useState<Set<string>>(new Set());
  const [activeSurveying, setActiveSurveying] = useState<Set<string>>(new Set());
  const [deps, setDeps] = useState<DepEdge[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const currentFilesRef = useRef<Map<string, number>>(new Map());
  const editTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const surveyTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const addSnapshot = useCallback((files: Map<string, number>, timestamp: number) => {
    const copy = new Map(files);
    setSnapshots((prev) => [...prev, { files: copy, timestamp }]);
  }, []);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        console.log("Connected to CodeCity server");
      };

      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);

        if (data.type === "snapshot") {
          // Initial snapshot from server
          setRepoName(data.repoName);
          const files = new Map<string, number>();
          for (const f of data.files) {
            files.set(f.path, f.lines);
          }
          currentFilesRef.current = files;
          addSnapshot(files, 0);
        } else if (data.type === "hook") {
          const hookPath = data.path as string;
          const action = data.action as string;
          if (hookPath && action === "read") {
            // Mark file as being surveyed/read
            const existing = surveyTimersRef.current.get(hookPath);
            if (existing) clearTimeout(existing);

            setActiveSurveying((prev) => {
              const next = new Set(prev);
              next.add(hookPath);
              return next;
            });

            const timer = setTimeout(() => {
              setActiveSurveying((prev) => {
                const next = new Set(prev);
                next.delete(hookPath);
                return next;
              });
              surveyTimersRef.current.delete(hookPath);
            }, 5000);
            surveyTimersRef.current.set(hookPath, timer);
          } else if (hookPath) {
            // Mark file as actively being edited
            const existing = editTimersRef.current.get(hookPath);
            if (existing) clearTimeout(existing);

            setActiveEditing((prev) => {
              const next = new Set(prev);
              next.add(hookPath);
              return next;
            });

            const timer = setTimeout(() => {
              setActiveEditing((prev) => {
                const next = new Set(prev);
                next.delete(hookPath);
                return next;
              });
              editTimersRef.current.delete(hookPath);
            }, 8000);
            editTimersRef.current.set(hookPath, timer);
          }
        } else if (data.type === "deps") {
          setDeps(data.edges as DepEdge[]);
        } else if (data.type === "event") {
          const event = data.event as FileEvent;
          const files = currentFilesRef.current;

          if (event.type === "unlink") {
            files.delete(event.path);
          } else {
            files.set(event.path, event.lines);
          }
          currentFilesRef.current = files;
          addSnapshot(files, event.timestamp);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        // Reconnect after 2s
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [addSnapshot]);

  return {
    repoName,
    snapshots,
    isLive: connected,
    connected,
    activeEditing,
    activeSurveying,
    deps,
  };
}

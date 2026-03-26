import { useState, useEffect, useRef } from "react";
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
const BATCH_INTERVAL_MS = 60;

export function useCityData(): CityData {
  const [repoName, setRepoName] = useState("");
  const [snapshots, setSnapshots] = useState<CitySnapshot[]>([]);
  const [connected, setConnected] = useState(false);
  const [activeEditing, setActiveEditing] = useState<Set<string>>(new Set());
  const [activeSurveying, setActiveSurveying] = useState<Set<string>>(new Set());
  const [deps, setDeps] = useState<DepEdge[]>([]);

  const currentFilesRef = useRef<Map<string, number>>(new Map());
  const editTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const surveyTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingEventsRef = useRef<FileEvent[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Single effect with [] deps — stable, never re-runs, no leaked connections
  useEffect(() => {
    let alive = true; // guard against StrictMode double-mount
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let ws: WebSocket | null = null;

    function flushEvents() {
      batchTimerRef.current = null;
      const events = pendingEventsRef.current;
      if (events.length === 0) return;
      pendingEventsRef.current = [];

      const files = currentFilesRef.current;
      let lastTimestamp = 0;
      for (const event of events) {
        if (event.type === "unlink") {
          files.delete(event.path);
        } else {
          files.set(event.path, event.lines);
        }
        lastTimestamp = event.timestamp;
      }

      const copy = new Map(files);
      setSnapshots((prev) => [...prev, { files: copy, timestamp: lastTimestamp }]);
    }

    function enqueueEvent(event: FileEvent) {
      pendingEventsRef.current.push(event);
      if (batchTimerRef.current === null) {
        batchTimerRef.current = setTimeout(flushEvents, BATCH_INTERVAL_MS);
      }
    }

    function connect() {
      if (!alive) return;
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);

        if (data.type === "snapshot") {
          setRepoName(data.repoName);
          const files = new Map<string, number>();
          for (const f of data.files) {
            files.set(f.path, f.lines);
          }
          currentFilesRef.current = files;
          const copy = new Map(files);
          setSnapshots((prev) => [...prev, { files: copy, timestamp: 0 }]);
        } else if (data.type === "hook") {
          const hookPath = data.path as string;
          const action = data.action as string;
          if (hookPath && action === "read") {
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
          enqueueEvent(data.event as FileEvent);
        } else if (data.type === "events") {
          for (const event of data.events as FileEvent[]) {
            enqueueEvent(event);
          }
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (alive) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      if (batchTimerRef.current !== null) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      flushEvents();
      ws?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

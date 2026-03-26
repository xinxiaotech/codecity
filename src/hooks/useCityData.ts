import { useState, useEffect, useRef, useCallback } from "react";
import type { FileEvent } from "../types";
import type { Project } from "../components/ProjectSelector";

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
  projects: Project[];
  currentProjectId: string | null;
  switchProject: (projectId: string) => void;
  timelapse: {
    playing: boolean;
    progress: number;
    totalEvents: number;
    currentEvent: number;
  };
  startTimelapse: (speed?: number) => void;
  stopTimelapse: () => void;
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);

  const currentFilesRef = useRef<Map<string, number>>(new Map());
  const editTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const surveyTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingEventsRef = useRef<FileEvent[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Timelapse state
  const [timelapsePlaying, setTimelapsePlaying] = useState(false);
  const [timelapseProgress, setTimelapseProgress] = useState(0);
  const [timelapseTotalEvents, setTimelapseTotalEvents] = useState(0);
  const [timelapseCurrentEvent, setTimelapseCurrentEvent] = useState(0);
  const timelapseAbortRef = useRef(false);

  const projectIdRef = useRef<string | null>(null);

  const switchProject = useCallback((projectId: string) => {
    projectIdRef.current = projectId;
    setCurrentProjectId(projectId);

    // Reset state for new project
    setSnapshots([]);
    setDeps([]);
    setActiveEditing(new Set());
    setActiveSurveying(new Set());
    setRepoName("");
    currentFilesRef.current = new Map();
    pendingEventsRef.current = [];

    // Clear all timers
    for (const timer of editTimersRef.current.values()) clearTimeout(timer);
    for (const timer of surveyTimersRef.current.values()) clearTimeout(timer);
    editTimersRef.current.clear();
    surveyTimersRef.current.clear();

    // Send subscribe message — only if socket is actually open
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "subscribe", project: projectId }));
    }
    // Otherwise, the onopen handler will re-subscribe using projectIdRef
  }, []);

  // Save pre-timelapse state so we can restore after
  const preTimelapseRef = useRef<{
    files: Map<string, number>;
    snapshots: CitySnapshot[];
    repoName: string;
  } | null>(null);

  const startTimelapse = useCallback(async (speed = 20) => {
    const pid = projectIdRef.current;
    const projectParam = pid ? `?project=${encodeURIComponent(pid)}` : "";
    try {
      const res = await fetch(`http://localhost:3001/api/timelapse${projectParam}`);
      const data = await res.json();
      if (!data.events || data.events.length === 0) return;

      // Save current state to restore later
      preTimelapseRef.current = {
        files: new Map(currentFilesRef.current),
        snapshots: [],  // We'll restore from live data on stop
        repoName: data.repoName || "",
      };

      setTimelapsePlaying(true);
      setTimelapseTotalEvents(data.events.length);
      setTimelapseCurrentEvent(0);
      timelapseAbortRef.current = false;

      const allEvents = data.events as Array<{ action: string; path: string; timestamp: number }>;
      const fileLines: Record<string, number> = data.fileLines || {};

      // Filter to only create/edit/delete events — skip reads
      const events = allEvents.filter(
        (e) => e.action === "created" || e.action === "modified" || e.action === "deleted"
      );
      if (events.length === 0) return;

      const startTs = events[0].timestamp;
      const endTs = events[events.length - 1].timestamp;
      const totalSpan = Math.max(1, endTs - startTs);

      setTimelapseTotalEvents(events.length);

      // Start from empty ground
      const progressiveFiles = new Map<string, number>();
      currentFilesRef.current = progressiveFiles;
      setSnapshots([{ files: new Map(), timestamp: 0 }]);

      for (let i = 0; i < events.length; i++) {
        if (timelapseAbortRef.current) break;

        const evt = events[i];
        setTimelapseCurrentEvent(i + 1);
        setTimelapseProgress((evt.timestamp - startTs) / totalSpan);

        if (evt.action === "deleted") {
          progressiveFiles.delete(evt.path);
          const copy = new Map(progressiveFiles);
          setSnapshots((prev) => [...prev, { files: copy, timestamp: evt.timestamp }]);
        } else {
          // created or modified — add/update building
          const lines = fileLines[evt.path] || 10;
          progressiveFiles.set(evt.path, lines);
          const copy = new Map(progressiveFiles);
          setSnapshots((prev) => [...prev, { files: copy, timestamp: evt.timestamp }]);

          // Show brief construction effect
          setActiveEditing((prev) => {
            const next = new Set(prev);
            next.add(evt.path);
            return next;
          });
          setTimeout(() => {
            setActiveEditing((prev) => {
              const next = new Set(prev);
              next.delete(evt.path);
              return next;
            });
          }, 500);
        }

        // Delay between events
        if (i < events.length - 1) {
          const gap = events[i + 1].timestamp - evt.timestamp;
          const delay = Math.min(500, Math.max(30, gap / speed));
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      // Timelapse complete — restore to full live state
      if (preTimelapseRef.current) {
        currentFilesRef.current = preTimelapseRef.current.files;
        const copy = new Map(preTimelapseRef.current.files);
        setSnapshots((prev) => [...prev, { files: copy, timestamp: Date.now() }]);
        preTimelapseRef.current = null;
      }

      setTimelapsePlaying(false);
    } catch {
      // Restore state on error
      if (preTimelapseRef.current) {
        currentFilesRef.current = preTimelapseRef.current.files;
        const copy = new Map(preTimelapseRef.current.files);
        setSnapshots([{ files: copy, timestamp: Date.now() }]);
        preTimelapseRef.current = null;
      }
      setTimelapsePlaying(false);
    }
  }, []);

  const stopTimelapse = useCallback(() => {
    timelapseAbortRef.current = true;
    setTimelapsePlaying(false);
    // Restore live state immediately
    if (preTimelapseRef.current) {
      currentFilesRef.current = preTimelapseRef.current.files;
      const copy = new Map(preTimelapseRef.current.files);
      setSnapshots((prev) => [...prev, { files: copy, timestamp: Date.now() }]);
      preTimelapseRef.current = null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
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
        if (!alive) { ws?.close(); return; }
        wsRef.current = ws;
        setConnected(true);
        // Re-subscribe to current project on reconnect
        const pid = projectIdRef.current;
        if (pid && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "subscribe", project: pid }));
        }
      };

      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);

        if (data.type === "projects") {
          setProjects(data.projects as Project[]);
        } else if (data.type === "snapshot") {
          setRepoName(data.repoName);
          const files = new Map<string, number>();
          for (const f of data.files) {
            files.set(f.path, f.lines);
          }
          currentFilesRef.current = files;
          const copy = new Map(files);
          setSnapshots((prev) => [...prev, { files: copy, timestamp: 0 }]);

          // Auto-detect project ID from CLI mode (server auto-subscribed us)
          if (!projectIdRef.current) {
            // We got a snapshot without subscribing — server is in CLI mode
            // Try to find matching project in list
          }
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
        if (wsRef.current === ws) wsRef.current = null;
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
      wsRef.current = null;
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
    projects,
    currentProjectId,
    switchProject,
    timelapse: {
      playing: timelapsePlaying,
      progress: timelapseProgress,
      totalEvents: timelapseTotalEvents,
      currentEvent: timelapseCurrentEvent,
    },
    startTimelapse,
    stopTimelapse,
  };
}

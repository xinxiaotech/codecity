import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import chokidar from "chokidar";
import ignore, { type Ignore } from "ignore";

const targetDir = process.argv[2];
if (!targetDir) {
  console.error("Usage: npx tsx server/index.ts <directory-to-watch>");
  process.exit(1);
}

const resolvedDir = path.resolve(targetDir);
if (!fs.existsSync(resolvedDir)) {
  console.error(`Directory not found: ${resolvedDir}`);
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3001;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const fileLines = new Map<string, number>();
const MAX_EVENTS = 10_000;
const events: Array<{
  type: string;
  path: string;
  lines: number;
  timestamp: number;
}> = [];
const startTime = Date.now();
const clients = new Set<WebSocket>();

// ---------------------------------------------------------------------------
// .gitignore support — load from target directory root
// ---------------------------------------------------------------------------
const ALWAYS_IGNORED_DIRS = new Set([
  "node_modules", ".git", "__pycache__", ".next", ".cache", ".turbo",
  ".wrangler", ".vercel", ".netlify", ".serverless",
  ".expo", ".kotlin", ".metro-health-check",
  "Pods", // CocoaPods
]);
const ALWAYS_IGNORED_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", ".DS_Store",
]);

// Load .gitignore from root AND subdirectories (up to depth 3)
let ig: Ignore = ignore();
let gitignoreCount = 0;
function loadGitignores(dir: string, depth: number) {
  if (depth > 3) return;
  const giPath = path.join(dir, ".gitignore");
  if (fs.existsSync(giPath)) {
    try {
      const raw = fs.readFileSync(giPath, "utf-8");
      const rel = path.relative(resolvedDir, dir);
      const lines = raw.split("\n").filter(l => l.trim() && !l.startsWith("#"));
      // Prefix patterns with the subdirectory path
      if (rel) {
        ig.add(lines.map(l => {
          // Handle negation patterns
          if (l.startsWith("!")) return "!" + rel.replace(/\\/g, "/") + "/" + l.slice(1);
          // Handle absolute patterns (leading /)
          const pattern = l.startsWith("/") ? l.slice(1) : l;
          return rel.replace(/\\/g, "/") + "/" + pattern;
        }));
      } else {
        ig.add(raw);
      }
      gitignoreCount += lines.length;
    } catch { /* skip unreadable */ }
  }
  // Scan subdirs (skip ignored ones)
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (ALWAYS_IGNORED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      loadGitignores(path.join(dir, entry.name), depth + 1);
    }
  } catch { /* skip unreadable dirs */ }
}
loadGitignores(resolvedDir, 0);
// Always add common junk dirs so they're skipped even without a .gitignore
ig.add(["node_modules", ".git", "__pycache__", ".expo"]);
if (gitignoreCount > 0) {
  console.log(`  Loaded .gitignore rules (${gitignoreCount} rules)`);
}

function shouldIgnore(filePath: string): boolean {
  const rel = path.relative(resolvedDir, filePath);
  // Empty rel means this IS the watched root — don't ignore it
  if (rel === "") return false;
  if (rel.startsWith("..")) return true;
  // Fast check for always-ignored dirs/files
  const parts = rel.split(path.sep);
  for (const part of parts) {
    if (ALWAYS_IGNORED_DIRS.has(part)) return true;
    if (ALWAYS_IGNORED_FILES.has(part)) return true;
  }
  // Check .gitignore patterns
  const normalized = rel.replace(/\\/g, "/");
  try {
    if (ig.ignores(normalized)) return true;
  } catch { /* ignore edge cases */ }
  return false;
}

// ---------------------------------------------------------------------------
// File stat cache — caches stat results for 5 seconds
// ---------------------------------------------------------------------------
const FILE_STAT_TTL = 5_000;
const statCache = new Map<string, { size: number; ts: number }>();

function fileSize(filePath: string): number {
  const now = Date.now();
  const cached = statCache.get(filePath);
  if (cached && now - cached.ts < FILE_STAT_TTL) {
    return cached.size;
  }
  try {
    const size = fs.statSync(filePath).size;
    statCache.set(filePath, { size, ts: now });
    return size;
  } catch {
    statCache.set(filePath, { size: Infinity, ts: now });
    return Infinity;
  }
}

// Invalidate stat cache for a specific file (called on change/unlink)
function invalidateStatCache(filePath: string) {
  statCache.delete(filePath);
}

// ---------------------------------------------------------------------------
// File classification
// ---------------------------------------------------------------------------
const MAX_FILE_SIZE = 1_000_000; // 1 MB

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".bmp", ".webp",
  ".svg", ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".flac", ".aac",
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
  ".sqlite", ".sqlite-shm", ".sqlite-wal", ".db", ".wasm",
]);

const STATIC_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".bmp", ".webp", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm",
]);

const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".java", ".rb", ".php",
  ".c", ".cpp", ".h", ".hpp", ".swift", ".kt",
  ".css", ".scss", ".less", ".html", ".vue", ".svelte",
  ".sh", ".bash", ".zsh", ".sql",
]);

function isBinaryFile(filePath: string): boolean {
  return BINARY_EXTS.has(path.extname(filePath).toLowerCase());
}

function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTS.has(path.extname(filePath).toLowerCase());
}

// Count lines by streaming through a buffer — no giant string allocation
function countLines(filePath: string): number {
  try {
    const size = fileSize(filePath);
    if (size > MAX_FILE_SIZE || size === 0) return 0;
    const buf = fs.readFileSync(filePath);
    let count = 1;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

// Only extract imports from source files (not JSON, markdown, etc.)
function extractImports(absPath: string): string[] {
  if (!isSourceFile(absPath)) return [];
  try {
    const size = fileSize(absPath);
    if (size > MAX_FILE_SIZE) return [];
    const content = fs.readFileSync(absPath, "utf-8");
    const imports: string[] = [];
    const dir = path.dirname(absPath);

    const patterns = [
      /(?:import|export)\s+.*?from\s+['"]([^'"]+)['"]/g,
      /import\s+['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const specifier = match[1];
        if (!specifier.startsWith(".")) continue;
        const resolved = resolveImport(dir, specifier);
        if (resolved) {
          const rel = path.relative(resolvedDir, resolved).replace(/\\/g, "/");
          if (!shouldIgnore(resolved)) {
            imports.push(rel);
          }
        }
      }
    }
    return [...new Set(imports)];
  } catch {
    return [];
  }
}

function resolveImport(fromDir: string, specifier: string): string | null {
  const base = path.resolve(fromDir, specifier);
  // Try exact match first
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  // Try common extensions
  const exts = [".ts", ".tsx", ".js", ".jsx", ".json", ".css"];
  for (const ext of exts) {
    const p = base + ext;
    if (fs.existsSync(p)) return p;
  }
  // Try index files
  for (const ext of exts) {
    const p = path.join(base, "index" + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dependency graph: source -> [targets] — with cached edge array
// ---------------------------------------------------------------------------
const fileDeps = new Map<string, string[]>();
let depsDirty = true;
let cachedDepsArray: Array<{ from: string; to: string }> | null = null;

function updateDeps(absPath: string, rel: string) {
  const imports = extractImports(absPath);
  fileDeps.set(rel, imports);
  depsDirty = true;
}

function removeDeps(rel: string) {
  fileDeps.delete(rel);
  depsDirty = true;
}

function getDepsArray(): Array<{ from: string; to: string }> {
  if (!depsDirty && cachedDepsArray) return cachedDepsArray;
  const edges: Array<{ from: string; to: string }> = [];
  for (const [from, targets] of fileDeps) {
    for (const to of targets) {
      edges.push({ from, to });
    }
  }
  cachedDepsArray = edges;
  depsDirty = false;
  return edges;
}

// Check if file should be tracked (text files only, skip binaries)
function isTrackableFile(filePath: string): boolean {
  return !isBinaryFile(filePath);
}

// Get relative path
function relPath(absPath: string): string {
  return path.relative(resolvedDir, absPath).replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Batched event broadcasting
// ---------------------------------------------------------------------------
let eventQueue: Array<unknown> = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

function getBatchInterval(): number {
  return ready ? 50 : 200;
}

function flushEventQueue() {
  batchTimer = null;
  if (eventQueue.length === 0) return;
  const batch = eventQueue;
  eventQueue = [];
  const msg = JSON.stringify({ type: "events", events: batch });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

function queueBroadcast(data: unknown) {
  eventQueue.push(data);
  if (!batchTimer) {
    batchTimer = setTimeout(flushEventQueue, getBatchInterval());
  }
}

// Broadcast immediately (for non-event messages like snapshot, deps, hook)
function broadcast(data: unknown) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// ---------------------------------------------------------------------------
// Cap events array at MAX_EVENTS
// ---------------------------------------------------------------------------
function pushEvent(event: { type: string; path: string; lines: number; timestamp: number }) {
  events.push(event);
  if (events.length > MAX_EVENTS) {
    // Drop oldest entries to get back to the limit
    const overflow = events.length - MAX_EVENTS;
    events.splice(0, overflow);
  }
}

// Debounced deps broadcast — avoid flooding during initial scan
let depsTimer: ReturnType<typeof setTimeout> | null = null;
function broadcastDepsDebounced() {
  if (depsTimer) clearTimeout(depsTimer);
  depsTimer = setTimeout(() => {
    broadcast({ type: "deps", edges: getDepsArray() });
    depsTimer = null;
  }, ready ? 100 : 500);
}

let ready = false;

// ---------------------------------------------------------------------------
// File watcher
// ---------------------------------------------------------------------------
const watcher = chokidar.watch(resolvedDir, {
  ignored: (filePath: string) => shouldIgnore(filePath),
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
});

watcher.on("add", (absPath) => {
  if (!isTrackableFile(absPath) || fileSize(absPath) > MAX_FILE_SIZE) return;
  const rel = relPath(absPath);
  const lines = countLines(absPath);
  fileLines.set(rel, lines);
  updateDeps(absPath, rel);
  const event = { type: "add", path: rel, lines, timestamp: Date.now() - startTime };
  pushEvent(event);
  queueBroadcast(event);
  broadcastDepsDebounced();
});

watcher.on("change", (absPath) => {
  // Invalidate stat cache on change so we get fresh size
  invalidateStatCache(absPath);
  if (!isTrackableFile(absPath) || fileSize(absPath) > MAX_FILE_SIZE) return;
  const rel = relPath(absPath);
  const lines = countLines(absPath);
  fileLines.set(rel, lines);
  updateDeps(absPath, rel);
  const event = { type: "change", path: rel, lines, timestamp: Date.now() - startTime };
  pushEvent(event);
  queueBroadcast(event);
  broadcastDepsDebounced();
});

watcher.on("unlink", (absPath) => {
  invalidateStatCache(absPath);
  const rel = relPath(absPath);
  fileLines.delete(rel);
  removeDeps(rel);
  const event = { type: "unlink", path: rel, lines: 0, timestamp: Date.now() - startTime };
  pushEvent(event);
  queueBroadcast(event);
  broadcastDepsDebounced();
});

watcher.on("ready", () => {
  ready = true;
  // Log after a brief delay so awaitWriteFinish files settle
  setTimeout(() => {
    console.log(`  Indexed ${fileLines.size} files`);
  }, 1000);
});

// ---------------------------------------------------------------------------
// HTTP server for REST endpoints
// ---------------------------------------------------------------------------
const server = createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/api/snapshot") {
    const MAX_BUILDINGS = 100;

    // Build folder tree to detect large folders
    const allFiles = Array.from(fileLines.entries());
    const totalFiles = allFiles.length;

    if (totalFiles <= MAX_BUILDINGS) {
      // Small project — no collapsing needed
      const files = allFiles.map(([p, lines]) => ({ path: p, lines }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ repoName: path.basename(resolvedDir), files }));
      return;
    }

    // Count direct children per folder (files + subdirs)
    const folderChildCount = new Map<string, number>();
    const folderTotalLines = new Map<string, number>();
    for (const [filePath, lines] of allFiles) {
      const parts = filePath.split("/");
      // Count this file toward each ancestor folder
      for (let i = 1; i <= parts.length - 1; i++) {
        const folder = parts.slice(0, i).join("/");
        folderTotalLines.set(folder, (folderTotalLines.get(folder) || 0) + lines);
      }
      // Direct parent gets a child count
      if (parts.length > 1) {
        const parent = parts.slice(0, -1).join("/");
        folderChildCount.set(parent, (folderChildCount.get(parent) || 0) + 1);
      }
    }

    // Progressively collapse largest folders until under MAX_BUILDINGS
    // Sort folders by child count descending — collapse biggest first
    const foldersToCollapse = new Set<string>();
    const sortedFolders = [...folderChildCount.entries()]
      .filter(([, count]) => count >= 2) // only collapse folders with 2+ files
      .sort((a, b) => b[1] - a[1]); // biggest first

    let currentBuildingCount = totalFiles;
    for (const [folder, childCount] of sortedFolders) {
      if (currentBuildingCount <= MAX_BUILDINGS) break;
      // Skip if a parent folder is already collapsed
      let parentCollapsed = false;
      for (const cf of foldersToCollapse) {
        if (folder.startsWith(cf + "/")) { parentCollapsed = true; break; }
      }
      if (parentCollapsed) continue;
      foldersToCollapse.add(folder);
      currentBuildingCount -= (childCount - 1);
    }

    // Build output: collapsed folders become single entries, other files pass through
    const result: Array<{ path: string; lines: number }> = [];
    const collapsed = new Set<string>();

    for (const [filePath, lines] of allFiles) {
      // Check if this file is inside a collapsed folder
      let isCollapsed = false;
      for (const folder of foldersToCollapse) {
        if (filePath.startsWith(folder + "/")) {
          if (!collapsed.has(folder)) {
            // First file in this collapsed folder — emit the folder as a building
            collapsed.add(folder);
            result.push({
              path: folder + "/",
              lines: folderTotalLines.get(folder) || 0,
            });
          }
          isCollapsed = true;
          break;
        }
      }
      if (!isCollapsed) {
        result.push({ path: filePath, lines });
      }
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ repoName: path.basename(resolvedDir), files: result }));
    return;
  }

  if (url.pathname === "/api/file") {
    const filePath = url.searchParams.get("path");
    if (!filePath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing path parameter" }));
      return;
    }
    const absPath = path.resolve(resolvedDir, filePath);
    // Security: ensure path is within the watched directory
    if (!absPath.startsWith(resolvedDir)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Access denied" }));
      return;
    }
    try {
      const content = fs.readFileSync(absPath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ path: filePath, content, previous: null }));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
    }
    return;
  }

  if (url.pathname === "/api/recording") {
    // Full event history for playback
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        repoName: path.basename(resolvedDir),
        startTime,
        events,
      })
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // Timelapse from Claude Code JSONL session history
  // ---------------------------------------------------------------------------
  if (url.pathname === "/api/timelapse") {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    // Convert resolved dir to Claude's project key format
    const projectKey = resolvedDir.replace(/\//g, "-");
    const sessionsDir = path.join(homeDir, ".claude", "projects", projectKey);

    try {
      if (!fs.existsSync(sessionsDir)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No Claude Code sessions found for this project", dir: sessionsDir }));
        return;
      }

      // Find all session JSONL files (exclude subagents)
      const sessionFiles = fs.readdirSync(sessionsDir)
        .filter((f: string) => f.endsWith(".jsonl"))
        .map((f: string) => path.join(sessionsDir, f));

      interface TimelapseEvent {
        tool: string;
        action: string;
        path: string;
        timestamp: number;
        sessionId: string;
      }

      const allEvents: TimelapseEvent[] = [];

      for (const sessionFile of sessionFiles) {
        const sessionId = path.basename(sessionFile, ".jsonl");
        const content = fs.readFileSync(sessionFile, "utf-8");
        const lines = content.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type !== "assistant" || !obj.message?.content) continue;

            for (const block of obj.message.content) {
              if (block.type !== "tool_use") continue;
              const toolName = block.name;
              if (!["Read", "Write", "Edit", "Bash"].includes(toolName)) continue;

              let filePath = block.input?.file_path;
              if (!filePath && toolName === "Bash") continue; // skip bash without file

              // Make path relative to project
              if (filePath && filePath.startsWith(resolvedDir)) {
                filePath = path.relative(resolvedDir, filePath).replace(/\\/g, "/");
              } else if (filePath && filePath.startsWith("/")) {
                continue; // skip files outside project
              }

              if (!filePath) continue;

              const action = toolName === "Read" ? "read"
                : toolName === "Write" ? "created"
                : toolName === "Edit" ? "modified"
                : "changed";

              allEvents.push({
                tool: toolName,
                action,
                path: filePath,
                timestamp: obj.timestamp || 0,
                sessionId,
              });
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      // Sort by timestamp
      allEvents.sort((a, b) => a.timestamp - b.timestamp);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        repoName: path.basename(resolvedDir),
        projectKey,
        sessions: sessionFiles.length,
        events: allEvents,
        startTime: allEvents[0]?.timestamp || 0,
        endTime: allEvents[allEvents.length - 1]?.timestamp || 0,
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to parse sessions", details: String(err) }));
    }
    return;
  }

  // Claude Code hook endpoint
  if (url.pathname === "/api/hook" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        console.log(`  Hook raw:`, JSON.stringify(data).slice(0, 300));
        const toolName = data.tool_name ?? data.toolName;
        const filePath = data.tool_input?.file_path ?? data.file;
        const action = toolName === "Read" ? "read"
          : toolName === "Write" ? "created"
          : toolName === "Edit" ? "modified"
          : data.action ?? "changed";
        const sessionId = data.session_id ?? data.session ?? "";

        if (filePath) {
          // Compute relative path if absolute
          const rel = filePath.startsWith("/")
            ? path.relative(resolvedDir, filePath).replace(/\\/g, "/")
            : filePath;

          broadcast({
            type: "hook",
            toolName,
            action,
            path: rel,
            sessionId,
            timestamp: Date.now() - startTime,
          });

          console.log(`  Hook: ${action} ${rel} (${toolName ?? "unknown"})`);
        }
      } catch {
        // ignore malformed hook data
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`Client connected (${clients.size} total)`);

  // Send current snapshot to new client
  const files = Array.from(fileLines.entries()).map(([p, lines]) => ({
    path: p,
    lines,
  }));
  ws.send(
    JSON.stringify({
      type: "snapshot",
      repoName: path.basename(resolvedDir),
      files,
    })
  );

  // Send current dependency graph
  ws.send(JSON.stringify({ type: "deps", edges: getDepsArray() }));

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`Client disconnected (${clients.size} total)`);
  });
});

server.listen(PORT, () => {
  console.log(`\n  CodeCity server watching: ${resolvedDir}`);
  console.log(`  REST API:    http://localhost:${PORT}/api/snapshot`);
  console.log(`  WebSocket:   ws://localhost:${PORT}`);
  console.log(`  Recording:   http://localhost:${PORT}/api/recording\n`);
});

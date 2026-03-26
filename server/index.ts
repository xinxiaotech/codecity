import { createServer } from "node:http";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import chokidar from "chokidar";
import ignore, { type Ignore } from "ignore";

// ---------------------------------------------------------------------------
// CLI — path is now optional (multi-project mode when omitted)
// ---------------------------------------------------------------------------
const targetDir = process.argv[2];
const cliProject = targetDir ? path.resolve(targetDir) : null;
if (cliProject && !fs.existsSync(cliProject)) {
  console.error(`Directory not found: ${cliProject}`);
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3001;

// ---------------------------------------------------------------------------
// Constants (project-independent)
// ---------------------------------------------------------------------------
const ALWAYS_IGNORED_DIRS = new Set([
  "node_modules", ".git", "__pycache__", ".next", ".cache", ".turbo",
  ".wrangler", ".vercel", ".netlify", ".serverless",
  ".expo", ".kotlin", ".metro-health-check",
  "Pods",
]);
const ALWAYS_IGNORED_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", ".DS_Store",
]);
const MAX_FILE_SIZE = 1_000_000;
const MAX_EVENTS = 10_000;
const FILE_STAT_TTL = 5_000;

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".bmp", ".webp",
  ".svg", ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".flac", ".aac",
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
  ".sqlite", ".sqlite-shm", ".sqlite-wal", ".db", ".wasm",
]);

const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".java", ".rb", ".php",
  ".c", ".cpp", ".h", ".hpp", ".swift", ".kt",
  ".css", ".scss", ".less", ".html", ".vue", ".svelte",
  ".sh", ".bash", ".zsh", ".sql",
]);

const STATIC_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".bmp", ".webp", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm",
]);

function isBinaryFile(filePath: string): boolean {
  return BINARY_EXTS.has(path.extname(filePath).toLowerCase());
}

function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTS.has(path.extname(filePath).toLowerCase());
}

function isTrackableFile(filePath: string): boolean {
  return !isBinaryFile(filePath);
}

// ---------------------------------------------------------------------------
// Project discovery — decode ~/.claude/projects/ folder names
// ---------------------------------------------------------------------------
interface DiscoveredProject {
  id: string;   // encoded folder name
  path: string;  // decoded absolute path
  name: string;  // basename
}

function decodeProjectPath(encoded: string): string | null {
  // The encoding: absolute path like /Users/foo/bar becomes -Users-foo-bar
  // But hyphens in actual dir names also become -, creating ambiguity.
  // Use backtracking: at each '-', try '/' (path sep) or literal '-'.
  const parts = encoded.split("-");
  // parts[0] is always '' (from leading '-')

  if (parts.length < 2) return null;

  function solve(idx: number, currentPath: string): string | null {
    if (idx >= parts.length) {
      // Check if this is a valid directory
      try {
        if (fs.existsSync(currentPath) && fs.statSync(currentPath).isDirectory()) {
          return currentPath;
        }
      } catch { /* */ }
      return null;
    }

    // Try as new path segment (use '/')
    const asSlash = currentPath + "/" + parts[idx];
    // Prune early: check if partial path could be valid (parent dir exists)
    const parentDir = path.dirname(asSlash);
    if (fs.existsSync(parentDir)) {
      const result = solve(idx + 1, asSlash);
      if (result) return result;
    }

    // Try as literal hyphen (join with current segment)
    if (currentPath !== "") {
      const asHyphen = currentPath + "-" + parts[idx];
      const result = solve(idx + 1, asHyphen);
      if (result) return result;
    }

    return null;
  }

  // Start from index 1 (skip empty first part from leading '-')
  return solve(2, "/" + parts[1]);
}

function discoverProjects(): DiscoveredProject[] {
  const homeDir = os.homedir();
  const projectsDir = path.join(homeDir, ".claude", "projects");

  try {
    if (!fs.existsSync(projectsDir)) return [];
    const entries = fs.readdirSync(projectsDir);
    const projects: DiscoveredProject[] = [];

    for (const entry of entries) {
      const fullPath = path.join(projectsDir, entry);
      if (!fs.statSync(fullPath).isDirectory()) continue;

      const decoded = decodeProjectPath(entry);
      if (decoded && fs.existsSync(decoded)) {
        projects.push({
          id: entry,
          path: decoded,
          name: path.basename(decoded),
        });
      }
    }

    return projects.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Per-project state
// ---------------------------------------------------------------------------
class ProjectState {
  resolvedDir: string;
  id: string;
  fileLines = new Map<string, number>();
  events: Array<{ type: string; path: string; lines: number; timestamp: number }> = [];
  startTime = Date.now();
  fileDeps = new Map<string, string[]>();
  depsDirty = true;
  cachedDepsArray: Array<{ from: string; to: string }> | null = null;
  ig: Ignore = ignore();
  statCache = new Map<string, { size: number; ts: number }>();
  watcher: chokidar.FSWatcher | null = null;
  ready = false;
  clients = new Set<WebSocket>();

  // Batched event broadcasting
  private eventQueue: Array<unknown> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private depsTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(id: string, resolvedDir: string) {
    this.id = id;
    this.resolvedDir = resolvedDir;
  }

  start() {
    this.loadGitignores(this.resolvedDir, 0);
    this.ig.add(["node_modules", ".git", "__pycache__", ".expo"]);

    this.watcher = chokidar.watch(this.resolvedDir, {
      ignored: (filePath: string) => this.shouldIgnore(filePath),
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    this.watcher.on("add", (absPath) => {
      if (!isTrackableFile(absPath) || this.fileSize(absPath) > MAX_FILE_SIZE) return;
      const rel = this.relPath(absPath);
      const lines = this.countLines(absPath);
      this.fileLines.set(rel, lines);
      this.updateDeps(absPath, rel);
      const event = { type: "add", path: rel, lines, timestamp: Date.now() - this.startTime };
      this.pushEvent(event);
      this.queueBroadcast(event);
      this.broadcastDepsDebounced();
    });

    this.watcher.on("change", (absPath) => {
      this.statCache.delete(absPath);
      if (!isTrackableFile(absPath) || this.fileSize(absPath) > MAX_FILE_SIZE) return;
      const rel = this.relPath(absPath);
      const lines = this.countLines(absPath);
      this.fileLines.set(rel, lines);
      this.updateDeps(absPath, rel);
      const event = { type: "change", path: rel, lines, timestamp: Date.now() - this.startTime };
      this.pushEvent(event);
      this.queueBroadcast(event);
      this.broadcastDepsDebounced();
    });

    this.watcher.on("unlink", (absPath) => {
      this.statCache.delete(absPath);
      const rel = this.relPath(absPath);
      this.fileLines.delete(rel);
      this.removeDeps(rel);
      const event = { type: "unlink", path: rel, lines: 0, timestamp: Date.now() - this.startTime };
      this.pushEvent(event);
      this.queueBroadcast(event);
      this.broadcastDepsDebounced();
    });

    this.watcher.on("ready", () => {
      this.ready = true;
      setTimeout(() => {
        console.log(`  [${this.id}] Indexed ${this.fileLines.size} files`);
      }, 1000);
    });

    console.log(`  Starting project: ${this.resolvedDir}`);
  }

  destroy() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.batchTimer) clearTimeout(this.batchTimer);
    if (this.depsTimer) clearTimeout(this.depsTimer);
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.fileLines.clear();
    this.events.length = 0;
    this.fileDeps.clear();
    this.statCache.clear();
    console.log(`  Stopped project: ${this.resolvedDir}`);
  }

  // Schedule cleanup when no clients remain
  scheduleCleanup() {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    if (this.clients.size === 0) {
      this.cleanupTimer = setTimeout(() => {
        if (this.clients.size === 0) {
          this.destroy();
          activeProjects.delete(this.id);
        }
      }, 60_000); // 60 seconds idle before cleanup
    }
  }

  cancelCleanup() {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // --- Ignore ---
  loadGitignores(dir: string, depth: number) {
    if (depth > 3) return;
    const giPath = path.join(dir, ".gitignore");
    if (fs.existsSync(giPath)) {
      try {
        const raw = fs.readFileSync(giPath, "utf-8");
        const rel = path.relative(this.resolvedDir, dir);
        const lines = raw.split("\n").filter(l => l.trim() && !l.startsWith("#"));
        if (rel) {
          this.ig.add(lines.map(l => {
            if (l.startsWith("!")) return "!" + rel.replace(/\\/g, "/") + "/" + l.slice(1);
            const pattern = l.startsWith("/") ? l.slice(1) : l;
            return rel.replace(/\\/g, "/") + "/" + pattern;
          }));
        } else {
          this.ig.add(raw);
        }
      } catch { /* skip */ }
    }
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (ALWAYS_IGNORED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;
        this.loadGitignores(path.join(dir, entry.name), depth + 1);
      }
    } catch { /* skip */ }
  }

  shouldIgnore(filePath: string): boolean {
    const rel = path.relative(this.resolvedDir, filePath);
    if (rel === "") return false;
    if (rel.startsWith("..")) return true;
    const parts = rel.split(path.sep);
    for (const part of parts) {
      if (ALWAYS_IGNORED_DIRS.has(part)) return true;
      if (ALWAYS_IGNORED_FILES.has(part)) return true;
    }
    const normalized = rel.replace(/\\/g, "/");
    try { if (this.ig.ignores(normalized)) return true; } catch { /* */ }
    return false;
  }

  // --- File ops ---
  fileSize(filePath: string): number {
    const now = Date.now();
    const cached = this.statCache.get(filePath);
    if (cached && now - cached.ts < FILE_STAT_TTL) return cached.size;
    try {
      const size = fs.statSync(filePath).size;
      this.statCache.set(filePath, { size, ts: now });
      return size;
    } catch {
      this.statCache.set(filePath, { size: Infinity, ts: now });
      return Infinity;
    }
  }

  countLines(filePath: string): number {
    try {
      const size = this.fileSize(filePath);
      if (size > MAX_FILE_SIZE || size === 0) return 0;
      const buf = fs.readFileSync(filePath);
      let count = 1;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x0a) count++;
      }
      return count;
    } catch { return 0; }
  }

  relPath(absPath: string): string {
    return path.relative(this.resolvedDir, absPath).replace(/\\/g, "/");
  }

  // --- Dependencies ---
  extractImports(absPath: string): string[] {
    if (!isSourceFile(absPath)) return [];
    try {
      const size = this.fileSize(absPath);
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
          const resolved = this.resolveImport(dir, specifier);
          if (resolved) {
            const rel = path.relative(this.resolvedDir, resolved).replace(/\\/g, "/");
            if (!this.shouldIgnore(resolved)) imports.push(rel);
          }
        }
      }
      return [...new Set(imports)];
    } catch { return []; }
  }

  resolveImport(fromDir: string, specifier: string): string | null {
    const base = path.resolve(fromDir, specifier);
    if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
    const exts = [".ts", ".tsx", ".js", ".jsx", ".json", ".css"];
    for (const ext of exts) {
      const p = base + ext;
      if (fs.existsSync(p)) return p;
    }
    for (const ext of exts) {
      const p = path.join(base, "index" + ext);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  updateDeps(absPath: string, rel: string) {
    const imports = this.extractImports(absPath);
    this.fileDeps.set(rel, imports);
    this.depsDirty = true;
  }

  removeDeps(rel: string) {
    this.fileDeps.delete(rel);
    this.depsDirty = true;
  }

  getDepsArray(): Array<{ from: string; to: string }> {
    if (!this.depsDirty && this.cachedDepsArray) return this.cachedDepsArray;
    const edges: Array<{ from: string; to: string }> = [];
    for (const [from, targets] of this.fileDeps) {
      for (const to of targets) edges.push({ from, to });
    }
    this.cachedDepsArray = edges;
    this.depsDirty = false;
    return edges;
  }

  // --- Events ---
  pushEvent(event: { type: string; path: string; lines: number; timestamp: number }) {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
  }

  // --- Broadcasting ---
  private getBatchInterval(): number {
    return this.ready ? 50 : 200;
  }

  private flushEventQueue() {
    this.batchTimer = null;
    if (this.eventQueue.length === 0) return;
    const batch = this.eventQueue;
    this.eventQueue = [];
    const msg = JSON.stringify({ type: "events", events: batch });
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  queueBroadcast(data: unknown) {
    this.eventQueue.push(data);
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flushEventQueue(), this.getBatchInterval());
    }
  }

  broadcast(data: unknown) {
    const msg = JSON.stringify(data);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  broadcastDepsDebounced() {
    if (this.depsTimer) clearTimeout(this.depsTimer);
    this.depsTimer = setTimeout(() => {
      this.broadcast({ type: "deps", edges: this.getDepsArray() });
      this.depsTimer = null;
    }, this.ready ? 100 : 500);
  }

  // --- Snapshot helpers ---
  getSnapshot() {
    const files = Array.from(this.fileLines.entries()).map(([p, lines]) => ({ path: p, lines }));
    return { type: "snapshot", repoName: path.basename(this.resolvedDir), files };
  }

  getCollapsedSnapshot(maxBuildings = 100) {
    const allFiles = Array.from(this.fileLines.entries());
    const totalFiles = allFiles.length;

    if (totalFiles <= maxBuildings) {
      const files = allFiles.map(([p, lines]) => ({ path: p, lines }));
      return { repoName: path.basename(this.resolvedDir), files };
    }

    const folderChildCount = new Map<string, number>();
    const folderTotalLines = new Map<string, number>();
    for (const [filePath, lines] of allFiles) {
      const parts = filePath.split("/");
      for (let i = 1; i <= parts.length - 1; i++) {
        const folder = parts.slice(0, i).join("/");
        folderTotalLines.set(folder, (folderTotalLines.get(folder) || 0) + lines);
      }
      if (parts.length > 1) {
        const parent = parts.slice(0, -1).join("/");
        folderChildCount.set(parent, (folderChildCount.get(parent) || 0) + 1);
      }
    }

    const foldersToCollapse = new Set<string>();
    const sortedFolders = [...folderChildCount.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1]);

    let currentBuildingCount = totalFiles;
    for (const [folder, childCount] of sortedFolders) {
      if (currentBuildingCount <= maxBuildings) break;
      let parentCollapsed = false;
      for (const cf of foldersToCollapse) {
        if (folder.startsWith(cf + "/")) { parentCollapsed = true; break; }
      }
      if (parentCollapsed) continue;
      foldersToCollapse.add(folder);
      currentBuildingCount -= (childCount - 1);
    }

    const result: Array<{ path: string; lines: number }> = [];
    const collapsed = new Set<string>();
    for (const [filePath, lines] of allFiles) {
      let isCollapsed = false;
      for (const folder of foldersToCollapse) {
        if (filePath.startsWith(folder + "/")) {
          if (!collapsed.has(folder)) {
            collapsed.add(folder);
            result.push({ path: folder + "/", lines: folderTotalLines.get(folder) || 0 });
          }
          isCollapsed = true;
          break;
        }
      }
      if (!isCollapsed) result.push({ path: filePath, lines });
    }

    return { repoName: path.basename(this.resolvedDir), files: result };
  }
}

// ---------------------------------------------------------------------------
// Active projects registry
// ---------------------------------------------------------------------------
const activeProjects = new Map<string, ProjectState>();

// Map from WebSocket -> project id they're subscribed to
const clientProjectMap = new Map<WebSocket, string>();

function getOrCreateProject(projectId: string): ProjectState | null {
  const existing = activeProjects.get(projectId);
  if (existing) return existing;

  // Decode and validate
  const decoded = decodeProjectPath(projectId);
  console.log(`  getOrCreateProject: id=${projectId} decoded=${decoded}`);
  if (!decoded || !fs.existsSync(decoded)) {
    console.log(`  getOrCreateProject: FAILED — path not found`);
    return null;
  }

  const project = new ProjectState(projectId, decoded);
  activeProjects.set(projectId, project);
  project.start();
  return project;
}

function getProjectIdForPath(absPath: string): string | null {
  // Find which active project owns this file path
  for (const [id, project] of activeProjects) {
    if (absPath.startsWith(project.resolvedDir + "/") || absPath === project.resolvedDir) {
      return id;
    }
  }
  return null;
}

// If CLI path given, compute the project ID for it
let cliProjectId: string | null = null;
if (cliProject) {
  cliProjectId = cliProject.replace(/\//g, "-");
  // Pre-create this project
  const project = new ProjectState(cliProjectId, cliProject);
  activeProjects.set(cliProjectId, project);
  project.start();
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // Helper: resolve project from query param or CLI default
  function resolveProject(): ProjectState | null {
    const projectParam = url.searchParams.get("project");
    if (projectParam) {
      return activeProjects.get(projectParam) ?? null;
    }
    if (cliProjectId) {
      return activeProjects.get(cliProjectId) ?? null;
    }
    return null;
  }

  // --- Project discovery endpoint ---
  if (url.pathname === "/api/projects") {
    const projects = discoverProjects();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ projects }));
    return;
  }

  if (url.pathname === "/api/snapshot") {
    const project = resolveProject();
    if (!project) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No project specified" }));
      return;
    }
    const snapshot = project.getCollapsedSnapshot();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(snapshot));
    return;
  }

  if (url.pathname === "/api/file") {
    const project = resolveProject();
    if (!project) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No project specified" }));
      return;
    }
    const filePath = url.searchParams.get("path");
    if (!filePath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing path parameter" }));
      return;
    }
    const absPath = path.resolve(project.resolvedDir, filePath);
    if (!absPath.startsWith(project.resolvedDir)) {
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
    const project = resolveProject();
    if (!project) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No project specified" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      repoName: path.basename(project.resolvedDir),
      startTime: project.startTime,
      events: project.events,
    }));
    return;
  }

  if (url.pathname === "/api/timelapse") {
    const project = resolveProject();
    if (!project) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No project specified" }));
      return;
    }

    // Current line counts for the frontend to use when building the city
    const fileLinesSnapshot: Record<string, number> = {};
    for (const [p, lines] of project.fileLines) {
      fileLinesSnapshot[p] = lines;
    }

    // --- Try Claude Code sessions first (primary source) ---
    const homeDir = os.homedir();
    const projectKey = project.resolvedDir.replace(/\//g, "-");
    const sessionsDir = path.join(homeDir, ".claude", "projects", projectKey);

    interface TimelapseEvent {
      tool: string;
      action: string;
      path: string;
      timestamp: number;
      sessionId: string;
    }

    let claudeEvents: TimelapseEvent[] = [];

    try {
      if (fs.existsSync(sessionsDir)) {
        const sessionFiles = fs.readdirSync(sessionsDir)
          .filter((f: string) => f.endsWith(".jsonl"))
          .map((f: string) => path.join(sessionsDir, f));

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
                if (!filePath && toolName === "Bash") continue;

                if (filePath && filePath.startsWith(project.resolvedDir)) {
                  filePath = path.relative(project.resolvedDir, filePath).replace(/\\/g, "/");
                } else if (filePath && filePath.startsWith("/")) {
                  continue;
                }

                if (!filePath) continue;

                const action = toolName === "Read" ? "read"
                  : toolName === "Write" ? "created"
                  : toolName === "Edit" ? "modified"
                  : "changed";

                claudeEvents.push({ tool: toolName, action, path: filePath, timestamp: obj.timestamp || 0, sessionId });
              }
            } catch { /* skip */ }
          }
        }

        claudeEvents.sort((a, b) => a.timestamp - b.timestamp);
      }
    } catch { /* Claude sessions unavailable */ }

    // If we have Claude events, return them as primary source
    if (claudeEvents.length > 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        source: "claude",
        repoName: path.basename(project.resolvedDir),
        projectKey,
        events: claudeEvents,
        fileLines: fileLinesSnapshot,
        startTime: claudeEvents[0]?.timestamp || 0,
        endTime: claudeEvents[claudeEvents.length - 1]?.timestamp || 0,
      }));
      return;
    }

    // --- Fallback: Git history ---
    try {
      // Check if it's a git repo
      execSync("git rev-parse --is-inside-work-tree", { cwd: project.resolvedDir, stdio: "pipe" });

      // Get commits in chronological order with file changes
      const gitLog = execSync(
        'git log --reverse --diff-filter=ACDMR --name-status --format="COMMIT %H %aI"',
        { cwd: project.resolvedDir, maxBuffer: 50 * 1024 * 1024, encoding: "utf-8" }
      );

      const gitEvents: TimelapseEvent[] = [];
      let currentCommit = "";
      let currentTimestamp = 0;

      for (const line of gitLog.split("\n")) {
        if (line.startsWith("COMMIT ")) {
          const parts = line.split(" ");
          currentCommit = parts[1];
          currentTimestamp = new Date(parts[2]).getTime();
        } else if (line.match(/^[ACDMR]\t/)) {
          const [status, ...fileParts] = line.split("\t");
          const filePath = fileParts.join("\t"); // handle tabs in filenames
          if (!filePath || project.shouldIgnore(path.join(project.resolvedDir, filePath))) continue;

          const action = status === "A" ? "created"
            : status === "D" ? "deleted"
            : "modified";

          gitEvents.push({
            tool: "git",
            action,
            path: filePath,
            timestamp: currentTimestamp,
            sessionId: currentCommit,
          });
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        source: "git",
        repoName: path.basename(project.resolvedDir),
        events: gitEvents,
        fileLines: fileLinesSnapshot,
        startTime: gitEvents[0]?.timestamp || 0,
        endTime: gitEvents[gitEvents.length - 1]?.timestamp || 0,
      }));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No Claude Code sessions or git history found" }));
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
          // Route to the correct project
          const projectId = getProjectIdForPath(filePath);
          const project = projectId ? activeProjects.get(projectId) : null;

          if (project) {
            const rel = filePath.startsWith("/")
              ? path.relative(project.resolvedDir, filePath).replace(/\\/g, "/")
              : filePath;

            project.broadcast({
              type: "hook",
              toolName,
              action,
              path: rel,
              sessionId,
              timestamp: Date.now() - project.startTime,
            });

            console.log(`  Hook: ${action} ${rel} (${toolName ?? "unknown"}) [${project.id}]`);
          } else {
            // Broadcast to all active projects as fallback
            for (const [, proj] of activeProjects) {
              const rel = filePath.startsWith("/")
                ? path.relative(proj.resolvedDir, filePath).replace(/\\/g, "/")
                : filePath;
              if (!rel.startsWith("..")) {
                proj.broadcast({
                  type: "hook",
                  toolName,
                  action,
                  path: rel,
                  sessionId,
                  timestamp: Date.now() - proj.startTime,
                });
                console.log(`  Hook: ${action} ${rel} (${toolName ?? "unknown"}) [${proj.id}]`);
              }
            }
          }
        }
      } catch { /* ignore malformed */ }
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
  console.log(`Client connected`);

  // If CLI project mode, auto-subscribe
  if (cliProjectId) {
    const project = activeProjects.get(cliProjectId);
    if (project) {
      subscribeClient(ws, project);
    }
  }

  // Send available projects list
  const projects = discoverProjects();
  ws.send(JSON.stringify({ type: "projects", projects }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      console.log(`  WS message:`, JSON.stringify(msg).slice(0, 200));
      if (msg.type === "subscribe" && msg.project) {
        console.log(`  Subscribe request for: ${msg.project}`);
        const project = getOrCreateProject(msg.project);
        if (project) {
          // Unsubscribe from previous project
          const prevId = clientProjectMap.get(ws);
          if (prevId && prevId !== msg.project) {
            const prevProject = activeProjects.get(prevId);
            if (prevProject) {
              prevProject.clients.delete(ws);
              prevProject.scheduleCleanup();
            }
          }
          subscribeClient(ws, project);
        }
      }
    } catch { /* ignore */ }
  });

  ws.on("close", () => {
    const projectId = clientProjectMap.get(ws);
    if (projectId) {
      const project = activeProjects.get(projectId);
      if (project) {
        project.clients.delete(ws);
        project.scheduleCleanup();
      }
    }
    clientProjectMap.delete(ws);
    console.log(`Client disconnected`);
  });
});

function subscribeClient(ws: WebSocket, project: ProjectState) {
  project.cancelCleanup();
  project.clients.add(ws);
  clientProjectMap.set(ws, project.id);

  // Send snapshot + deps
  ws.send(JSON.stringify(project.getSnapshot()));
  ws.send(JSON.stringify({ type: "deps", edges: project.getDepsArray() }));
}

server.listen(PORT, () => {
  if (cliProject) {
    console.log(`\n  CodeCity server watching: ${cliProject}`);
  } else {
    console.log(`\n  CodeCity server (multi-project mode)`);
  }
  console.log(`  REST API:    http://localhost:${PORT}/api/projects`);
  console.log(`  WebSocket:   ws://localhost:${PORT}`);
  console.log(`  Recording:   http://localhost:${PORT}/api/recording\n`);
});

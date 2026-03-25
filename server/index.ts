import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import chokidar from "chokidar";

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

// State
const fileLines = new Map<string, number>();
const events: Array<{
  type: string;
  path: string;
  lines: number;
  timestamp: number;
}> = [];
const startTime = Date.now();
const clients = new Set<WebSocket>();

// Directories/files to ignore
const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".cache", ".turbo",
]);
const IGNORED_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", ".DS_Store",
]);

function shouldIgnore(filePath: string): boolean {
  const rel = path.relative(resolvedDir, filePath);
  const parts = rel.split(path.sep);
  for (const part of parts) {
    if (IGNORED_DIRS.has(part)) return true;
    if (IGNORED_FILES.has(part)) return true;
  }
  return false;
}

// Count lines in a file
function countLines(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

// Extract import/require references from a file, resolve to relative paths
function extractImports(absPath: string): string[] {
  try {
    const content = fs.readFileSync(absPath, "utf-8");
    const imports: string[] = [];
    const dir = path.dirname(absPath);

    // Match: import ... from "...", import "...", require("..."), export ... from "..."
    const patterns = [
      /(?:import|export)\s+.*?from\s+['"]([^'"]+)['"]/g,
      /import\s+['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const specifier = match[1];
        // Only resolve relative imports (./  ../)
        if (!specifier.startsWith(".")) continue;

        // Try to resolve the import to an actual file
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

// Store previous file content for diffs
const filePrevContent = new Map<string, string>();

// Dependency graph: source -> [targets]
const fileDeps = new Map<string, string[]>();

function updateDeps(absPath: string, rel: string) {
  const imports = extractImports(absPath);
  fileDeps.set(rel, imports);
}

function getDepsArray(): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const [from, targets] of fileDeps) {
    for (const to of targets) {
      edges.push({ from, to });
    }
  }
  return edges;
}

// Check if file is likely a text file (skip binaries)
function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const binaryExts = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".woff", ".woff2",
    ".ttf", ".eot", ".mp3", ".mp4", ".zip", ".tar", ".gz", ".pdf",
  ]);
  return !binaryExts.has(ext);
}

// Get relative path
function relPath(absPath: string): string {
  return path.relative(resolvedDir, absPath).replace(/\\/g, "/");
}

// Broadcast to all connected clients
function broadcast(data: unknown) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// File watcher
const watcher = chokidar.watch(resolvedDir, {
  ignored: (filePath: string) => shouldIgnore(filePath),
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
});

watcher.on("add", (absPath) => {
  if (!isTextFile(absPath)) return;
  const rel = relPath(absPath);
  const lines = countLines(absPath);
  fileLines.set(rel, lines);
  // Cache initial content
  try { filePrevContent.set(rel, fs.readFileSync(absPath, "utf-8")); } catch { /* */ }
  updateDeps(absPath, rel);
  const event = { type: "add", path: rel, lines, timestamp: Date.now() - startTime };
  events.push(event);
  broadcast({ type: "event", event });
  broadcast({ type: "deps", edges: getDepsArray() });
});

watcher.on("change", (absPath) => {
  if (!isTextFile(absPath)) return;
  const rel = relPath(absPath);
  // Save current content as "previous" before the change is read
  try {
    const oldContent = fs.readFileSync(absPath, "utf-8");
    filePrevContent.set(rel, oldContent);
  } catch { /* ignore */ }
  const lines = countLines(absPath);
  fileLines.set(rel, lines);
  updateDeps(absPath, rel);
  const event = { type: "change", path: rel, lines, timestamp: Date.now() - startTime };
  events.push(event);
  broadcast({ type: "event", event });
  broadcast({ type: "deps", edges: getDepsArray() });
});

watcher.on("unlink", (absPath) => {
  const rel = relPath(absPath);
  fileLines.delete(rel);
  fileDeps.delete(rel);
  const event = { type: "unlink", path: rel, lines: 0, timestamp: Date.now() - startTime };
  events.push(event);
  broadcast({ type: "event", event });
  broadcast({ type: "deps", edges: getDepsArray() });
});

// HTTP server for REST endpoints
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
    // Current state of all files
    const files = Array.from(fileLines.entries()).map(([p, lines]) => ({
      path: p,
      lines,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ repoName: path.basename(resolvedDir), files }));
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
      const previous = filePrevContent.get(filePath) ?? null;
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ path: filePath, content, previous }));
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

// WebSocket server
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

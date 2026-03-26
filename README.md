# CodeCity

A real-time 3D city visualization of your codebase. Each file becomes a building, folders become city blocks, and file dependencies are rendered as roads connecting buildings. Watch your code being built in real-time as files change.

## Features

- **3D City View** — Files are buildings, folders are green blocks, height = lines of code
- **Live Updates** — Buildings grow/shrink as files are edited in real-time via file watcher
- **Dependency Roads** — Import/require relationships rendered as PCB-style Manhattan-routed roads
- **Multi-Project Support** — Auto-discovers Claude Code projects; switch between codebases without restarting the server
- **Claude Code Integration** — Hooks show construction effects (crane, smoke, fence) on files being edited and survey effects (scanning beam, van, workers) on files being read
- **File Viewer** — Click any building to view source code with syntax highlighting, powered by [@pierre/diffs](https://diffs.com) with Shiki. Shows diffs when files have been modified
- **Interactive** — Hover buildings for file info tooltip, hover highlights connected roads, dimmed buildings when one is focused

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Start the server

**Multi-project mode** (recommended) — auto-discovers all your Claude Code projects:

```bash
npx tsx server/index.ts
```

**Single-project mode** — watch a specific directory:

```bash
npx tsx server/index.ts /path/to/your/project
```

### 3. Start the frontend

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

- In multi-project mode, you'll see a project picker with all discovered projects
- In single-project mode, the city builds immediately as the server scans files
- Switch between projects at any time using the dropdown in the toolbar

## Multi-Project Support

CodeCity auto-discovers projects from `~/.claude/projects/`, where Claude Code stores session data. Any directory you've used Claude Code in will appear in the project picker.

### How it works

1. The server reads `~/.claude/projects/` folder names (encoded paths like `-Users-foo-bar-myproject`)
2. A backtracking decoder resolves each name back to the real filesystem path, handling ambiguity between path separators and literal hyphens
3. Only projects whose directories still exist on disk are shown
4. Projects are loaded on-demand when selected — file watchers start only when a client subscribes
5. Idle projects (no connected clients for 60 seconds) are automatically cleaned up

### WebSocket protocol

The server uses a subscribe-based WebSocket protocol for multi-project support:

- On connect, the server sends `{ type: "projects", projects: [...] }` with all discovered projects
- Clients send `{ type: "subscribe", project: "<id>" }` to select a project
- The server responds with `snapshot` and `deps` for that project
- Clients can switch projects by sending another `subscribe` message
- In single-project mode (CLI path given), clients are auto-subscribed on connect

## Claude Code Integration (Required for Live Effects)

To see live editing/reading effects, you **must** configure Claude Code hooks. Add this to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|Read",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://localhost:3001/api/hook -H 'Content-Type: application/json' -d @-",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

> **Setup note:** Without this hook, CodeCity will still show file changes (via the file watcher), but you won't see the construction/survey effects that visualize Claude's activity. The hook sends tool-use events (Read, Write, Edit) to the CodeCity server in real time.

This sends tool use events to the CodeCity server, which triggers:

- **Edit/Write** — Construction crane on rooftop, smoke particles, yellow fence, orange glow
- **Read** — Blue scanning beam, survey workers walking around, survey van parked nearby

Effects auto-clear after a few seconds of inactivity. Hook events are automatically routed to the correct project based on file paths.

## Architecture

```
codecity/
  server/index.ts        # Multi-project server: file watcher, WebSocket, dependency parser, project discovery
  src/
    App.tsx              # Main app with project selector, tooltip, and file viewer
    components/
      FilePanel.tsx      # Source/diff viewer using @pierre/diffs
      FileViewer.tsx     # Legacy file viewer
      ProjectSelector.tsx # Project dropdown with search
    hooks/
      useCityData.ts     # WebSocket client, tracks files/edits/surveys/deps, project switching
      useTimeline.ts     # Snapshot timeline navigation
    scene/
      CityScene.tsx      # Three.js canvas with sky, lights, camera
      Building.tsx       # Individual file building with facade textures
      BuildingTextures.ts # Canvas-based window texture generator
      Block.tsx          # Folder ground block with curbs
      CityGround.tsx     # Base ground plane
      Crane.tsx          # Construction crane for active edits
      DustCloud.tsx      # Smoke particle effect
      SurveyEffect.tsx   # Survey beam, workers, van
      Roads.tsx          # PCB-style dependency road renderer
    layout/
      stable-layout.ts   # Stable position layout manager
    utils/
      colors.ts          # File type → building color/style mapping
    timeline/
      Timeline.tsx       # Playback controls UI
```

## Server API

- `GET /api/projects` — List all discovered Claude Code projects
- `GET /api/snapshot?project=<id>` — Current file state (paths + line counts)
- `GET /api/file?project=<id>&path=<relative-path>` — File content + previous version for diffs
- `GET /api/recording?project=<id>` — Full event history for playback
- `GET /api/timelapse?project=<id>` — Claude Code session timelapse events
- `POST /api/hook` — Claude Code hook endpoint (auto-routes to correct project)
- `WebSocket ws://localhost:3001` — Real-time events (file changes, hooks, deps, project list)

> The `project` parameter is optional on all endpoints. When omitted, the CLI-specified project is used (single-project mode).

## Tech Stack

- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org/)
- [React Three Fiber](https://r3f.docs.pmnd.rs/) + [Three.js](https://threejs.org/) + [Drei](https://drei.docs.pmnd.rs/)
- [@pierre/diffs](https://diffs.com) — File viewer with syntax highlighting and diff rendering
- [Vite](https://vite.dev) — Dev server and bundler
- [Chokidar](https://github.com/paulmillr/chokidar) — File watcher
- [ws](https://github.com/websockets/ws) — WebSocket server

## License

MIT

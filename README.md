# CodeCity

A real-time 3D city visualization of your codebase. Each file becomes a building, folders become city blocks, and file dependencies are rendered as roads connecting buildings. Watch your code being built in real-time as files change.

## Features

- **3D City View** — Files are buildings, folders are green blocks, height = lines of code
- **Live Updates** — Buildings grow/shrink as files are edited in real-time via file watcher
- **Dependency Roads** — Import/require relationships rendered as PCB-style Manhattan-routed roads
- **Claude Code Integration** — Hooks show construction effects (crane, smoke, fence) on files being edited and survey effects (scanning beam, van, workers) on files being read
- **File Viewer** — Click any building to view source code with syntax highlighting, powered by [@pierre/diffs](https://diffs.com) with Shiki. Shows diffs when files have been modified
- **Interactive** — Hover buildings for file info tooltip, hover highlights connected roads, dimmed buildings when one is focused

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Start the file watcher server

Point it at any project directory you want to visualize:

```bash
npx tsx server/index.ts /path/to/your/project
```

### 3. Start the frontend

```bash
npm run dev
```

Open http://localhost:5173 in your browser. The city will build as the server scans files.

## Claude Code Integration

To see live editing/reading effects, add this hook to your Claude Code settings (`~/.claude/settings.json`):

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

This sends tool use events to the CodeCity server, which triggers:

- **Edit/Write** — Construction crane on rooftop, smoke particles, yellow fence, orange glow
- **Read** — Blue scanning beam, survey workers walking around, survey van parked nearby

Effects auto-clear after a few seconds of inactivity.

## Architecture

```
codecity/
  server/index.ts        # File watcher + WebSocket server + dependency parser
  src/
    App.tsx              # Main app with tooltip and file viewer
    components/
      FileViewer.tsx     # Source/diff viewer using @pierre/diffs
    hooks/
      useCityData.ts     # WebSocket client, tracks files/edits/surveys/deps
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

- `GET /api/snapshot` — Current file state (paths + line counts)
- `GET /api/file?path=<relative-path>` — File content + previous version for diffs
- `GET /api/recording` — Full event history for playback
- `POST /api/hook` — Claude Code hook endpoint
- `WebSocket ws://localhost:3001` — Real-time events (file changes, hooks, deps)

## Tech Stack

- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org/)
- [React Three Fiber](https://r3f.docs.pmnd.rs/) + [Three.js](https://threejs.org/) + [Drei](https://drei.docs.pmnd.rs/)
- [@pierre/diffs](https://diffs.com) — File viewer with syntax highlighting and diff rendering
- [Vite](https://vite.dev) — Dev server and bundler
- [Chokidar](https://github.com/paulmillr/chokidar) — File watcher
- [Hono](https://hono.dev) — HTTP server (used for WebSocket via ws)

## License

MIT

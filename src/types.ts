// A single file's state
export interface FileSnapshot {
  path: string;
  lines: number;
}

// A recorded file-change event
export interface FileEvent {
  type: "add" | "change" | "unlink";
  path: string;
  lines: number;
  timestamp: number; // ms since recording start
}

// Full recording for playback
export interface Recording {
  repoName: string;
  startTime: number;
  events: FileEvent[];
}

// Current snapshot of all files (derived from events)
export interface CityState {
  files: Map<string, number>; // path → line count
}

// A node in the file tree (folder or file)
export interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
  lines?: number;
}

// Output of the treemap layout algorithm
export interface LayoutRect {
  path: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  isFolder: boolean;
  extension: string;
  folderDepth: number;
}

export type BuildingType = "glass" | "brick" | "artdeco" | "warehouse" | "library" | "factory";

export interface BuildingStyle {
  color: string;
  type: BuildingType;
  label: string;
  height: number;
}

// Extension → building style mapping
const STYLE_MAP: Record<string, { color: string; type: BuildingType; label: string }> = {
  // React / UI components → modern glass towers
  tsx: { color: "#4499dd", type: "glass", label: "React" },
  jsx: { color: "#44bbdd", type: "glass", label: "React" },
  vue: { color: "#42b883", type: "glass", label: "Vue" },
  svelte: { color: "#ff5533", type: "glass", label: "Svelte" },

  // Logic / TypeScript / JavaScript → brick office buildings
  ts: { color: "#3178c6", type: "brick", label: "TS" },
  js: { color: "#e8b830", type: "brick", label: "JS" },
  mjs: { color: "#e8b830", type: "brick", label: "JS" },
  cjs: { color: "#e8b830", type: "brick", label: "JS" },

  // Styles → art deco
  css: { color: "#6644cc", type: "artdeco", label: "CSS" },
  scss: { color: "#cc6699", type: "artdeco", label: "SCSS" },
  less: { color: "#2d5a9e", type: "artdeco", label: "LESS" },
  html: { color: "#dd6633", type: "artdeco", label: "HTML" },

  // Config / data → warehouses
  json: { color: "#8a9098", type: "warehouse", label: "JSON" },
  yaml: { color: "#9b6540", type: "warehouse", label: "YAML" },
  yml: { color: "#9b6540", type: "warehouse", label: "YAML" },
  toml: { color: "#8a6040", type: "warehouse", label: "TOML" },
  xml: { color: "#9a8060", type: "warehouse", label: "XML" },
  env: { color: "#707a60", type: "warehouse", label: "ENV" },
  gitignore: { color: "#686868", type: "warehouse", label: "Git" },

  // Docs → libraries
  md: { color: "#c4a060", type: "library", label: "Docs" },
  mdx: { color: "#c4a060", type: "library", label: "Docs" },
  txt: { color: "#b89868", type: "library", label: "Text" },
  rst: { color: "#b89868", type: "library", label: "Docs" },

  // Backend / systems → factories
  py: { color: "#3570a8", type: "factory", label: "Python" },
  rs: { color: "#cc7755", type: "factory", label: "Rust" },
  go: { color: "#00aabb", type: "factory", label: "Go" },
  java: { color: "#b07020", type: "factory", label: "Java" },
  rb: { color: "#aa2244", type: "factory", label: "Ruby" },
  php: { color: "#7766aa", type: "factory", label: "PHP" },
  c: { color: "#5a7088", type: "factory", label: "C" },
  cpp: { color: "#cc5577", type: "factory", label: "C++" },
  h: { color: "#5a7088", type: "factory", label: "C" },
  hpp: { color: "#cc5577", type: "factory", label: "C++" },
  swift: { color: "#ee5533", type: "factory", label: "Swift" },
  kt: { color: "#9966ee", type: "factory", label: "Kotlin" },
  sh: { color: "#55aa33", type: "factory", label: "Shell" },
  sql: { color: "#cc8800", type: "factory", label: "SQL" },
};

const DEFAULT_STYLE = { color: "#7088a0", type: "brick" as BuildingType, label: "File" };

export function getColorForFile(path: string): string {
  return getBuildingStyle(path, 1).color;
}

export function getBuildingStyle(path: string, height: number): BuildingStyle {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const style = STYLE_MAP[ext] ?? DEFAULT_STYLE;

  // Server-side files get factory style override
  const isBackend = path.includes("server/") || path.includes("api/") || path.includes("backend/");
  if (isBackend && style.type === "brick") {
    return { ...style, type: "factory", label: "Server", height };
  }

  return { ...style, height };
}

export function getFolderColor(depth: number): string {
  const lightness = Math.max(15, 40 - depth * 8);
  return `hsl(220, 5%, ${lightness}%)`;
}

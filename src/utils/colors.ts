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
  ts: { color: "#2d6cb4", type: "brick", label: "TS" },
  js: { color: "#c4a632", type: "brick", label: "JS" },
  mjs: { color: "#c4a632", type: "brick", label: "JS" },
  cjs: { color: "#c4a632", type: "brick", label: "JS" },

  // Styles → art deco
  css: { color: "#5544cc", type: "artdeco", label: "CSS" },
  scss: { color: "#cc6699", type: "artdeco", label: "SCSS" },
  less: { color: "#1d365d", type: "artdeco", label: "LESS" },
  html: { color: "#dd6633", type: "artdeco", label: "HTML" },

  // Config / data → warehouses
  json: { color: "#7a8090", type: "warehouse", label: "JSON" },
  yaml: { color: "#8b5533", type: "warehouse", label: "YAML" },
  yml: { color: "#8b5533", type: "warehouse", label: "YAML" },
  toml: { color: "#7a5533", type: "warehouse", label: "TOML" },
  xml: { color: "#8a7060", type: "warehouse", label: "XML" },
  env: { color: "#666a55", type: "warehouse", label: "ENV" },
  gitignore: { color: "#606060", type: "warehouse", label: "Git" },

  // Docs → libraries
  md: { color: "#d4c5a0", type: "library", label: "Docs" },
  mdx: { color: "#d4c5a0", type: "library", label: "Docs" },
  txt: { color: "#c8b890", type: "library", label: "Text" },
  rst: { color: "#c8b890", type: "library", label: "Docs" },

  // Backend / systems → factories
  py: { color: "#3568a5", type: "factory", label: "Python" },
  rs: { color: "#cc7755", type: "factory", label: "Rust" },
  go: { color: "#00aabb", type: "factory", label: "Go" },
  java: { color: "#aa6622", type: "factory", label: "Java" },
  rb: { color: "#991122", type: "factory", label: "Ruby" },
  php: { color: "#7766aa", type: "factory", label: "PHP" },
  c: { color: "#556677", type: "factory", label: "C" },
  cpp: { color: "#cc5577", type: "factory", label: "C++" },
  h: { color: "#556677", type: "factory", label: "C" },
  hpp: { color: "#cc5577", type: "factory", label: "C++" },
  swift: { color: "#ee5533", type: "factory", label: "Swift" },
  kt: { color: "#9966ee", type: "factory", label: "Kotlin" },
  sh: { color: "#77bb44", type: "factory", label: "Shell" },
  sql: { color: "#cc8800", type: "factory", label: "SQL" },
};

const DEFAULT_STYLE = { color: "#667788", type: "brick" as BuildingType, label: "File" };

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

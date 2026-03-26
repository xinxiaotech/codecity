import { describe, it, expect } from "vitest";
import { StableLayoutManager } from "./stable-layout";

/** Check if two axis-aligned rectangles overlap (centers + half-extents) */
function overlaps(
  ax: number, az: number, ahw: number, ahd: number,
  bx: number, bz: number, bhw: number, bhd: number,
): boolean {
  return Math.abs(ax - bx) < ahw + bhw && Math.abs(az - bz) < ahd + bhd;
}

function makeFiles(paths: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of paths) {
    m.set(p, 50 + Math.floor(Math.random() * 500));
  }
  return m;
}

describe("StableLayoutManager — no overlaps", () => {
  it("buildings never overlap each other", () => {
    const files = makeFiles([
      "src/index.ts",
      "src/app.tsx",
      "src/utils/helpers.ts",
      "src/utils/format.ts",
      "src/utils/validate.ts",
      "src/components/Header.tsx",
      "src/components/Footer.tsx",
      "src/components/Sidebar.tsx",
      "server/index.ts",
      "server/routes.ts",
      "server/db.ts",
      "package.json",
      "README.md",
      "tsconfig.json",
      "config/settings.yaml",
      "config/deploy.toml",
    ]);

    const mgr = new StableLayoutManager();
    const layout = mgr.computeLayout(files);

    const buildings = layout.filter((r) => !r.isFolder);

    // Check every pair of buildings for overlap
    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        const a = buildings[i];
        const b = buildings[j];
        const doesOverlap = overlaps(
          a.x, a.z, a.width / 2, a.depth / 2,
          b.x, b.z, b.width / 2, b.depth / 2,
        );
        expect(doesOverlap, `Buildings overlap: "${a.path}" and "${b.path}"`).toBe(false);
      }
    }
  });

  it("no folder rects are emitted (zones removed)", () => {
    const files = makeFiles([
      "src/index.ts",
      "src/app.tsx",
      "server/index.ts",
      "server/routes.ts",
    ]);
    const mgr = new StableLayoutManager();
    const layout = mgr.computeLayout(files);
    const folders = layout.filter((r) => r.isFolder);
    expect(folders.length).toBe(0);
  });

  it("buildings have minimum clearance between them", () => {
    const files = makeFiles([
      "src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts",
      "src/e.ts", "src/f.ts", "src/g.ts", "src/h.ts",
    ]);

    const mgr = new StableLayoutManager();
    const layout = mgr.computeLayout(files);
    const buildings = layout.filter((r) => !r.isFolder);

    const MIN_GAP = 0.1; // at least some clearance

    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        const a = buildings[i];
        const b = buildings[j];
        const gapX = Math.abs(a.x - b.x) - a.width / 2 - b.width / 2;
        const gapZ = Math.abs(a.z - b.z) - a.depth / 2 - b.depth / 2;
        // At least one axis must have clearance (they can be adjacent on one axis)
        const hasGap = gapX >= MIN_GAP || gapZ >= MIN_GAP;
        expect(hasGap, `No clearance between "${a.path}" and "${b.path}" (gapX=${gapX.toFixed(2)}, gapZ=${gapZ.toFixed(2)})`).toBe(true);
      }
    }
  });

  it("handles large number of files without overlaps", () => {
    const paths: string[] = [];
    for (let i = 0; i < 100; i++) {
      const folder = ["src", "lib", "utils", "server", "config"][i % 5];
      paths.push(`${folder}/file${i}.ts`);
    }
    const files = makeFiles(paths);

    const mgr = new StableLayoutManager();
    const layout = mgr.computeLayout(files);

    const buildings = layout.filter((r) => !r.isFolder);
    expect(buildings.length).toBe(100);

    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        const a = buildings[i];
        const b = buildings[j];
        const doesOverlap = overlaps(
          a.x, a.z, a.width / 2, a.depth / 2,
          b.x, b.z, b.width / 2, b.depth / 2,
        );
        expect(doesOverlap, `Buildings overlap: "${a.path}" and "${b.path}"`).toBe(false);
      }
    }

    // No folder rects emitted
    expect(layout.filter((r) => r.isFolder).length).toBe(0);
  });

  it("deleted files release their land for reuse", () => {
    const mgr = new StableLayoutManager();

    const files1 = makeFiles(["src/a.ts", "src/b.ts", "src/c.ts"]);
    const layout1 = mgr.computeLayout(files1);
    expect(layout1.filter(r => !r.isFolder).length).toBe(3);

    // Remove b.ts
    const files2 = new Map(files1);
    files2.delete("src/b.ts");
    const layout2 = mgr.computeLayout(files2);
    expect(layout2.filter(r => !r.isFolder).length).toBe(2);

    // Add d.ts — should not overlap with remaining
    files2.set("src/d.ts", 100);
    const layout3 = mgr.computeLayout(files2);
    const buildings = layout3.filter(r => !r.isFolder);
    expect(buildings.length).toBe(3);

    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        const a = buildings[i];
        const b = buildings[j];
        const doesOverlap = overlaps(
          a.x, a.z, a.width / 2, a.depth / 2,
          b.x, b.z, b.width / 2, b.depth / 2,
        );
        expect(doesOverlap, `Overlap after delete+add: "${a.path}" and "${b.path}"`).toBe(false);
      }
    }
  });
});

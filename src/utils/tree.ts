import type { TreeNode } from "../types";

export function buildTree(files: Map<string, number>): TreeNode {
  const root: TreeNode = { name: "root", path: "", children: [] };

  for (const [filePath, lines] of files) {
    const parts = filePath.split("/");
    let current = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      const folderPath = parts.slice(0, i + 1).join("/");
      let child = current.children!.find((c) => c.name === folderName);
      if (!child) {
        child = { name: folderName, path: folderPath, children: [] };
        current.children!.push(child);
      }
      current = child;
    }

    current.children!.push({
      name: parts[parts.length - 1],
      path: filePath,
      lines,
    });
  }

  return root;
}

export function totalLines(node: TreeNode): number {
  if (node.lines !== undefined) return node.lines;
  if (!node.children) return 0;
  return node.children.reduce((sum, child) => sum + totalLines(child), 0);
}

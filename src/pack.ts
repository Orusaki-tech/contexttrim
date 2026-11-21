import { readFileSync } from "node:fs";
import path from "node:path";
import ignore from "ignore";
import type { Analysis } from "./types.js";
import { fmt } from "./format.js";

const LANG: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".jsx": "jsx",
  ".py": "py",
  ".go": "go",
  ".rs": "rust",
  ".md": "md",
  ".json": "json",
  ".css": "css",
  ".html": "html",
  ".yml": "yaml",
  ".yaml": "yaml",
};

export function buildPack(analysis: Analysis, activeLines: string[], budget: number): string {
  const saver = activeLines.length ? ignore().add(activeLines) : undefined;
  const dropped: string[] = [];
  const pool = [];
  for (const file of analysis.files) {
    let excluded = false;
    if (saver) {
      try {
        excluded = saver.ignores(file.path);
      } catch {
        excluded = false;
      }
    }
    if (excluded || file.large) dropped.push(file.path);
    else pool.push(file);
  }

  let used = pool.reduce((sum, file) => sum + file.tokens, 0);
  const bySize = [...pool].sort((a, b) => b.tokens - a.tokens);
  const removed = new Set<string>();
  while (used > budget && bySize.length > 0) {
    const file = bySize.shift();
    if (!file) break;
    used -= file.tokens;
    removed.add(file.path);
    dropped.push(file.path);
  }

  const kept: { path: string; tokens: number; text: string }[] = [];
  for (const file of pool) {
    if (removed.has(file.path)) continue;
    try {
      kept.push({ path: file.path, tokens: file.tokens, text: readFileSync(path.join(analysis.root, file.path), "utf8") });
    } catch {
      dropped.push(file.path);
      used -= file.tokens;
    }
  }

  kept.sort((a, b) => a.path.localeCompare(b.path));
  const parts = [
    "# Context pack",
    "",
    `Estimated file tokens: ${fmt(used)} / budget ${fmt(budget)}.`,
    "Fence lines add a little on top. Token counts are estimates (cl100k_base or chars ÷ 4).",
    "",
    "## Tree",
    "",
    "```text",
    renderTree(kept.map((file) => file.path)),
    "```",
    "",
  ];
  if (dropped.length) {
    parts.push("## Dropped", "");
    for (const file of dropped.slice(0, 40)) parts.push(`- ${file}`);
    if (dropped.length > 40) parts.push(`- … ${dropped.length - 40} more`);
    parts.push("");
  }
  for (const file of kept) {
    const lang = LANG[path.posix.extname(file.path)] ?? "";
    parts.push(`## ${file.path}`, "", `Estimated tokens: ${fmt(file.tokens)}`, "", "```" + lang, file.text.replace(/\s+$/, ""), "```", "");
  }
  return parts.join("\n");
}

function renderTree(paths: string[]): string {
  const root: Node = { name: "", children: new Map() };
  for (const file of paths) {
    const parts = file.split("/");
    let node = root;
    parts.forEach((part, index) => {
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, children: new Map() };
        node.children.set(part, child);
      }
      node = child;
      if (index === parts.length - 1) child.file = true;
    });
  }
  const lines: string[] = [];
  const walk = (node: Node, prefix: string, top: boolean): void => {
    const kids = [...node.children.values()];
    kids.forEach((child, index) => {
      const last = index === kids.length - 1;
      if (top) lines.push(child.name);
      else lines.push(`${prefix}${last ? "└─ " : "├─ "}${child.name}`);
      const next = top ? "" : `${prefix}${last ? "   " : "│  "}`;
      walk(child, next, false);
    });
  };
  walk(root, "", true);
  return lines.join("\n");
}

type Node = { name: string; children: Map<string, Node>; file?: boolean };

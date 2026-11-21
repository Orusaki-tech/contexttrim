import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ignore from "ignore";
import type { Analysis } from "./types.js";

const BEGIN = "# BEGIN ContextTrim";
const END = "# END ContextTrim";

export type FixPlan = {
  block: string;
  active: string[];
  commented: string[];
  before: number;
  after: number;
  saved: number;
  percent: number;
  alreadyCovered: number;
  stillExposed: number;
};

export function buildFix(analysis: Analysis, defaultsPatterns: string[]): FixPlan {
  const active: string[] = [];
  const commented: string[] = [];
  const seen = new Set<string>();

  for (const flag of analysis.flags) {
    if (seen.has(flag.ignoreLine)) continue;
    seen.add(flag.ignoreLine);
    if (flag.apply) active.push(flag.ignoreLine);
    else commented.push(`# ${flag.ignoreLine}`);
  }

  const saver = active.length ? ignore().add(active) : undefined;
  const defaults = defaultsPatterns.length ? ignore().add(defaultsPatterns) : undefined;
  let saved = 0;
  let alreadyCovered = 0;
  for (const file of analysis.files) {
    if (!saver) break;
    let hit = false;
    try {
      hit = saver.ignores(file.path);
    } catch {
      hit = false;
    }
    if (!hit) continue;
    saved += file.tokens;
    if (defaults) {
      try {
        if (defaults.ignores(file.path)) alreadyCovered += file.tokens;
      } catch {
        // Leave it in the exposed bucket.
      }
    }
  }

  const before = analysis.totalTokens;
  const stillExposed = Math.max(0, saved - alreadyCovered);
  return {
    block: formatBlock(active, commented),
    active,
    commented,
    before,
    after: Math.max(0, before - saved),
    saved,
    percent: before > 0 ? (saved / before) * 100 : 0,
    alreadyCovered,
    stillExposed,
  };
}

export function formatBlock(active: string[], commented: string[]): string {
  const lines = [
    BEGIN,
    "# Suggested ignores. Estimated tokens, not a guarantee. Review before you commit.",
    ...active,
  ];
  if (commented.length > 0) {
    lines.push("# Low confidence, or blocked so a source folder is not ignored. Delete the first # to apply.");
    lines.push(...commented);
  }
  lines.push(END);
  return lines.join("\n");
}

export function mergeIgnore(existing: string | null, block: string): string {
  if (!existing || !existing.trim()) return `${block}\n`;
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  if (start !== -1 && end !== -1 && end > start) {
    const before = existing.slice(0, start).trimEnd();
    const after = existing.slice(end + END.length).trim();
    return [before, block, after].filter((part) => part.length > 0).join("\n\n") + "\n";
  }
  return `${existing.trimEnd()}\n\n${block}\n`;
}

const HEADER_COMMENTS = new Set([
  "# Suggested ignores. Estimated tokens, not a guarantee. Review before you commit.",
  "# Low confidence, or blocked so a source folder is not ignored. Delete the first # to apply.",
]);

/** Lines already in a ContextTrim block. A later run cannot see those files, so they must be kept. */
export function linesInBlock(text: string | null): { active: string[]; commented: string[] } {
  const active: string[] = [];
  const commented: string[] = [];
  if (!text) return { active, commented };
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end < start) return { active, commented };
  for (const line of text.slice(start, end).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === BEGIN || HEADER_COMMENTS.has(trimmed)) continue;
    if (trimmed.startsWith("#")) commented.push(trimmed);
    else active.push(trimmed);
  }
  return { active, commented };
}

/** Writes only `<root>/.cursorignore`, replacing a previous ContextTrim block if one exists. */
export function writeIgnore(root: string, block: string): string {
  const target = path.join(path.resolve(root), ".cursorignore");
  const resolvedRoot = path.resolve(root);
  if (target !== path.join(resolvedRoot, ".cursorignore")) {
    throw new Error("Refusing to write outside the project.");
  }
  let existing: string | null = null;
  try {
    existing = readFileSync(target, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw new Error(`Cannot read .cursorignore: ${target}`);
  }
  const previous = linesInBlock(existing);
  const next = linesInBlock(block);
  const active = [...new Set([...previous.active, ...next.active])];
  const commented = [...new Set([...previous.commented, ...next.commented])].filter(
    (line) => !active.includes(line.replace(/^#\s*/, "")),
  );
  writeFileSync(target, mergeIgnore(existing, formatBlock(active, commented)), "utf8");
  return target;
}

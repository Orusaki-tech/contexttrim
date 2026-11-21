import ignore, { type Ignore } from "ignore";
import path from "node:path";
import type { CursorDefaults, FileEntry, FileNote, WasteFlag, WasteRule, WasteRulesFile } from "./types.js";

type Membership = {
  rule: WasteRule;
  pattern: string;
  file: FileEntry;
  ignoreLine: string;
  group: string;
};

const patternCache = new Map<string, Ignore>();

function matcher(pattern: string): Ignore {
  let found = patternCache.get(pattern);
  if (!found) {
    found = ignore().add(pattern);
    patternCache.set(pattern, found);
  }
  return found;
}

function matches(pattern: string, filePath: string): boolean {
  try {
    return matcher(pattern).ignores(filePath);
  } catch {
    return false;
  }
}

/** Broad data globs would also hide package.json and other small config, so pin the file. */
function emission(pattern: string, filePath: string, rule: WasteRule): { ignoreLine: string; group: string } {
  const broadData = rule.minBytes !== undefined && pattern.startsWith("*.") && !pattern.includes("/");
  const deep = pattern.includes("**");
  if (broadData || deep) {
    return { ignoreLine: filePath, group: `${rule.id}|${filePath}` };
  }
  return { ignoreLine: pattern, group: `${rule.id}|${pattern}` };
}

function lineIsSafe(line: string, protectedDirs: string[]): boolean {
  const cleaned = line.trim().replace(/^\//, "");
  if (!cleaned || cleaned.startsWith("#") || cleaned.startsWith("*")) return true;
  const bare = cleaned.endsWith("/") ? cleaned.slice(0, -1) : cleaned;
  if (protectedDirs.includes(bare)) return false;
  const first = bare.split("/")[0] ?? "";
  const base = path.posix.basename(bare);
  if (protectedDirs.includes(first) && !base.includes(".")) return false;
  return true;
}

export function detectWaste(
  files: FileEntry[],
  totalTokens: number,
  rulesFile: WasteRulesFile,
  defaults: CursorDefaults | undefined,
): { flags: WasteFlag[]; notes: Record<string, FileNote> } {
  const defaultsIg = defaults ? ignore().add(defaults.patterns) : undefined;
  const groups = new Map<string, Membership[]>();
  const notes: Record<string, FileNote> = {};

  for (const file of files) {
    for (const rule of rulesFile.rules) {
      if (rule.minBytes !== undefined && file.bytes < rule.minBytes) continue;
      const pattern = rule.patterns.find((item) => matches(item, file.path));
      if (!pattern) continue;
      const emitted = emission(pattern, file.path, rule);
      const row: Membership = { rule, pattern, file, ...emitted };
      const bucket = groups.get(emitted.group) ?? [];
      bucket.push(row);
      groups.set(emitted.group, bucket);
      notes[file.path] = {
        reason: rule.reason,
        severity: rule.severity,
        confidence: rule.confidence,
        ruleId: rule.id,
      };
      break;
    }
  }

  const flags: WasteFlag[] = [];
  for (const members of groups.values()) {
    const first = members[0];
    if (!first) continue;
    const tokens = members.reduce((sum, item) => sum + item.file.tokens, 0);
    const bytes = members.reduce((sum, item) => sum + item.file.bytes, 0);
    const samplePaths = members.slice(0, 3).map((item) => item.file.path);
    const safe = lineIsSafe(first.ignoreLine, rulesFile.protectedDirs);
    const cursorDefault = defaultsIg
      ? members.every((item) => {
          try {
            return defaultsIg.ignores(item.file.path);
          } catch {
            return false;
          }
        })
      : false;
    const display = members.length === 1 ? first.file.path : first.ignoreLine;
    let note: string | undefined;
    if (!safe) note = "Not added. This line would ignore a protected source folder.";
    else if (first.rule.confidence === "low") note = "Not added. Low confidence — uncomment it in the preview if you want it.";
    else if (cursorDefault) {
      note = `Already on Cursor's default ignore list (checked ${defaults?.lastChecked ?? "unknown"}). Kept for other tools.`;
    }

    flags.push({
      ruleId: first.rule.id,
      path: display,
      tokens,
      bytes,
      files: members.length,
      percent: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
      reason: first.rule.reason,
      severity: first.rule.severity,
      confidence: first.rule.confidence,
      ignoreLine: first.ignoreLine,
      apply: safe && first.rule.confidence !== "low",
      cursorDefault,
      samplePaths,
      note,
    });
  }

  flags.sort((a, b) => b.tokens - a.tokens);
  return { flags, notes };
}

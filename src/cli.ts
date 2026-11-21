import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stderr, stdin, stdout } from "node:process";
import { parseArgs } from "node:util";
import { summarize } from "./analyze.js";
import { loadCursorDefaults, loadModels, loadWasteRules } from "./config.js";
import { createDemo } from "./demo.js";
import { buildFix, writeIgnore } from "./fix.js";
import { buildPack } from "./pack.js";
import { renderHtml, renderTerminal } from "./report.js";
import { detectStack, lintRules, loadRules, renderStarter } from "./rules.js";
import { createCounter } from "./tokens.js";
import type { Analysis } from "./types.js";
import { walk } from "./walker.js";

type Flags = {
  write: boolean;
  yes: boolean;
  json: boolean;
  html: boolean;
  pack: boolean;
  budget?: number;
  demo: boolean;
};

function help(): string {
  return `ContextTrim — see what is wasting your AI context, then write a .cursorignore.

Usage
  npm start
  npx tsx src/cli.ts analyze [path] [--budget N] [--json] [--html] [--pack]
  npx tsx src/cli.ts fix [path] [--write] [--yes]
  npx tsx src/cli.ts rules [path] [--write] [--yes]
  npx tsx src/cli.ts demo

fix and rules only change files when you pass --write. Nothing is deleted.`;
}

function parseBudget(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --budget: ${raw}. Use a positive number of tokens.`);
  }
  return Math.floor(value);
}

async function confirm(message: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!stdin.isTTY) throw new Error("Not an interactive terminal. Re-run with --yes to write.");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function inside(root: string, target: string): void {
  const base = path.resolve(root);
  const file = path.resolve(target);
  if (file !== base && !file.startsWith(base + path.sep)) {
    throw new Error(`Refusing to write outside the project: ${file}`);
  }
}

async function inspect(root: string, budget?: number): Promise<{ analysis: Analysis; defaults: string[] }> {
  const [rules, models, defaults] = await Promise.all([loadWasteRules(), loadModels(), loadCursorDefaults()]);
  const counter = createCounter();
  stderr.write("Scanning…\n");
  const walked = walk({
    root,
    counter,
    skipExtensions: rules.alwaysSkipExtensions,
    onProgress: (count) => {
      if (stderr.isTTY) stderr.write(`\rScanning… ${count} files`);
    },
  });
  if (stderr.isTTY) stderr.write("\r");
  const analysis = summarize(walked, rules, models, defaults, budget);
  return { analysis, defaults: defaults.patterns };
}

async function runAnalyze(root: string, flags: Flags): Promise<void> {
  const { analysis, defaults } = await inspect(root, flags.budget);
  const plan = buildFix(analysis, defaults);
  const color = Boolean(stdout.isTTY) && !process.env.NO_COLOR && !flags.json;

  if (flags.json) {
    stdout.write(JSON.stringify({ analysis, plan }, null, 2) + "\n");
  } else {
    stdout.write(renderTerminal(analysis, plan, color) + "\n");
  }

  if (flags.html) {
    const file = path.join(root, "contexttrim-report.html");
    inside(root, file);
    writeFileSync(file, renderHtml(analysis, plan));
    stderr.write(`Wrote ${file}\n`);
  }
  if (flags.pack) {
    const budget = flags.budget ?? 100_000;
    const file = path.join(root, "contexttrim-pack.md");
    inside(root, file);
    writeFileSync(file, buildPack(analysis, plan.active, budget));
    stderr.write(`Wrote ${file} (budget ${budget.toLocaleString("en-US")} estimated tokens)\n`);
  }
  if (flags.demo) {
    stderr.write(`\nSample is ready.\n  npx tsx src/cli.ts fix ${root}\n  npx tsx src/cli.ts rules ${root}\n`);
  }
}

async function runFix(root: string, write: boolean, yes: boolean, budget?: number): Promise<void> {
  const { analysis, defaults } = await inspect(root, budget);
  const plan = buildFix(analysis, defaults);
  const color = Boolean(stdout.isTTY) && !process.env.NO_COLOR;
  stdout.write(renderTerminal(analysis, plan, color, write ? "Review the block below." : undefined) + "\n\n");
  stdout.write(plan.block + "\n");
  if (!write) {
    stderr.write("\nDry-run. Re-run with --write to update .cursorignore.\n");
    return;
  }
  if (plan.active.length === 0 && plan.commented.length === 0) {
    stderr.write("Nothing to write.\n");
    return;
  }
  const ok = await confirm(`Update .cursorignore in ${root}?`, yes);
  if (!ok) {
    stderr.write("Not written.\n");
    return;
  }
  const file = writeIgnore(root, plan.block);
  stderr.write(`Wrote ${file}\n`);
}

async function runRules(root: string, write: boolean, yes: boolean): Promise<void> {
  const counter = createCounter();
  const existing = loadRules(root, counter);
  const issues = lintRules(existing);
  const starter = renderStarter(detectStack(root));
  const lines: string[] = [];
  lines.push(existing.length ? `Rules Doctor · ${existing.length} file(s)` : "Rules Doctor · no .cursor/rules/*.mdc files");
  if (issues.length === 0) lines.push("No lint findings.");
  for (const issue of issues) {
    lines.push(`  ${issue.severity.toUpperCase().padEnd(6)}  ${issue.file}`);
    lines.push(`         ${issue.message}`);
  }
  lines.push("");
  lines.push("Starter .cursor/rules/project.mdc");
  lines.push(starter);
  stdout.write(lines.join("\n"));
  if (!write) {
    stderr.write("Dry-run. Re-run with --write to create .cursor/rules/project.mdc.\n");
    return;
  }
  const target = path.join(root, ".cursor", "rules", "project.mdc");
  inside(root, target);
  const ok = await confirm(`Write ${target}?`, yes);
  if (!ok) {
    stderr.write("Not written.\n");
    return;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, starter.endsWith("\n") ? starter : `${starter}\n`);
  stderr.write(`Wrote ${target}\n`);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      write: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      html: { type: "boolean", default: false },
      pack: { type: "boolean", default: false },
      budget: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help || positionals.length === 0) {
    stdout.write(help() + "\n");
    return;
  }

  const command = positionals[0];
  const target = positionals[1];
  const budget = parseBudget(values.budget);

  if (command === "demo") {
    const root = createDemo();
    stderr.write(`Sample project: ${root}\n`);
    await runAnalyze(root, {
      write: false,
      yes: false,
      json: Boolean(values.json),
      html: Boolean(values.html),
      pack: Boolean(values.pack),
      budget,
      demo: true,
    });
    return;
  }

  const root = path.resolve(target ?? process.cwd());
  if (command === "analyze") {
    await runAnalyze(root, {
      write: false,
      yes: false,
      json: Boolean(values.json),
      html: Boolean(values.html),
      pack: Boolean(values.pack),
      budget,
      demo: false,
    });
    return;
  }
  if (command === "fix") {
    await runFix(root, Boolean(values.write), Boolean(values.yes), budget);
    return;
  }
  if (command === "rules") {
    await runRules(root, Boolean(values.write), Boolean(values.yes));
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${help()}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exitCode = 1;
});

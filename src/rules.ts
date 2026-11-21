import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Counter } from "./tokens.js";

export type Stack = {
  packageManager: string | null;
  languages: string[];
  frameworks: string[];
  commands: { label: string; script: string }[];
  globs: string;
};

export type ParsedRule = {
  path: string;
  alwaysApply: boolean;
  description: string | null;
  globs: string | null;
  body: string;
  tokens: number;
  lines: string[];
};

export type LintIssue = {
  severity: "high" | "medium" | "low";
  file: string;
  message: string;
};

const VAGUE = [/best practices/i, /do the right thing/i, /when appropriate/i, /as needed/i, /be careful/i];

const FRAMEWORKS: [string, string][] = [
  ["next", "Next.js"],
  ["react", "React"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["@angular/core", "Angular"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["@nestjs/core", "NestJS"],
  ["vite", "Vite"],
];

function readIf(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function exists(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function detectStack(root: string): Stack {
  const pkgRaw = readIf(path.join(root, "package.json"));
  const py = readIf(path.join(root, "pyproject.toml")) ?? "";
  const languages: string[] = [];
  const frameworks: string[] = [];
  const commands: { label: string; script: string }[] = [];
  let packageManager: string | null = null;

  if (exists(path.join(root, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (exists(path.join(root, "yarn.lock"))) packageManager = "yarn";
  else if (exists(path.join(root, "bun.lockb"))) packageManager = "bun";
  else if (exists(path.join(root, "package-lock.json"))) packageManager = "npm";

  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [name, label] of FRAMEWORKS) {
        if (deps[name]) frameworks.push(label);
      }
      if (deps.typescript || exists(path.join(root, "tsconfig.json"))) languages.push("TypeScript");
      else languages.push("JavaScript");
      const run = packageManager === "yarn" ? "yarn" : packageManager === "pnpm" ? "pnpm" : packageManager === "bun" ? "bun" : "npm run";
      for (const label of ["dev", "lint", "test", "build", "typecheck"]) {
        if (pkg.scripts?.[label]) commands.push({ label, script: `${run} ${label}`.replace("npm run npm", "npm") });
      }
    } catch {
      languages.push("JavaScript");
    }
  }

  if (py || exists(path.join(root, "requirements.txt"))) {
    languages.push("Python");
    if (/django/i.test(py)) frameworks.push("Django");
    if (/flask/i.test(py)) frameworks.push("Flask");
    if (/\[tool\.pytest/.test(py)) commands.push({ label: "test", script: "pytest" });
    if (/\[tool\.ruff/.test(py)) commands.push({ label: "lint", script: "ruff check ." });
  }
  if (exists(path.join(root, "go.mod"))) languages.push("Go");
  if (exists(path.join(root, "Cargo.toml"))) languages.push("Rust");

  const ext = new Set<string>();
  if (languages.includes("TypeScript")) ext.add("ts").add("tsx");
  if (languages.includes("JavaScript") && !languages.includes("TypeScript")) ext.add("js").add("jsx");
  if (languages.includes("Python")) ext.add("py");
  if (languages.includes("Go")) ext.add("go");
  if (languages.includes("Rust")) ext.add("rs");
  const list = [...ext];
  const globs = list.length === 0 ? "**/*" : list.length === 1 ? `**/*.${list[0]}` : `**/*.{${list.join(",")}}`;

  return { packageManager, languages, frameworks, commands, globs };
}

export function renderStarter(stack: Stack): string {
  const lines = [
    "---",
    'description: "Stack and commands detected by ContextTrim"',
    `globs: ${stack.globs}`,
    "alwaysApply: false",
    "---",
    "",
  ];
  if (stack.packageManager) lines.push(`- Package manager: ${stack.packageManager}.`);
  if (stack.languages.length) lines.push(`- Languages: ${stack.languages.join(", ")}.`);
  if (stack.frameworks.length) lines.push(`- Frameworks: ${stack.frameworks.join(", ")}.`);
  for (const command of stack.commands) {
    lines.push(`- ${command.label}: \`${command.script}\`.`);
  }
  lines.push("- Do not read or edit generated output in dist/, build/, .next/, or coverage/.");
  lines.push("- Do not treat lockfiles, minified bundles, or large fixtures as project knowledge.");
  if (!stack.packageManager && stack.languages.length === 0) {
    lines.push("- ContextTrim did not find package.json or pyproject.toml. Fill this rule in by hand.");
  }
  lines.push("");
  return lines.join("\n");
}

function listMdc(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) listMdc(abs, out);
    else if (ent.isFile() && ent.name.endsWith(".mdc")) out.push(abs);
  }
}

export function loadRules(root: string, counter: Counter): ParsedRule[] {
  const dir = path.join(root, ".cursor", "rules");
  const files: string[] = [];
  listMdc(dir, files);
  files.sort();
  return files.map((file) => parseRule(file, path.relative(root, file).split(path.sep).join("/"), counter));
}

function parseRule(file: string, rel: string, counter: Counter): ParsedRule {
  const text = readFileSync(file, "utf8");
  let body = text;
  const fm: Record<string, string> = {};
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) {
      const header = text.slice(4, end);
      body = text.slice(end + 4).replace(/^\r?\n/, "");
      for (const line of header.split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!match) continue;
        fm[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 40);
  return {
    path: rel,
    alwaysApply: fm.alwaysApply === "true",
    description: fm.description || null,
    globs: fm.globs || null,
    body,
    tokens: counter.countText(text),
    lines,
  };
}

export function lintRules(rules: ParsedRule[]): LintIssue[] {
  const issues: LintIssue[] = [];
  const always = rules.filter((rule) => rule.alwaysApply);
  const alwaysTokens = always.reduce((sum, rule) => sum + rule.tokens, 0);

  if (always.length >= 2) {
    issues.push({
      severity: alwaysTokens > 800 ? "high" : "medium",
      file: ".cursor/rules",
      message: `${always.length} rules are alwaysApply (${alwaysTokens.toLocaleString("en-US")} estimated tokens on every request). Scope them with globs or a description.`,
    });
  }

  for (const rule of rules) {
    if (rule.tokens > 500) {
      issues.push({
        severity: rule.alwaysApply ? "high" : "medium",
        file: rule.path,
        message: `${rule.tokens.toLocaleString("en-US")} estimated tokens. Rules over 500 tokens are expensive, and Cursor's own guide asks for rules under 500 lines.`,
      });
    }
    const lineCount = rule.body.split(/\r?\n/).length;
    if (lineCount > 500) {
      issues.push({
        severity: "medium",
        file: rule.path,
        message: `${lineCount} lines. Cursor's rules guide says to keep a rule under 500 lines.`,
      });
    }
    if (!rule.alwaysApply && !rule.globs && !rule.description) {
      issues.push({
        severity: "medium",
        file: rule.path,
        message: "No globs and no description, and alwaysApply is false. This rule loads only when someone @-mentions it.",
      });
    }
    for (const line of rule.body.split(/\r?\n/)) {
      if (VAGUE.some((pattern) => pattern.test(line))) {
        issues.push({
          severity: "low",
          file: rule.path,
          message: `Vague line: ${line.trim().slice(0, 90)}`,
        });
      }
    }
  }

  const seen = new Map<string, string>();
  for (const rule of rules) {
    for (const line of new Set(rule.lines)) {
      const other = seen.get(line);
      if (other && other !== rule.path) {
        issues.push({
          severity: "medium",
          file: rule.path,
          message: `Duplicates a line in ${other}: ${line.slice(0, 80)}`,
        });
      } else if (!other) seen.set(line, rule.path);
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return issues;
}

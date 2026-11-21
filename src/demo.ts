import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SENTENCE =
  "- Never change a public function name without updating every call site and the matching test in the same commit.";

function fakeLock(lines: number): string {
  const out = ["{", '  "name": "bloated-sample",', '  "lockfileVersion": 3,', '  "packages": {'];
  for (let i = 0; i < lines; i++) {
    out.push(
      `    "node_modules/pkg-${i}": { "version": "1.${i % 50}.${i % 97}", "resolved": "https://registry.example.test/pkg-${i}/-/pkg-${i}-1.${i % 50}.${i % 97}.tgz", "integrity": "sha512-${i.toString(16)}a${(i * 17).toString(16)}b${(i * 97).toString(16)}" },`,
    );
  }
  out.push("  }", "}");
  return out.join("\n");
}

function fakeBundle(name: string, lines: number): string {
  const out = [`/* ${name} generated bundle */\n`];
  for (let i = 0; i < lines; i++) {
    out.push(`function ${name}_${i}(a,b){return a+"${name}"+b+"${i}-"+(${(i % 89) + 1}*a)+"hog-${i.toString(16)}";}\n`);
  }
  return out.join("");
}

function fakeJson(items: number): string {
  const rows = [];
  for (let i = 0; i < items; i++) {
    rows.push(
      `{"id":${i},"email":"user${i}@example.test","city":"city-${i % 40}","note":"fixture row ${i} ${(i * 13).toString(16)} padding-for-tokens"}`,
    );
  }
  return `[\n${rows.join(",\n")}\n]\n`;
}

/** Builds a throwaway project full of lockfile, dist, minified JS, and a fat fixture. */
export function createDemo(): string {
  const root = path.join(tmpdir(), `contexttrim-demo-${Date.now()}`);
  const write = (rel: string, text: string) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };

  write(
    "package.json",
    JSON.stringify(
      {
        name: "bloated-sample",
        private: true,
        scripts: { dev: "next dev", test: "vitest", lint: "eslint .", build: "next build" },
        dependencies: { next: "15.0.0", react: "19.0.0" },
        devDependencies: { typescript: "5.6.0", vitest: "2.0.0", eslint: "9.0.0" },
      },
      null,
      2,
    ) + "\n",
  );
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { strict: true, jsx: "preserve" } }, null, 2) + "\n",
  );
  write(".gitignore", "node_modules/\n");
  write("package-lock.json", fakeLock(4800));
  write("src/index.ts", 'export function greet(name: string): string {\n  return `Hello, ${name}`;\n}\n');
  write(
    "src/components/Button.tsx",
    "export function Button(label: string): string {\n  return `<button>${label}</button>`;\n}\n",
  );
  write("src/lib/money.ts", "export function cents(dollars: number): number {\n  return Math.round(dollars * 100);\n}\n");
  for (let i = 0; i < 4; i++) write(`dist/chunk-${i}.js`, fakeBundle(`chunk${i}`, 5200));
  write("public/app.min.js", fakeBundle("app", 4200));
  write("public/app.min.js.map", fakeJson(3600));
  write("data/fixtures/users.json", fakeJson(3600));
  write("coverage/lcov.info", fakeBundle("cov", 1200));
  write(
    ".cursor/rules/legacy.mdc",
    `---\nalwaysApply: true\n---\n\n- Follow best practices when appropriate.\n- Be careful with migrations.\n${Array.from({ length: 40 }, () => SENTENCE).join("\n")}\n`,
  );
  write(
    ".cursor/rules/also-always.mdc",
    `---\nalwaysApply: true\n---\n\n${SENTENCE}\n- Copy this rule into every chat even when the files are unrelated.\n`,
  );
  write(
    ".cursor/rules/orphan.mdc",
    "---\nalwaysApply: false\n---\n\n- This rule has no globs and no description, so it only loads when mentioned.\n",
  );
  return root;
}

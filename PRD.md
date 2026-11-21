# ContextTrim

Find what is wasting your AI context window, generate the fix, and run it inside Cursor.
Theme: Developer Productivity. Solo hackathon build, 75 minutes. A working core beats features.

## One-line pitch
"ContextTrim fixes what Cursor reads (.cursorignore) and what Cursor is told (rules), deterministic, private, no LLM."

## Users
Developers using Cursor or any AI coding tool who hit slow answers, bad answers, burned credits or "context too long".

## Product shape (CLI-first)
Node + TypeScript CLI, run from Cursor's integrated terminal. One core engine, thin wrappers.

    npm install
    npm start                      # = analyze current folder
    npx tsx src/cli.ts analyze [path] [--budget 200000] [--json] [--html]
    npx tsx src/cli.ts fix [path] [--write] [--yes]
    npx tsx src/cli.ts rules [path] [--write]
    npx tsx src/cli.ts demo        # builds a bloated sample project in a temp dir and analyzes it

## Must have (Phases 1-3)
1. **Walker**: recursively list files. Respect existing .gitignore and .cursorignore (use the `ignore` package).
   Always skip .git, node_modules, and binary/media extensions (but COUNT them as "skipped" in the summary).
   Cap: 5,000 files; files over 1 MB are not tokenized (estimate by bytes/4, flag as "large"). Print "skipped N files" instead of hiding it.
2. **Token counter**: `js-tiktoken` (cl100k_base). If it fails to load, fall back to chars/4. Always label output "estimated tokens".
3. **Aggregation**: tokens per file, per folder, total. Top 10 token hogs.
4. **Context fit**: total tokens vs context sizes from `models.json` as a bar. "Your repo is 3.4x too big for 200K."
5. **Waste detector**: apply `waste-rules.json`. Each flag has: file, tokens, % of total, reason, severity, confidence.
6. **Fix preview (`fix`)**: dry-run by default. Prints the proposed .cursorignore, "tokens saved: N (X%)", and before/after totals.
   `--write` writes the file only after a y/N confirm (or `--yes`). Never delete or modify any other file. If .cursorignore exists, append a clearly marked block instead of overwriting.
7. **Terminal report** with readable alignment and color (plain ANSI, no heavy deps).

## Should have (Phase 4, in this order)
- `--html`: write `contexttrim-report.html` (self-contained, inline CSS, bars for top hogs, savings headline). Open in Cursor's browser tab.
- `demo` command with a generated bloated project (big fake lockfile, dist/ folder, large JSON fixture, minified bundle, normal src/).
- `rules` command (Rules Doctor):
  - Generate a starter `.cursor/rules/project.mdc` from detected stack: package manager (lockfile), framework (deps), test/lint/build scripts from package.json or pyproject.toml.
  - Lint existing `.cursor/rules/*.mdc`: tokens per rule, count of alwaysApply rules, missing globs, duplicate lines across files, rules over 500 tokens.
- Cost estimate from `models.json` (only if prices are filled in and verified).
- Context pack export: `--pack --budget 100000` writes one markdown file with tree + surviving files, dropping largest/lowest-value files first.

## Stretch (only if everything above is done and committed)
- MCP server exposing a `context_report` tool. Read the current MCP SDK docs first. Ask before adding the dependency.
- VS Code/Cursor extension wrapper with one command. Drop it if install fights back.

## Won't have
LLM calls, network calls, auth, database, GUI framework, telemetry, auto-deleting files.

## Architecture
    src/
      cli.ts          # arg parsing (node:util parseArgs), command dispatch
      walker.ts       # file listing, ignore handling, caps
      tokens.ts       # tokenizer + fallback
      analyze.ts      # aggregation, hogs, context fit
      waste.ts        # applies waste-rules.json
      fix.ts          # build/preview/write .cursorignore
      rules.ts        # generate + lint cursor rules
      report.ts       # terminal + html rendering
      demo.ts         # sample project generator
    waste-rules.json
    models.json
Core functions are pure and return data; only cli.ts and fix.ts touch stdout/disk.

## Honesty requirements (shown in output)
- "Token counts are estimates (cl100k_base); relative sizes hold across tokenizers."
- Every waste flag shows its reason and confidence.
- Skipped files and caps are printed.
- models.json values show their `lastVerified` date; unverified values are not displayed as facts.

## Acceptance criteria
- `npm start` works on 3 different projects, including this one.
- Runs on a 5,000-file project in a few seconds without freezing.
- `fix` without `--write` changes nothing on disk.
- Generated .cursorignore never excludes the project's own source folders by default (src, app, lib, etc. are protected).
- Errors (bad path, empty folder, unreadable file) print a clear message, no stack traces.
- README has one copy-paste run command at the top, a screenshot or terminal capture, and explains what .cursorignore and rules files do (verify against Cursor's current docs first).

## Demo script (2 min, recorded inside Cursor)
1. Problem: "Every AI tool reads my repo and half of what it reads is junk."
2. `npx tsx src/cli.ts demo`: "1.2M tokens, 6x too big for a 200K window."
3. Show top hogs (lockfile alone is huge).
4. `fix`: preview, then `--write`: "71% saved, now fits."
5. Open the HTML report. Run on a judge's project if they offer one.
6. `rules`: lint a bloated rules file. Close with next steps: MCP server, extension, CI check for context cost growth.

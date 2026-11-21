# ContextTrim

```bash
npm install
npm start
```

ContextTrim shows which files are wasting your AI context window, then writes a `.cursorignore`. It is deterministic and local. It does not call a model.

```bash
npx tsx src/cli.ts demo
```

That builds a throwaway bloated project and prints the report. Use it if this repo itself looks too clean.

## What the files do

Checked against Cursor's docs on 21 Nov 2026.

**`.cursorignore`** blocks matching paths from Agent, Tab, and @ mentions. The syntax is the same as `.gitignore`. Cursor already respects `.gitignore`, and its default ignore list already includes lockfiles, `node_modules/`, and `.next/`. It does not, by default, skip `dist/`, minified bundles, or large JSON. That is the gap this tool fills. Terminal commands and MCP tools can still read ignored files. Source: [Ignore file](https://cursor.com/docs/reference/ignore-file).

**`.cursorindexingignore`** is not in that reference anymore, so ContextTrim does not generate it.

**`.cursor/rules/*.mdc`** is what Cursor is told. Each file needs frontmatter. `alwaysApply: true` sends the rule on every request. `globs` attaches it when a matching file is in context. A `description` with `alwaysApply: false` lets Agent pull it in when it seems relevant. With neither, the rule loads only if you @-mention it. A plain `.md` file in that folder is not a rule. Source: [Rules](https://cursor.com/docs/rules).

## Commands

```bash
npx tsx src/cli.ts analyze [path] [--budget 200000] [--json] [--html] [--pack]
npx tsx src/cli.ts fix [path] [--write] [--yes]
npx tsx src/cli.ts rules [path] [--write] [--yes]
npx tsx src/cli.ts demo
```

`fix` and `rules` only print a preview unless you pass `--write`. `--write` asks `y/N` unless you also pass `--yes`. Nothing is deleted. An existing `.cursorignore` keeps your lines. ContextTrim replaces only its own marked block, and keeps lines it suggested earlier so a second run does not forget files it can no longer see.

`--html` writes `contexttrim-report.html`. `--pack` writes `contexttrim-pack.md`, a trimmed bundle aimed at a token budget (default 100,000). Those two files are not counted on the next scan.

## Terminal capture

Real output from `npx tsx src/cli.ts demo` on 21 Nov 2026:

```text
1,295,742 estimated tokens
would drop 1,294,602 (99.9%) with a .cursorignore · 1,140 would remain
Still reaching Cursor: 978,750    already on Cursor's default ignore list: 315,852

Context windows
  10.1x this window  128K window          preset, not a verified model window
   6.5x this window  200K window          preset, not a verified model window
   1.3x this window  Claude Opus 5.5      verified
   3.2x this window  GPT-5 (deprecated)   verified

Input cost if this were one prompt
  Claude Opus 5.5   $5.18 before   $0.005 after   ($4/M)
  Claude Sonnet 5.5   $2.59 before   $0.002 after   ($2/M)

Top token hogs
  1  315,852   24%  package-lock.json
  2  147,534   11%  dist/chunk-0.js
```

The lockfile is already on Cursor's default ignore list. The 978,750 tokens still reaching Cursor are `dist/`, the minified bundle, the source map, the fixture, and coverage.

## Rules Doctor

```bash
npx tsx src/cli.ts rules <demo-path>
```

On the sample project this reports two `alwaysApply` rules (about 900 estimated tokens on every request), a rule over 500 tokens, a rule with no globs and no description, a duplicated line, and vague lines ("best practices", "be careful"). It also prints a starter `.cursor/rules/project.mdc` from the detected stack. That file is written only with `--write`.

## Honesty

- Token counts say **estimated**. The counter is `cl100k_base`. If that library fails to load, counts fall back to characters ÷ 4 and the report says so. Files over 1 MB are not tokenized. They use bytes ÷ 4 and are marked large.
- Relative size is the point. A lockfile that is 40× `src/` stays about 40× on any tokenizer.
- Every waste flag has a reason and a confidence. Low-confidence lines are comments in the ignore file, and they are not included in the savings number.
- `src`, `app`, `lib`, `pages`, `components`, `server`, `api`, `tests`, `test`, and `packages` are never ignored as folders. A single large file inside one of them can still be listed by its own path.
- Skipped binaries, gitignored paths, `node_modules/`, `.git/`, unreadable files, and the 5,000-file cap are printed.
- Prices and named context windows in `models.json` were checked on **2026-11-21**. The 128K and 200K rows are presets, not a vendor's published limit, and the report says so. Dollar figures are a standard input rate with no cache. They are a guide, because this tokenizer is not Claude's or GPT-5's.
- Claude Opus 5.5: 1M context, $4 / MTok input. [Model overview](https://platform.claude.com/docs/en/models/opus-5-5/overview.md).
- Claude Sonnet 5.5: $2 / MTok input. [Anthropic list prices, 9 Nov 2026](https://assets.claude.com/a04aca860a54b7323e33f449706e9b43680e1346.pdf).
- GPT-5 (deprecated): 400K context, $1.25 / MTok input. [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-5).

## Demo script

1. "Every AI tool reads the repo, and half of what it reads is junk."
2. `npx tsx src/cli.ts demo` — about 1.3M estimated tokens, 6.5× a 200K window, and still 1.3× Claude Opus 5.5's 1M window.
3. The lockfile is 316K tokens, and Cursor already ignores it. `dist/` is 590K and Cursor does not.
4. `npx tsx src/cli.ts fix <path> --write --yes` — about 99.9% dropped, about 1,100 tokens left.
5. Open `contexttrim-report.html`. Run `rules` on the same folder.
6. If a judge offers a repo: `npx tsx src/cli.ts analyze <their-path>`.

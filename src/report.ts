import type { Analysis } from "./types.js";
import type { FixPlan } from "./fix.js";
import { clip, clipEnd, fmt, money, padLeft, pct, savedLabel } from "./format.js";

type Paint = {
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
};

function paint(enabled: boolean): Paint {
  const wrap = (code: string) => (value: string) => (enabled ? `\x1b[${code}m${value}\x1b[0m` : value);
  return { bold: wrap("1"), dim: wrap("2"), red: wrap("31"), green: wrap("32"), yellow: wrap("33") };
}

function bar(ratio: number, width = 22): string {
  const fill = Math.max(0, Math.min(width, Math.round(Math.min(ratio, 1) * width)));
  return "█".repeat(fill) + "░".repeat(width - fill);
}

export function renderTerminal(analysis: Analysis, plan: FixPlan, color: boolean, note?: string): string {
  const c = paint(color);
  const estimate =
    analysis.tokenizer === "cl100k_base"
      ? "Estimated tokens (cl100k_base). Relative sizes hold across tokenizers."
      : "Approximate tokens (chars ÷ 4). js-tiktoken did not load.";
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  push(c.bold("ContextTrim"));
  push(c.dim(estimate));
  push(c.dim(analysis.root));
  push("");
  push(`${c.bold(fmt(analysis.totalTokens))} estimated tokens`);
  if (plan.saved > 0) {
    push(
      `${c.green(`would drop ${fmt(plan.saved)} (${savedLabel(plan.percent, plan.saved, plan.before)})`)} with a .cursorignore · ${fmt(plan.after)} would remain`,
    );
    push(`Still reaching Cursor: ${c.bold(fmt(plan.stillExposed))}    already on Cursor's default ignore list: ${fmt(plan.alreadyCovered)}`);
  } else {
    push("No high or medium confidence waste to ignore.");
  }
  push(c.dim("Cursor already skips lockfiles, node_modules, and .next. It does not skip dist/, minified bundles, or large JSON."));
  push("");

  push(c.bold("Context windows"));
  if (!analysis.fit.length) push("  none configured");
  for (const row of analysis.fit) {
    const status = row.fits ? `fits · ${Math.round(row.ratio * 100)}% used` : `${row.ratio.toFixed(1)}x this window`;
    const tag = row.verified ? "verified" : "preset, not a verified model window";
    push(`  ${bar(row.ratio)}  ${padLeft(status, 22)}  ${row.label}`);
    push(c.dim(`  ${tag}${row.source ? ` · ${row.source}` : ""}`));
  }
  push("");

  if (analysis.costs.length) {
    push(c.bold("Input cost if this were one prompt"));
    push(c.dim("Standard rate, no cache. Counts are cl100k-style estimates, not that model's tokenizer."));
    for (const cost of analysis.costs) {
      const after = (plan.after / 1_000_000) * cost.inputPerMillionUSD;
      const before = (plan.before / 1_000_000) * cost.inputPerMillionUSD;
      push(`  ${cost.model}   ${money(before)} before   ${money(after)} after   ($${cost.inputPerMillionUSD}/M)`);
    }
    push("");
  } else if (analysis.pricesHiddenReason) {
    push(c.dim(analysis.pricesHiddenReason));
    push("");
  }

  push(c.bold("Top token hogs"));
  if (analysis.hogs.length === 0) push("  none");
  analysis.hogs.forEach((file, index) => {
    const note = analysis.notes[file.path];
    const large = file.large ? " · over 1 MB, bytes÷4" : "";
    push(
      `  ${padLeft(String(index + 1), 2)}  ${padLeft(fmt(file.tokens), 10)}  ${padLeft(pct(file.tokens, analysis.totalTokens), 6)}  ${clip(file.path, 64)}${large}`,
    );
    if (note) push(c.dim(`      ${note.ruleId} · ${note.confidence} confidence · ${clipEnd(note.reason, 88)}`));
  });
  push("");

  push(c.bold("Waste"));
  const shown = analysis.flags.slice(0, 12);
  if (shown.length === 0) push("  none");
  for (const flag of shown) {
    const tone = flag.severity === "high" ? c.red : flag.severity === "medium" ? c.yellow : c.dim;
    const where = flag.files > 1 ? `${flag.path} · ${flag.files} files` : flag.path;
    push(
      `  ${tone(flag.severity.toUpperCase().padEnd(6))}  ${padLeft(fmt(flag.tokens), 10)}  ${padLeft(pct(flag.tokens, analysis.totalTokens), 6)}  ${clip(where, 64)}`,
    );
    push(c.dim(`      ${flag.confidence} confidence · ${clipEnd(flag.reason, 92)}`));
    if (flag.note) push(c.dim(`      ${clipEnd(flag.note, 96)}`));
    if (flag.files > 1) push(c.dim(`      e.g. ${flag.samplePaths.join(", ")}`));
  }
  if (analysis.flags.length > shown.length) push(c.dim(`  … ${analysis.flags.length - shown.length} more`));
  push("");

  if (analysis.folders.length) {
    push(c.bold("Folders"));
    for (const folder of analysis.folders.slice(0, 6)) {
      push(`  ${padLeft(fmt(folder.tokens), 10)}  ${padLeft(pct(folder.tokens, analysis.totalTokens), 6)}  ${clip(folder.path, 64)}`);
    }
    push("");
  }

  const large = analysis.files.filter((file) => file.large).length;
  const skipped = analysis.skipped;
  push(c.bold("Skipped"));
  push(`  binaries ${skipped.binaries} · ignored paths ${skipped.ignored} · symlinks ${skipped.symlinks} · over the 5,000 cap ${skipped.overCap}`);
  push(`  not walked: ${skipped.forcedDirs.length ? skipped.forcedDirs.join(", ") : "none"}`);
  push(`  over 1 MB (estimated bytes ÷ 4, not tokenized): ${large}`);
  if (skipped.ownOutput) push(`  ContextTrim's own report files, not counted: ${skipped.ownOutput}`);
  if (skipped.walkStopped) push("  stopped early after 2,000 extra files past the cap");
  if (skipped.unreadable.length) {
    push(`  unreadable: ${skipped.unreadable.slice(0, 5).join(", ")}${skipped.unreadable.length > 5 ? " …" : ""}`);
  }
  push("");

  if (plan.active.length) {
    push(c.bold("Proposed .cursorignore"));
    for (const line of plan.active.slice(0, 20)) push(`  ${line}`);
    if (plan.active.length > 20) push(c.dim(`  … ${plan.active.length - 20} more`));
    if (plan.commented.length) push(c.dim(`  ${plan.commented.length} low-confidence line(s) kept commented`));
  }
  push(c.dim(note ?? "Dry-run. Nothing is written until fix --write."));
  return lines.join("\n");
}

export function renderHtml(analysis: Analysis, plan: FixPlan): string {
  const estimate =
    analysis.tokenizer === "cl100k_base"
      ? "Estimated tokens (cl100k_base). Relative sizes hold across tokenizers."
      : "Approximate tokens (chars ÷ 4). js-tiktoken did not load.";
  const maxHog = analysis.hogs[0]?.tokens || 1;
  const maxRatio = Math.max(1, ...analysis.fit.map((row) => row.ratio));
  const hogRows = analysis.hogs
    .map((file) => {
      const width = Math.max(2, Math.round((file.tokens / maxHog) * 100));
      const note = analysis.notes[file.path];
      return `<div class="hog">
        <div class="hog-name">${esc(file.path)}</div>
        <div class="track"><div class="fill" style="width:${width}%"></div></div>
        <div class="hog-num">${fmt(file.tokens)}</div>
        <div class="hog-why">${note ? esc(`${note.ruleId} · ${note.confidence} · ${note.reason}`) : ""}</div>
      </div>`;
    })
    .join("");

  const fitRows = analysis.fit
    .map((row) => {
      const width = Math.max(3, Math.round((row.ratio / maxRatio) * 100));
      const status = row.fits ? `fits · ${Math.round(row.ratio * 100)}% used` : `${row.ratio.toFixed(1)}× this window`;
      const tag = row.verified ? "verified" : "preset";
      return `<div class="fit">
        <div class="fit-label">${esc(row.label)} <span>${esc(tag)}</span></div>
        <div class="track"><div class="fill ${row.fits ? "ok" : "over"}" style="width:${width}%"></div></div>
        <div class="hog-num">${esc(status)}</div>
      </div>`;
    })
    .join("");

  const costs = analysis.costs
    .map((cost) => {
      const before = (plan.before / 1_000_000) * cost.inputPerMillionUSD;
      const after = (plan.after / 1_000_000) * cost.inputPerMillionUSD;
      return `<li>${esc(cost.model)}: ${money(before)} before, ${money(after)} after <span>($${cost.inputPerMillionUSD}/M input, standard, no cache)</span></li>`;
    })
    .join("");

  const waste = analysis.flags
    .slice(0, 20)
    .map(
      (flag) => `<tr>
        <td class="sev ${esc(flag.severity)}">${esc(flag.severity)}</td>
        <td>${esc(flag.files > 1 ? `${flag.path} (${flag.files})` : flag.path)}</td>
        <td class="num">${fmt(flag.tokens)}</td>
        <td class="num">${pct(flag.tokens, analysis.totalTokens)}</td>
        <td>${esc(flag.reason)}${flag.note ? `<div class="note">${esc(flag.note)}</div>` : ""}</td>
      </tr>`,
    )
    .join("");

  const ignore = plan.active.length ? plan.active.join("\n") : "# nothing to add";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ContextTrim report</title>
<style>
  :root { --ink:#1c1915; --paper:#f3efe4; --line:#ddd4c4; --high:#9f2d20; --med:#8a5a12; --good:#1f6b45; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font: 16px/1.45 Iowan Old Style, Palatino, Georgia, serif; }
  main { max-width: 980px; margin: 0 auto; padding: 40px 24px 72px; }
  .kicker { letter-spacing: .16em; text-transform: uppercase; font: 12px/1 ui-sans-serif, system-ui, sans-serif; margin: 0; }
  h1 { font-size: 64px; line-height: .95; font-weight: 600; letter-spacing: -0.04em; margin: 8px 0; }
  h1 span, h2 { font: 600 13px/1.3 ui-sans-serif, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
  h1 span { display:block; margin-top: 8px; color:#5c564c; }
  .saved { font-size: 22px; margin: 8px 0 4px; }
  .muted, .note, .hog-why { color:#5c564c; font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
  .split { display:flex; gap: 28px; flex-wrap: wrap; margin: 18px 0 8px; }
  .split b { font-variant-numeric: tabular-nums; }
  section { margin-top: 32px; }
  .hog, .fit { display:grid; grid-template-columns: minmax(140px, 240px) 1fr auto; gap: 6px 12px; align-items:center; margin: 8px 0; }
  .hog-why { grid-column: 1 / -1; margin-top: -4px; }
  .hog-name, .fit-label, .hog-num, td, code, pre { font: 13px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .hog-num { font-variant-numeric: tabular-nums; text-align:right; }
  .track { height: 10px; background:#e4dccb; border-radius: 99px; overflow:hidden; }
  .fill { height:100%; background:var(--ink); }
  .fill.ok { background: var(--good); }
  .fill.over { background: var(--high); }
  table { width:100%; border-collapse: collapse; }
  th, td { text-align:left; vertical-align:top; padding: 8px 8px 8px 0; border-bottom: 1px solid var(--line); }
  td.num { text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .sev.high { color: var(--high); }
  .sev.medium { color: var(--med); }
  pre { background:#fffdf8; border:1px solid var(--line); padding: 14px; overflow:auto; white-space:pre-wrap; }
  ul { padding-left: 18px; }
  li span { color:#5c564c; }
</style>
</head>
<body>
<main>
  <p class="kicker">ContextTrim</p>
  <h1>${fmt(analysis.totalTokens)} <span>estimated tokens</span></h1>
  <p class="saved">${plan.saved > 0 ? `A .cursorignore would drop ${fmt(plan.saved)} (${savedLabel(plan.percent, plan.saved, plan.before)}). ${fmt(plan.after)} would remain.` : "Nothing high or medium confidence to ignore."}</p>
  <p class="muted">${esc(estimate)}</p>
  <p class="muted">${esc(analysis.root)}</p>
  <div class="split">
    <div>Still reaching Cursor<br><b>${fmt(plan.stillExposed)}</b></div>
    <div>Already on Cursor's default ignore list<br><b>${fmt(plan.alreadyCovered)}</b></div>
  </div>
  <p class="muted">Checked ${esc(analysis.cursorDefaultsChecked ?? "unknown")} against Cursor's ignore-file docs. Lockfiles are already ignored. dist/, minified bundles, and large JSON are not.</p>
  <section>
    <h2>Context windows</h2>
    ${fitRows || "<p>None configured.</p>"}
  </section>
  ${
    costs
      ? `<section><h2>One-prompt input cost</h2><ul>${costs}</ul><p class="muted">Guide only. The tokenizer above is not the model's own tokenizer.</p></section>`
      : ""
  }
  <section>
    <h2>Top token hogs</h2>
    ${hogRows || "<p>None.</p>"}
  </section>
  <section>
    <h2>Waste</h2>
    <table>
      <thead><tr><th>Severity</th><th>Path</th><th>Tokens</th><th>Share</th><th>Why</th></tr></thead>
      <tbody>${waste || "<tr><td colspan='5'>None</td></tr>"}</tbody>
    </table>
  </section>
  <section>
    <h2>Proposed .cursorignore</h2>
    <pre>${esc(ignore)}</pre>
    <p class="muted">${plan.commented.length > 0 ? `${plan.commented.length} commented line(s) were left out of this list. ` : ""}Nothing was written to disk by the report.</p>
  </section>
</main>
</body>
</html>
`;
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char] ?? char;
  });
}

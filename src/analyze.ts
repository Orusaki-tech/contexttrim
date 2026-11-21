import type { Counter } from "./tokens.js";
import type {
  Analysis,
  CostRow,
  CursorDefaults,
  FileEntry,
  FitRow,
  ModelsFile,
  WalkResult,
  WasteRulesFile,
} from "./types.js";
import { detectWaste } from "./waste.js";

export function summarize(
  walked: WalkResult,
  rules: WasteRulesFile,
  models: ModelsFile,
  defaults: CursorDefaults | undefined,
  budget?: number,
): Analysis {
  const files = [...walked.files].sort((a, b) => b.tokens - a.tokens);
  const totalTokens = files.reduce((sum, file) => sum + file.tokens, 0);
  const { flags, notes } = detectWaste(files, totalTokens, rules, defaults);
  const saved = savings(flags);

  return {
    root: walked.root,
    files,
    folders: topFolders(files),
    totalTokens,
    hogs: files.slice(0, 10),
    skipped: walked.skipped,
    tokenizer: walked.tokenizer,
    flags,
    notes,
    fit: fitRows(models, totalTokens, budget),
    costs: costRows(models, totalTokens, Math.max(0, totalTokens - saved)),
    pricesHiddenReason: priceNote(models),
    protectedDirs: rules.protectedDirs,
    cursorDefaultsChecked: defaults?.lastChecked ?? null,
  };
}

export function savings(flags: Analysis["flags"]): number {
  return flags.filter((flag) => flag.apply).reduce((sum, flag) => sum + flag.tokens, 0);
}

function topFolders(files: FileEntry[]): { path: string; tokens: number }[] {
  const totals = new Map<string, number>();
  for (const file of files) {
    const parts = file.path.split("/");
    if (parts.length < 2) continue;
    parts.pop();
    let dir = "";
    for (const part of parts) {
      dir = dir ? `${dir}/${part}` : part;
      totals.set(dir, (totals.get(dir) ?? 0) + file.tokens);
    }
  }
  return [...totals.entries()]
    .map(([folder, tokens]) => ({ path: folder, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 8);
}

function fitRows(models: ModelsFile, total: number, budget?: number): FitRow[] {
  const verifiedStamp = Boolean(models.lastVerified);
  const rows: FitRow[] = models.contextWindows
    .filter((window) => Number.isFinite(window.tokens) && window.tokens > 0)
    .map((window) => ({
      label: window.label,
      tokens: window.tokens,
      source: window.source ?? null,
      verified: verifiedStamp && Boolean(window.source),
      ratio: total / window.tokens,
      fits: total <= window.tokens,
    }));
  if (budget && budget > 0) {
    rows.push({
      label: "your --budget",
      tokens: budget,
      source: null,
      verified: false,
      ratio: total / budget,
      fits: total <= budget,
    });
  }
  return rows;
}

function costRows(models: ModelsFile, before: number, after: number): CostRow[] {
  if (!models.lastVerified) return [];
  const rows: CostRow[] = [];
  for (const price of models.prices ?? []) {
    if (price.inputPerMillionUSD == null || !price.source) continue;
    const rate = price.inputPerMillionUSD;
    rows.push({
      model: price.model,
      inputPerMillionUSD: rate,
      source: price.source,
      beforeUsd: (before / 1_000_000) * rate,
      afterUsd: (after / 1_000_000) * rate,
    });
  }
  return rows;
}

function priceNote(models: ModelsFile): string | null {
  if (!models.lastVerified) {
    return "Prices hidden. Set lastVerified in models.json after checking official pages.";
  }
  const shown = (models.prices ?? []).some((price) => price.inputPerMillionUSD != null && price.source);
  if (!shown) return "Prices hidden. models.json has no verified input price.";
  return null;
}

export function tokenizerLabel(counter: Counter): string {
  return counter.name === "cl100k_base"
    ? "estimated tokens (cl100k_base). Relative sizes hold across tokenizers."
    : "approximate tokens (chars ÷ 4). js-tiktoken did not load.";
}

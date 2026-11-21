export type TokenMethod = "tiktoken" | "chars/4" | "bytes/4";

export type FileEntry = {
  path: string;
  bytes: number;
  tokens: number;
  method: TokenMethod;
  large: boolean;
};

export type Skipped = {
  binaries: number;
  ignored: number;
  symlinks: number;
  forcedDirs: string[];
  overCap: number;
  unreadable: string[];
  ownOutput: number;
  walkStopped: boolean;
};

export type WalkResult = {
  root: string;
  files: FileEntry[];
  skipped: Skipped;
  tokenizer: "cl100k_base" | "chars/4";
};

export type Severity = "high" | "medium" | "low";

export type WasteRule = {
  id: string;
  category: string;
  severity: Severity;
  confidence: Severity;
  patterns: string[];
  reason: string;
  minBytes?: number;
};

export type WasteRulesFile = {
  version: number;
  note?: string;
  protectedDirs: string[];
  rules: WasteRule[];
  alwaysSkipExtensions: string[];
};

export type WasteFlag = {
  ruleId: string;
  path: string;
  tokens: number;
  bytes: number;
  files: number;
  percent: number;
  reason: string;
  severity: Severity;
  confidence: Severity;
  ignoreLine: string;
  apply: boolean;
  cursorDefault: boolean;
  samplePaths: string[];
  note?: string;
};

export type FileNote = {
  reason: string;
  severity: Severity;
  confidence: Severity;
  ruleId: string;
};

export type ContextWindow = {
  label: string;
  tokens: number;
  source?: string | null;
};

export type ModelPrice = {
  model: string;
  inputPerMillionUSD: number | null;
  source: string | null;
};

export type ModelsFile = {
  note?: string;
  lastVerified: string | null;
  contextWindows: ContextWindow[];
  prices: ModelPrice[];
};

export type FitRow = {
  label: string;
  tokens: number;
  source: string | null;
  verified: boolean;
  ratio: number;
  fits: boolean;
};

export type CostRow = {
  model: string;
  inputPerMillionUSD: number;
  source: string;
  beforeUsd: number;
  afterUsd: number;
};

export type CursorDefaults = {
  lastChecked: string;
  source: string;
  patterns: string[];
};

export type Analysis = {
  root: string;
  files: FileEntry[];
  folders: { path: string; tokens: number }[];
  totalTokens: number;
  hogs: FileEntry[];
  skipped: Skipped;
  tokenizer: "cl100k_base" | "chars/4";
  flags: WasteFlag[];
  notes: Record<string, FileNote>;
  fit: FitRow[];
  costs: CostRow[];
  pricesHiddenReason: string | null;
  protectedDirs: string[];
  cursorDefaultsChecked: string | null;
};

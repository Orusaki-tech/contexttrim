import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CursorDefaults, ModelsFile, WasteRulesFile } from "./types.js";

export function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

async function readJson(name: string): Promise<unknown> {
  const file = path.join(packageRoot(), name);
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    throw new Error(`Could not read ${name}. Run ContextTrim from its own install.`);
  }
}

export async function loadWasteRules(): Promise<WasteRulesFile> {
  const data = (await readJson("waste-rules.json")) as WasteRulesFile;
  if (!Array.isArray(data.rules) || !Array.isArray(data.protectedDirs)) {
    throw new Error("waste-rules.json is missing rules or protectedDirs.");
  }
  return data;
}

export async function loadModels(): Promise<ModelsFile> {
  const data = (await readJson("models.json")) as ModelsFile;
  if (!Array.isArray(data.contextWindows)) {
    throw new Error("models.json is missing contextWindows.");
  }
  return data;
}

export async function loadCursorDefaults(): Promise<CursorDefaults> {
  const data = (await readJson("cursor-defaults.json")) as CursorDefaults;
  if (!Array.isArray(data.patterns)) {
    throw new Error("cursor-defaults.json is missing patterns.");
  }
  return data;
}

import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import type { Counter } from "./tokens.js";
import type { FileEntry, Skipped, WalkResult } from "./types.js";

const MAX_COUNTED = 5000;
const MAX_BYTES = 1024 * 1024;
const MAX_OVER_CAP = 2000;
const SNIFF = 512;
const OWN_OUTPUT = new Set(["contexttrim-report.html", "contexttrim-pack.md"]);

type Layer = { dir: string; ig: Ignore };

export type WalkOptions = {
  root: string;
  counter: Counter;
  skipExtensions: string[];
  onProgress?: (counted: number) => void;
};

function fail(code: string | undefined, root: string): Error {
  if (code === "ENOENT") return new Error(`Path not found: ${root}`);
  if (code === "ENOTDIR") return new Error(`Not a folder: ${root}`);
  if (code === "EACCES" || code === "EPERM") return new Error(`Cannot read: ${root}`);
  return new Error(`Cannot read: ${root}`);
}

function loadLayer(dir: string): Layer | undefined {
  const ig = ignore();
  let any = false;
  for (const name of [".gitignore", ".cursorignore"]) {
    try {
      const text = readFileSync(path.join(dir, name), "utf8");
      if (text.trim()) {
        ig.add(text);
        any = true;
      }
    } catch {
      // Missing ignore file is normal.
    }
  }
  return any ? { dir, ig } : undefined;
}

function ignored(relPath: string, isDir: boolean, layers: Layer[]): boolean {
  for (const layer of layers) {
    let rel = path.relative(layer.dir, relPath);
    if (!rel || rel.startsWith("..")) continue;
    rel = rel.split(path.sep).join("/");
    const asDir = isDir && !rel.endsWith("/") ? `${rel}/` : rel;
    if (layer.ig.ignores(rel) || (isDir && layer.ig.ignores(asDir))) return true;
  }
  return false;
}

function looksBinary(abs: string, size: number): boolean {
  if (size === 0) return false;
  let fd: number | undefined;
  try {
    fd = openSync(abs, "r");
    const buf = Buffer.alloc(Math.min(SNIFF, size));
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).includes(0);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function walk(options: WalkOptions): WalkResult {
  const root = path.resolve(options.root);
  let rootStat;
  try {
    rootStat = statSync(root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw fail(code, root);
  }
  if (!rootStat.isDirectory()) throw new Error(`Not a folder: ${root}`);

  let top: string[];
  try {
    top = readdirSync(root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw fail(code, root);
  }
  if (top.length === 0) throw new Error(`Empty folder: ${root}`);

  const skipExt = new Set(options.skipExtensions.map((ext) => ext.toLowerCase()));
  const files: FileEntry[] = [];
  const skipped: Skipped = {
    binaries: 0,
    ignored: 0,
    symlinks: 0,
    forcedDirs: [],
    overCap: 0,
    unreadable: [],
    ownOutput: 0,
    walkStopped: false,
  };

  const rootLayer = loadLayer(root);
  const baseLayers = rootLayer ? [rootLayer] : [];

  const visit = (absDir: string, layers: Layer[]): void => {
    if (skipped.walkStopped) return;
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      if (absDir === root) throw new Error(`Cannot read: ${root}`);
      skipped.unreadable.push(path.relative(root, absDir).split(path.sep).join("/") || absDir);
      return;
    }

    let nextLayers = layers;
    if (absDir !== root) {
      const nested = loadLayer(absDir);
      if (nested) nextLayers = [...layers, nested];
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (skipped.walkStopped) return;
      const abs = path.join(absDir, ent.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");

      if (ent.isSymbolicLink()) {
        skipped.symlinks++;
        continue;
      }

      if (ent.isDirectory()) {
        if (ent.name === ".git" || ent.name === "node_modules") {
          skipped.forcedDirs.push(`${rel}/`);
          continue;
        }
        if (ignored(abs, true, nextLayers)) {
          skipped.ignored++;
          continue;
        }
        visit(abs, nextLayers);
        continue;
      }

      if (!ent.isFile()) continue;
      if (OWN_OUTPUT.has(ent.name)) {
        skipped.ownOutput++;
        continue;
      }
      if (ignored(abs, false, nextLayers)) {
        skipped.ignored++;
        continue;
      }

      const ext = path.extname(ent.name).slice(1).toLowerCase();
      if (skipExt.has(ext)) {
        skipped.binaries++;
        continue;
      }

      if (files.length >= MAX_COUNTED) {
        skipped.overCap++;
        if (skipped.overCap >= MAX_OVER_CAP) skipped.walkStopped = true;
        continue;
      }

      try {
        const size = statSync(abs).size;
        if (size > MAX_BYTES) {
          if (looksBinary(abs, size)) {
            skipped.binaries++;
            continue;
          }
          files.push({
            path: rel,
            bytes: size,
            tokens: options.counter.countBytes(size),
            method: "bytes/4",
            large: true,
          });
        } else {
          const buf = readFileSync(abs);
          if (buf.subarray(0, Math.min(buf.length, SNIFF)).includes(0)) {
            skipped.binaries++;
            continue;
          }
          const method = options.counter.name === "cl100k_base" ? "tiktoken" : "chars/4";
          files.push({
            path: rel,
            bytes: size,
            tokens: options.counter.countText(buf.toString("utf8")),
            method,
            large: false,
          });
        }
        if (files.length % 250 === 0) options.onProgress?.(files.length);
      } catch {
        skipped.unreadable.push(rel);
      }
    }
  };

  visit(root, baseLayers);
  options.onProgress?.(files.length);

  return { root, files, skipped, tokenizer: options.counter.name };
}

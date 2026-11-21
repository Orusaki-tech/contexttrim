import { getEncoding, type Tiktoken } from "js-tiktoken";

export type Counter = {
  name: "cl100k_base" | "chars/4";
  countText: (text: string) => number;
  countBytes: (bytes: number) => number;
};

let cached: Counter | undefined;

/** One encoder for the whole run. If the library fails to load, counts are chars ÷ 4. */
export function createCounter(): Counter {
  if (cached) return cached;
  try {
    const enc: Tiktoken = getEncoding("cl100k_base");
    cached = {
      name: "cl100k_base",
      countText: (text) => enc.encode(text).length,
      countBytes: (bytes) => Math.ceil(bytes / 4),
    };
  } catch {
    cached = {
      name: "chars/4",
      countText: (text) => Math.ceil(text.length / 4),
      countBytes: (bytes) => Math.ceil(bytes / 4),
    };
  }
  return cached;
}

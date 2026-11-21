export function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function pct(part: number, total: number): string {
  if (total <= 0) return "0%";
  const value = (part / total) * 100;
  if (value > 0 && value < 0.1) return "<0.1%";
  return value >= 10 ? `${value.toFixed(0)}%` : `${value.toFixed(1)}%`;
}

export function money(n: number): string {
  if (n <= 0) return "$0";
  if (n < 0.001) return "<$0.001";
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

export function savedLabel(percent: number, saved: number, before: number): string {
  if (before > 0 && saved < before && percent >= 99.5) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

export function clipEnd(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max < 2) return value.slice(0, max);
  return `${value.slice(0, max - 1)}…`;
}

export function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max < 4) return value.slice(0, max);
  const tail = Math.max(8, Math.floor(max * 0.55));
  const head = max - tail - 1;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + " ".repeat(width - value.length);
}

export function padLeft(value: string, width: number): string {
  if (value.length >= width) return value;
  return " ".repeat(width - value.length) + value;
}

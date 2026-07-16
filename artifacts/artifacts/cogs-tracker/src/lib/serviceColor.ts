/**
 * Color helpers for services and sub-services.
 *
 * - PALETTE: a curated 12-swatch palette that pairs well with the app's pastel
 *   theme. Each entry is a `#rrggbb` string.
 * - defaultColorFor(name): stable hash → palette swatch, used when a service
 *   has no explicit color set yet.
 * - normalizeHex(input): tolerates `rgb`, `rrggbb`, missing `#`, etc. and
 *   returns a canonical `#rrggbb` lowercase string, or `null` if invalid.
 * - tintBgStyle(color, alpha): returns an inline style object with a soft
 *   background tint, for cell/header backgrounds.
 * - readableTextOn(color): picks black or white for legible text on `color`.
 */

export const PALETTE: readonly string[] = [
  "#0ea5e9", // sky-500
  "#6366f1", // indigo-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#ef4444", // red-500
  "#f97316", // orange-500
  "#f59e0b", // amber-500
  "#eab308", // yellow-500
  "#22c55e", // green-500
  "#10b981", // emerald-500
  "#14b8a6", // teal-500
  "#64748b", // slate-500
] as const;

export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/.test(s)) return null;
  return `#${s}`;
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export function defaultColorFor(name: string | null | undefined): string {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return PALETTE[0];
  return PALETTE[hashString(key) % PALETTE.length];
}

export function resolveServiceColor(
  color: string | null | undefined,
  fallbackName: string | null | undefined,
): string {
  return normalizeHex(color) ?? defaultColorFor(fallbackName ?? "");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHex(hex) ?? "#888888";
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function tintBgStyle(
  color: string | null | undefined,
  alpha = 0.12,
  fallbackName?: string | null,
): React.CSSProperties {
  const resolved =
    normalizeHex(color) ??
    (fallbackName != null ? defaultColorFor(fallbackName) : "#888888");
  const { r, g, b } = hexToRgb(resolved);
  return { backgroundColor: `rgba(${r}, ${g}, ${b}, ${alpha})` };
}

export function readableTextOn(color: string): "#0f172a" | "#ffffff" {
  const { r, g, b } = hexToRgb(color);
  // perceived luminance (per ITU-R BT.601)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0f172a" : "#ffffff";
}

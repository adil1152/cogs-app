import { useEffect } from "react";
import { useLocation } from "wouter";

// Friendly labels for the report pages we know how to return to. Order matters —
// the more specific paths must come first so prefix-matching works.
const LABEL_BY_PATH: Array<[string, string]> = [
  ["/reports/entry-wise", "Entry-wise report"],
  ["/reports/comparison", "Comparison report"],
  ["/reports", "Reports"],
];

export function returnToLabel(path: string): string {
  for (const [p, l] of LABEL_BY_PATH) {
    if (path === p || path.startsWith(p + "?")) return l;
  }
  return "previous page";
}

export function readSearch(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function buildUrl(
  path: string,
  params: Record<string, string | string[] | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) sp.set(k, v.join(","));
    } else if (v !== "") {
      sp.set(k, v);
    }
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

export function readReturnTo(): { url: string; label: string } | null {
  const sp = readSearch();
  const v = sp.get("returnTo");
  if (!v) return null;
  const path = v.split("?")[0];
  return { url: v, label: returnToLabel(path) };
}

/**
 * Keep window.location.search in sync with the given param map. Uses
 * `navigate(..., { replace: true })` so the back-button history isn't polluted
 * by every keystroke. Empty / undefined values are stripped.
 */
export function useSyncUrlParams(
  basePath: string,
  params: Record<string, string | string[] | undefined>,
) {
  const [, navigate] = useLocation();
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) sp.set(k, v.join(","));
    } else if (v !== "") {
      sp.set(k, v);
    }
  }
  const qs = sp.toString();
  const target = qs ? `${basePath}?${qs}` : basePath;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname !== basePath) return;
    const current =
      window.location.pathname +
      (window.location.search ? window.location.search : "");
    if (current !== target) {
      navigate(target, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
}

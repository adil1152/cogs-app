import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";

export type MisAppearance = "classic" | "glass";

export const MIS_APPEARANCE_KEY_PREFIX = "qnc-mis-appearance:";

export function misAppearanceKey(userId: string | number | null | undefined): string | null {
  return userId == null || userId === "" ? null : `${MIS_APPEARANCE_KEY_PREFIX}${userId}`;
}

function readSaved(key: string | null): MisAppearance {
  if (!key) return "classic";
  try {
    return window.localStorage.getItem(key) === "glass" ? "glass" : "classic";
  } catch {
    return "classic";
  }
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * Per-user, per-browser MIS appearance.
 * - `appearance` is the live (session) choice; previews immediately, never auto-saved.
 * - `savedDefault` is what is restored on reload; only changed via `saveAsDefault()`.
 */
export function useMisAppearance() {
  const { user } = useAuth();
  const userId = (user as { id?: string | number } | null)?.id;
  const key = misAppearanceKey(userId);

  const [state, setState] = useState(() => {
    const saved = readSaved(key);
    return { key, saved, live: saved };
  });

  // Re-sync when the signed-in user changes — never inherit a previous user's choice.
  useEffect(() => {
    if (state.key !== key) {
      const saved = readSaved(key);
      setState({ key, saved, live: saved });
    }
  }, [key, state.key]);

  const setAppearance = useCallback((live: MisAppearance) => {
    setState((s) => ({ ...s, live }));
  }, []);

  const saveAsDefault = useCallback((): SaveResult => {
    if (!key) return { ok: false, error: "Not signed in — cannot save a default." };
    const value = state.live;
    try {
      window.localStorage.setItem(key, value);
      if (window.localStorage.getItem(key) !== value) throw new Error("verify failed");
    } catch {
      return { ok: false, error: "Browser storage is blocked or full. Default was not saved." };
    }
    setState((s) => ({ ...s, saved: value }));
    return { ok: true };
  }, [key, state.live]);

  return {
    appearance: state.key === key ? state.live : readSaved(key),
    savedDefault: state.saved,
    isDirty: state.live !== state.saved,
    canSave: !!key,
    setAppearance,
    saveAsDefault,
  };
}

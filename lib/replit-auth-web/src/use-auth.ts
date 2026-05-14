import { useSyncExternalStore, useCallback } from "react";
import type { AuthUser } from "@workspace/api-client-react";

export type { AuthUser };

interface RegisterInput {
  email: string;
  password: string;
  firstName?: string | null;
  lastName?: string | null;
  mobile?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: AuthUser | null) => void;
}

async function readJsonOrThrow(res: Response): Promise<any> {
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const msg =
      (data && typeof data.error === "string" && data.error) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// ---------- Module-level singleton store ----------
// All useAuth() callers share this state, so a setUser() in <Login>
// immediately re-renders <Gate> in App.tsx (no page refresh needed).

interface Snapshot {
  user: AuthUser | null;
  isLoading: boolean;
}

let snapshot: Snapshot = { user: null, isLoading: true };
const listeners = new Set<() => void>();

function setSnapshot(next: Snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

let bootstrapPromise: Promise<void> | null = null;

function bootstrap(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    try {
      const res = await fetch("/api/auth/user", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { user: AuthUser | null };
      setSnapshot({ user: data.user ?? null, isLoading: false });
    } catch {
      setSnapshot({ user: null, isLoading: false });
    }
  })();
  return bootstrapPromise;
}

async function refreshImpl(): Promise<void> {
  try {
    const res = await fetch("/api/auth/user", { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { user: AuthUser | null };
    setSnapshot({ user: data.user ?? null, isLoading: false });
  } catch {
    setSnapshot({ user: null, isLoading: false });
  }
}

async function loginImpl(email: string, password: string): Promise<AuthUser> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = (await readJsonOrThrow(res)) as { user: AuthUser };
  setSnapshot({ user: data.user, isLoading: false });
  return data.user;
}

async function registerImpl(input: RegisterInput): Promise<AuthUser> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await readJsonOrThrow(res)) as { user: AuthUser };
  setSnapshot({ user: data.user, isLoading: false });
  return data.user;
}

async function logoutImpl(): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  } catch {
    /* ignore network errors on logout */
  }
  setSnapshot({ user: null, isLoading: false });
}

function setUserImpl(u: AuthUser | null): void {
  setSnapshot({ user: u, isLoading: false });
}

export function useAuth(): AuthState {
  // Kick off the initial /me fetch exactly once for the whole app.
  if (snapshot.isLoading && !bootstrapPromise) {
    void bootstrap();
  }
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const login = useCallback(loginImpl, []);
  const register = useCallback(registerImpl, []);
  const logout = useCallback(logoutImpl, []);
  const refresh = useCallback(refreshImpl, []);
  const setUser = useCallback(setUserImpl, []);

  return {
    user: s.user,
    isLoading: s.isLoading,
    isAuthenticated: !!s.user,
    login,
    register,
    logout,
    refresh,
    setUser,
  };
}

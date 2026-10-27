// Typed calls to the OpenHealth Worker API. Same origin, so the HttpOnly session cookie rides along.

export class UnauthorizedError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (r.status === 401) throw new UnauthorizedError();
  if (!r.ok) throw new Error(`${path} failed: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/** Sends the athlete to onboarding when their session is missing or no longer valid. */
export function onUnauthorized(e: unknown): void {
  if (e instanceof UnauthorizedError) location.replace("/onboarding");
  else throw e;
}

export interface Me {
  id: string;
  name: string;
  primarySport: string | null;
  tz: string;
}

export interface Provider {
  id: string;
  displayName: string;
  category: "wearables" | "gym" | "races";
  kind: "oauth" | "file";
  status: string;
  scopes: { label: string }[];
  connection: { status: string; lastSyncAt: string | null } | null;
}

export const getMe = () => call<Me>("/api/me");
export const getProviders = () => call<Provider[]>("/api/providers");
export const createAthlete = (body: { name: string; primarySport: string; tz: string }) =>
  call<{ id: string }>("/api/athletes", { method: "POST", body: JSON.stringify(body) });
export const startSync = (providers?: string[]) =>
  call<{ runId: string }>("/api/sync", { method: "POST", body: JSON.stringify(providers ? { providers } : {}) });
export const getDashboard = <T>() => call<T>("/api/dashboards/home");
export const getSession = <T>(key: string) => call<T>(`/api/sessions/${encodeURIComponent(key)}`);
export const postReview = <T>(key: string, body: { action: string; payload?: Record<string, string> }) =>
  call<T>(`/api/review/${encodeURIComponent(key)}`, { method: "POST", body: JSON.stringify(body) });
export const uploadAppleBatch = (fileSha256: string, records: unknown[]) =>
  call<{ accepted: number; duplicates: number; updated: number }>("/api/connect/apple_health/batches", {
    method: "POST",
    body: JSON.stringify({ fileSha256, records }),
  });
export const isConnected = (p: Provider) => p.connection?.status === "connected" || p.connection?.status === "syncing";

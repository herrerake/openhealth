// Typed calls to the OpenHealth Worker API. Same origin, so the HttpOnly session cookie rides along.

export class UnauthorizedError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (r.status === 401) throw new UnauthorizedError();
  if (!r.ok) throw new Error(`${path} failed: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/**
 * Sends the athlete to log in when their session is missing or no longer valid.
 * Returns true when it did; any other error is the caller's to show.
 */
export function onUnauthorized(e: unknown): boolean {
  if (!(e instanceof UnauthorizedError)) return false;
  location.replace("/login");
  return true;
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
/** Throws UnauthorizedError when the email and password don't match. */
export const logIn = (email: string, password: string) =>
  call<{ next: string }>("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const getProviders = () => call<Provider[]>("/api/providers");
export const createAthlete = (body: { name: string; primarySport: string; tz: string }) =>
  call<{ id: string }>("/api/athletes", { method: "POST", body: JSON.stringify(body) });
export const startSync = (providers?: string[]) =>
  call<{ runId: string }>("/api/sync", { method: "POST", body: JSON.stringify(providers ? { providers } : {}) });
export const getDashboard = <T>() => call<T>("/api/dashboards/home");
export const getSession = <T>(key: string) => call<T>(`/api/sessions/${encodeURIComponent(key)}`);

export interface TimelineBlock {
  label: string;
  prescription: string | null;
  startS: number | null;
  endS: number | null;
  source: "official" | "watch" | "estimated";
  avgHr: number | null;
  maxHr: number | null;
}
export interface RunningSummary {
  powerW: number | null;
  speedMps: number | null;
  strideM: number | null;
  groundContactMs: number | null;
  verticalOscillationCm: number | null;
  distanceM: number | null;
  paceSPerKm: number | null;
  metersPerBeat: number | null;
  verticalRatioPct: number | null;
  cadenceSpm: number | null;
  wholeRace: boolean;
}
export interface Timeline {
  sessionKey: string;
  localDate: string;
  kind: string;
  title: string;
  tz: string;
  startUtc: string;
  method: "hyrox_splits" | "watch_segments" | "duration_match" | "ai_match" | "whole_workout" | "none";
  hr: { stepS: number; points: [number, number][] } | null;
  blocks: TimelineBlock[];
  summary: { minutes: number; avgHr: number | null; maxHr: number | null } | null;
  running?: RunningSummary | null;
  spoken: string;
}
export const getTimeline = (key: string) => call<Timeline>(`/api/sessions/${encodeURIComponent(key)}/timeline`);
export const postReview = <T>(key: string, body: { action: string; payload?: Record<string, string> }) =>
  call<T>(`/api/review/${encodeURIComponent(key)}`, { method: "POST", body: JSON.stringify(body) });
export const uploadAppleBatch = (fileSha256: string, records: unknown[]) =>
  call<{ accepted: number; duplicates: number; updated: number }>("/api/connect/apple_health/batches", {
    method: "POST",
    body: JSON.stringify({ fileSha256, records }),
  });
export const isConnected = (p: Provider) => p.connection?.status === "connected" || p.connection?.status === "syncing";

export interface RecordAttempt {
  date: string;
  value: number;
  sessionKey: string | null;
  title: string;
  pr: boolean;
  bestSoFar: number;
}
export interface RecordDetail {
  benchmark: string;
  label: string;
  unit: "s" | "rounds" | "lb";
  better: "lower" | "higher";
  asOf: string;
  best: { value: number; date: string; sessionKey: string | null };
  latest: { value: number; date: string; sessionKey: string | null };
  first: { value: number; date: string };
  change: number;
  prCount: number;
  attempts: RecordAttempt[];
  display: string;
  context: string;
  spoken: string;
  calc: { description: string; inputs: { sourceRecordIds?: number[] } };
}
export const getRecord = (benchmark: string) => call<RecordDetail>(`/api/records/${encodeURIComponent(benchmark)}`);

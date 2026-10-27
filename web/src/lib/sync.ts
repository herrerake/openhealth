// Mirrors SyncState in src/worker/agent.ts (the agent's broadcast state).
export interface ProviderProgress {
  status: "pending" | "syncing" | "done" | "error";
  label: string;
  done: number;
  total?: number;
  error?: string;
  durationMs?: number;
  accepted?: number;
  duplicates?: number;
}

export interface SyncState {
  runId: string | null;
  status: "idle" | "running" | "done" | "error";
  providers: Record<string, ProviderProgress>;
  reconcile: { status: "pending" | "running" | "done"; durationMs?: number };
  summary: { workouts: number; duplicatesRemoved: number; needsReview: number; totalRecords: number; timings: Record<string, number> } | null;
  error?: string;
}

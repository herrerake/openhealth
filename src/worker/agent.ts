import { Agent, callable } from "agents";
import { registry } from "../connectors/registry";
import type { ProviderId } from "../core/types";
import type { Env } from "./env";
import { internalFetch, mockBaseUrl } from "./internal";
import { runReconcile } from "./reconcileStore";
import { getConnections, insertSourceRecords, upsertConnection } from "./store";

export type ProviderProgress = {
  status: "pending" | "syncing" | "done" | "error";
  label: string;
  done: number;
  total?: number;
  error?: string;
  durationMs?: number;
  accepted?: number;
  duplicates?: number;
};
export type SyncSummary = {
  workouts: number;
  duplicatesRemoved: number;
  needsReview: number;
  totalRecords: number;
  timings: Record<string, number>;
};
export type SyncState = {
  runId: string | null;
  status: "idle" | "running" | "done" | "error";
  startedAt?: number;
  providers: Partial<Record<ProviderId, ProviderProgress>>;
  reconcile: { status: "pending" | "running" | "done"; durationMs?: number };
  summary: SyncSummary | null;
  error?: string;
};

const MAX_ATTEMPTS = 3;
const STALE_RUN_MS = 10 * 60_000;
const STATE_INTERVAL_MS = 100;

/** One agent per athlete: runs sync runs and streams their progress to the browser through agent state. */
export class AthleteAgent extends Agent<Env, SyncState> {
  initialState: SyncState = { runId: null, status: "idle", providers: {}, reconcile: { status: "pending" }, summary: null };
  private lastStateAt = 0;

  @callable()
  getSyncState(): SyncState {
    return this.state;
  }

  @callable()
  async startSync(providers?: ProviderId[]): Promise<{ runId: string }> {
    const athleteId = this.name;
    const s = this.state;
    if (s.status === "running" && s.runId && Date.now() - (s.startedAt ?? 0) < STALE_RUN_MS) return { runId: s.runId };

    // Anything still "running" in the log was interrupted (eviction, crash); close it out.
    await this.env.DB.prepare(
      `UPDATE sync_runs SET status = 'error', finished_at = ?, detail = ? WHERE athlete_id = ? AND status = 'running'`,
    )
      .bind(new Date().toISOString(), JSON.stringify({ reason: "interrupted" }), athleteId)
      .run();

    const connected = (await getConnections(this.env.DB, athleteId))
      .filter((c) => c.status !== "disconnected" && c.credentials && registry[c.provider as ProviderId]?.sync)
      .map((c) => c.provider as ProviderId);
    const chosen = providers ? connected.filter((p) => providers.includes(p)) : connected;

    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.env.DB.batch(
      chosen.map((p) =>
        this.env.DB.prepare("INSERT INTO sync_runs (id, run_id, athlete_id, provider, started_at, status) VALUES (?, ?, ?, ?, ?, 'running')").bind(
          `${runId}:${p}`,
          runId,
          athleteId,
          p,
          now,
        ),
      ),
    );
    this.setState({
      runId,
      status: "running",
      startedAt: Date.now(),
      providers: Object.fromEntries(chosen.map((p) => [p, { status: "pending", label: registry[p].displayName, done: 0 }])),
      reconcile: { status: "pending" },
      summary: null,
    });
    await this.queue("runSync", { runId, providers: chosen });
    return { runId };
  }

  async runSync(payload: { runId: string; providers: ProviderId[] }): Promise<void> {
    const { runId, providers } = payload;
    const athleteId = this.name;
    const totalStart = Date.now();
    const timings: Record<string, number> = {};
    try {
      const connections = new Map((await getConnections(this.env.DB, athleteId)).map((c) => [c.provider, c]));
      for (const provider of providers) {
        const started = Date.now();
        const counts = { accepted: 0, duplicates: 0, updated: 0 };
        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            this.updateProvider(provider, { status: "syncing" }, true);
            const credentials = connections.get(provider)!.credentials!;
            const batches = registry[provider].sync!({
              athleteId,
              credentials,
              siteTz: this.env.SITE_TZ,
              fetch: internalFetch(this.env),
              baseUrl: mockBaseUrl(provider),
            });
            for await (const batch of batches) {
              const c = await insertSourceRecords(this.env.DB, athleteId, `${runId}:${provider}`, batch.records);
              counts.accepted += c.accepted;
              counts.duplicates += c.duplicates;
              counts.updated += c.updated;
              this.updateProvider(provider, { label: batch.progress.label, done: batch.progress.done, total: batch.progress.total });
            }
            lastError = null;
            break;
          } catch (e) {
            lastError = e as Error;
            if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 100 * attempt));
          }
        }
        const durationMs = Date.now() - started;
        timings[provider] = durationMs;
        await this.env.DB.prepare(
          `UPDATE sync_runs SET status = ?, finished_at = ?, accepted = ?, duplicates = ?, duration_ms = ?, detail = ? WHERE id = ?`,
        )
          .bind(
            lastError ? "error" : "done",
            new Date().toISOString(),
            counts.accepted,
            counts.duplicates,
            durationMs,
            JSON.stringify(lastError ? { error: lastError.message, ...counts } : { updated: counts.updated }),
            `${runId}:${provider}`,
          )
          .run();
        await upsertConnection(this.env.DB, athleteId, provider, {
          status: lastError ? "error" : "connected",
          lastError: lastError?.message ?? null,
          ...(lastError ? {} : { lastSyncAt: new Date().toISOString() }),
        });
        this.updateProvider(provider, lastError
            ? { status: "error", error: lastError.message, durationMs }
            : { status: "done", durationMs, accepted: counts.accepted + counts.updated, duplicates: counts.duplicates }, true);
      }

      this.setState({ ...this.state, reconcile: { status: "running" } });
      const r = await runReconcile(this.env.DB, athleteId, this.env.SITE_TZ);
      timings.reconcile = r.durationMs;
      const total = await this.env.DB.prepare("SELECT count(*) AS n FROM source_records WHERE athlete_id = ?").bind(athleteId).first<{ n: number }>();
      timings.total = Date.now() - totalStart;
      this.setState({
        ...this.state,
        status: "done",
        reconcile: { status: "done", durationMs: r.durationMs },
        summary: {
          workouts: r.sessions,
          duplicatesRemoved: r.duplicatesRemoved,
          needsReview: r.needsReview,
          totalRecords: total?.n ?? 0,
          timings,
        },
      });
    } catch (e) {
      this.setState({ ...this.state, status: "error", error: (e as Error).message });
    }
  }

  /** Progress updates are throttled; status changes always go out. */
  private updateProvider(provider: ProviderId, patch: Partial<ProviderProgress>, force = false): void {
    const current = this.state.providers[provider] ?? { status: "pending", label: provider, done: 0 };
    const providers = { ...this.state.providers, [provider]: { ...current, ...patch } };
    if (!force && Date.now() - this.lastStateAt < STATE_INTERVAL_MS) {
      this.state.providers[provider] = providers[provider];
      return;
    }
    this.lastStateAt = Date.now();
    this.setState({ ...this.state, providers });
  }
}

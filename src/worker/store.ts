import type { SourceRecordInput, StoredSourceRecord } from "../core/types";

const STATEMENTS_PER_BATCH = 500;
const KEYS_PER_QUERY = 90; // D1 allows at most 100 bound parameters per statement

export interface InsertCounts {
  accepted: number;
  duplicates: number;
  updated: number;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
    await db.batch(statements.slice(i, i + STATEMENTS_PER_BATCH));
  }
}

async function existingHashes(
  db: D1Database,
  athleteId: string,
  source: string,
  keys: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (let i = 0; i < keys.length; i += KEYS_PER_QUERY) {
    const chunk = keys.slice(i, i + KEYS_PER_QUERY);
    const { results } = await db
      .prepare(
        `SELECT natural_key, payload_hash FROM source_records
         WHERE athlete_id = ? AND source = ? AND natural_key IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(athleteId, source, ...chunk)
      .all<{ natural_key: string; payload_hash: string }>();
    for (const r of results) found.set(r.natural_key, r.payload_hash);
  }
  return found;
}

/**
 * Stores source records idempotently. Identical records are counted as duplicates;
 * a record whose payload changed upstream (same natural key) is updated in place.
 */
export async function insertSourceRecords(
  db: D1Database,
  athleteId: string,
  syncRunId: string,
  recs: SourceRecordInput[],
): Promise<InsertCounts> {
  const counts: InsertCounts = { accepted: 0, duplicates: 0, updated: 0 };
  const unique = new Map<string, SourceRecordInput>();
  for (const r of recs) {
    const id = `${r.source}\u0000${r.naturalKey}`;
    if (unique.has(id)) counts.duplicates++;
    else unique.set(id, r);
  }

  const bySource = new Map<string, SourceRecordInput[]>();
  for (const r of unique.values()) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const [source, group] of bySource) {
    const existing = await existingHashes(db, athleteId, source, group.map((r) => r.naturalKey));
    for (const r of group) {
      const payload = stableStringify(r.payload);
      const hash = await sha256Hex(payload);
      const prior = existing.get(r.naturalKey);
      if (prior === hash) {
        counts.duplicates++;
        continue;
      }
      if (prior === undefined) counts.accepted++;
      else counts.updated++;
      statements.push(
        db
          .prepare(
            `INSERT INTO source_records
               (athlete_id, source, kind, natural_key, payload, payload_hash, start_utc, end_utc, local_date, tz, sync_run_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (athlete_id, source, natural_key) DO UPDATE SET
               kind = excluded.kind, payload = excluded.payload, payload_hash = excluded.payload_hash,
               start_utc = excluded.start_utc, end_utc = excluded.end_utc, local_date = excluded.local_date,
               tz = excluded.tz, sync_run_id = excluded.sync_run_id, updated_at = excluded.updated_at
             WHERE source_records.payload_hash <> excluded.payload_hash`,
          )
          .bind(athleteId, source, r.kind, r.naturalKey, payload, hash, r.startUtc, r.endUtc, r.localDate, r.tz, syncRunId, now),
      );
    }
  }
  await runBatches(db, statements);
  return counts;
}

export async function loadSourceRecords(db: D1Database, athleteId: string): Promise<StoredSourceRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT id, source, kind, natural_key, payload, start_utc, end_utc, local_date, tz
       FROM source_records WHERE athlete_id = ? ORDER BY id`,
    )
    .bind(athleteId)
    .all<Record<string, string | number | null>>();
  return results.map((r) => ({
    id: Number(r.id),
    source: r.source as StoredSourceRecord["source"],
    kind: r.kind as StoredSourceRecord["kind"],
    naturalKey: String(r.natural_key),
    payload: r.payload == null ? null : JSON.parse(String(r.payload)),
    startUtc: (r.start_utc as string | null) ?? null,
    endUtc: (r.end_utc as string | null) ?? null,
    localDate: (r.local_date as string | null) ?? null,
    tz: (r.tz as string | null) ?? null,
  }));
}

export interface Connection {
  provider: string;
  status: "connected" | "syncing" | "error" | "disconnected";
  mode: "demo" | "live" | "file";
  credentials: { token: string; externalId: string } | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export async function getConnections(db: D1Database, athleteId: string): Promise<Connection[]> {
  const { results } = await db
    .prepare("SELECT provider, status, mode, credentials, last_sync_at, last_error FROM connections WHERE athlete_id = ? ORDER BY provider")
    .bind(athleteId)
    .all<Record<string, string | null>>();
  return results.map((r) => ({
    provider: String(r.provider),
    status: r.status as Connection["status"],
    mode: r.mode as Connection["mode"],
    credentials: r.credentials ? JSON.parse(r.credentials) : null,
    lastSyncAt: r.last_sync_at,
    lastError: r.last_error,
  }));
}

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { currentGeneration, runReconcile } from "../../src/worker/reconcileStore";
import { insertAllFixtureRecords, expectedFixture } from "./seed";

const A = "ath_recon";
const TZ = "America/Los_Angeles";

beforeEach(async () => {
  await insertAllFixtureRecords(A);
});

const one = async <T>(sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<T>())!;

describe("runReconcile", () => {
  it("builds one session per expected canonical workout", async () => {
    const out = await runReconcile(env.DB, A, TZ);
    expect(out.sessions).toBe(expectedFixture.canonicalWorkouts.length);
    expect(out.needsReview).toBe(1);
    expect(out.duplicatesRemoved).toBe(expectedFixture.duplicates.length);
    expect((await one<{ n: number }>("SELECT count(*) n FROM sessions WHERE athlete_id = ?", A)).n).toBe(out.sessions);
  });

  it("is idempotent", async () => {
    await runReconcile(env.DB, A, TZ);
    const keys = async () =>
      (await env.DB.prepare("SELECT session_key FROM sessions WHERE athlete_id = ? ORDER BY session_key").bind(A).all<{ session_key: string }>()).results.map((r) => r.session_key);
    const first = await keys();
    const counts = async () => one<{ s: number; r: number; m: number; n: number }>(
      `SELECT (SELECT count(*) FROM session_sources ss JOIN sessions s ON s.id = ss.session_id WHERE s.athlete_id = ?1) s,
              (SELECT count(*) FROM results WHERE athlete_id = ?1) r,
              (SELECT count(*) FROM measurements WHERE athlete_id = ?1) m,
              (SELECT count(*) FROM notes WHERE athlete_id = ?1) n`,
      A,
    );
    const before = await counts();
    await runReconcile(env.DB, A, TZ);
    expect(await keys()).toEqual(first);
    expect(await counts()).toEqual(before);
  });

  it("applies a stored merge decision", async () => {
    await runReconcile(env.DB, A, TZ);
    const split = await one<{ session_key: string }>("SELECT session_key FROM sessions WHERE athlete_id = ? AND status = 'review_required'", A);
    await env.DB.prepare("INSERT INTO decisions (athlete_id, scope_key, action, payload, decided_at) VALUES (?, ?, 'merge', '{}', ?)")
      .bind(A, split.session_key, new Date().toISOString())
      .run();
    await runReconcile(env.DB, A, TZ);
    expect((await one<{ status: string }>("SELECT status FROM sessions WHERE athlete_id = ? AND session_key = ?", A, split.session_key)).status).toBe("confirmed");
  });

  it("stores nine Fran results", async () => {
    await runReconcile(env.DB, A, TZ);
    expect((await one<{ n: number }>("SELECT count(*) n FROM results WHERE athlete_id = ? AND benchmark = 'fran'", A)).n).toBe(9);
  });

  it("links every WodUp result to a session", async () => {
    await runReconcile(env.DB, A, TZ);
    expect((await one<{ n: number }>("SELECT count(*) n FROM results WHERE athlete_id = ? AND session_id IS NULL", A)).n).toBe(0);
  });

  it("does not double count a duplicate workout", async () => {
    await runReconcile(env.DB, A, TZ);
    const n = await one<{ n: number }>("SELECT count(*) n FROM measurements WHERE athlete_id = ? AND type = 'distance_m' AND local_date = '2026-10-04'", A);
    expect(n.n).toBe(1);
  });

  it("stores the run conflict with both values", async () => {
    await runReconcile(env.DB, A, TZ);
    const c = await one<{ values_json: string; chosen: string }>("SELECT values_json, chosen FROM conflicts WHERE athlete_id = ? AND field = 'distance_m'", A);
    expect(JSON.parse(c.values_json)).toEqual({ wodup: 5000, apple_health: 5210 });
    expect(c.chosen).toBe("apple_health");
  });

  it("two athletes can reconcile at the same time", async () => {
    await insertAllFixtureRecords("ath_other");
    const [a, b] = await Promise.all([runReconcile(env.DB, A, TZ), runReconcile(env.DB, "ath_other", TZ)]);
    expect(a.sessions).toBe(expectedFixture.canonicalWorkouts.length);
    expect(b.sessions).toBe(expectedFixture.canonicalWorkouts.length);
  });

  it("a crashed rebuild's rows never become current and are cleaned up next time", async () => {
    await runReconcile(env.DB, A, TZ);
    const gen = await currentGeneration(env.DB, A);
    await env.DB.prepare(
      "INSERT INTO sessions (athlete_id, generation, session_key, local_date, kind, category, status) VALUES (?, 'crashed', 'k', '2026-10-01', 'other', 'mixed', 'auto_match')",
    )
      .bind(A)
      .run();
    const current = await one<{ n: number }>("SELECT count(*) n FROM sessions WHERE athlete_id = ? AND generation = ?", A, gen);
    expect(current.n).toBe(expectedFixture.canonicalWorkouts.length);
    await runReconcile(env.DB, A, TZ);
    expect((await one<{ n: number }>("SELECT count(*) n FROM sessions WHERE athlete_id = ?", A)).n).toBe(expectedFixture.canonicalWorkouts.length);
    expect(await currentGeneration(env.DB, A)).not.toBe(gen);
  });

  it("every stored row belongs to the current generation", async () => {
    await runReconcile(env.DB, A, TZ);
    const gen = await currentGeneration(env.DB, A);
    for (const t of ["sessions", "results", "measurements", "notes", "conflicts"]) {
      const stray = await one<{ n: number }>(`SELECT count(*) n FROM ${t} WHERE athlete_id = ? AND generation <> ?`, A, gen);
      expect(stray.n).toBe(0);
    }
  });
});

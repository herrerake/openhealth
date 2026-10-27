import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { runReconcile } from "../../src/worker/reconcileStore";
import { authedFetch, createAthlete } from "./helpers";
import { insertAllFixtureRecords } from "./seed";

const TZ = "America/Los_Angeles";
let cookie: string;
let athleteId: string;

async function seededAthlete(name = "Alex Rivera"): Promise<{ cookie: string; id: string }> {
  const c = await createAthlete(name);
  const id = (await (await authedFetch("/api/me", {}, c)).json<{ id: string }>()).id;
  await insertAllFixtureRecords(id);
  await runReconcile(env.DB, id, TZ);
  return { cookie: c, id };
}

beforeEach(async () => {
  ({ cookie, id: athleteId } = await seededAthlete());
});

const get = async (path: string, c = cookie): Promise<any> => (await authedFetch(path, {}, c)).json();
const getRaw = (path: string, c = cookie) => authedFetch(path, {}, c);
const postRaw = (key: string, body: unknown) =>
  authedFetch(`/api/review/${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, cookie);
const post = async (key: string, body: unknown): Promise<any> => {
  const r = await postRaw(key, body);
  expect(r.status).toBe(200);
  return r.json();
};
const itemKey = async (date: string): Promise<string> => (await get("/api/review")).find((i: any) => i.localDate === date).sessionKey;
const recentKey = async (date: string): Promise<string> => (await get(`/api/tiles/recent_sessions?asOf=${date}`)).value[0].sessionKey;

describe("review actions", () => {
  it("lists the queue", async () => {
    expect((await get("/api/review")).map((i: any) => i.kind)).toEqual(["confirm", "merge_split", "pick"]);
  });

  it("merging the split workout clears it from the queue and confirms the class", async () => {
    const key = await itemKey("2026-10-17");
    const r = await post(key, { action: "merge" });
    expect(r.queue.map((i: any) => i.localDate)).not.toContain("2026-10-17");
    expect((await get(`/api/sessions/${encodeURIComponent(key)}`)).session.status).toBe("confirmed");
  });

  it("splitting produces two sessions that day", async () => {
    await post(await itemKey("2026-10-17"), { action: "split" });
    const recent = await get("/api/tiles/recent_sessions?asOf=2026-10-17");
    expect(recent.value.filter((s: any) => s.localDate === "2026-10-17")).toHaveLength(2);
  });

  it("picking one field records the athlete's choice for that field", async () => {
    const key = await itemKey("2026-10-18");
    await post(key, { action: "pick", payload: { field: "distance_m", source: "wodup" } });
    const d = await get(`/api/sessions/${encodeURIComponent(key)}`);
    expect(d.conflicts.find((c: any) => c.field === "distance_m")).toMatchObject({ chosen: "wodup", resolvedBy: "athlete" });
  });

  it("picking a source for the whole session clears it from the queue", async () => {
    const r = await post(await itemKey("2026-10-18"), { action: "pick", payload: { source: "apple_health" } });
    expect(r.queue.map((i: any) => i.localDate)).not.toContain("2026-10-18");
  });

  it("rejects an action that doesn't fit the item", async () => {
    expect((await postRaw(await itemKey("2026-10-02"), { action: "split" })).status).toBe(400);
  });

  it("rejects a pick with an unknown source", async () => {
    expect((await postRaw(await itemKey("2026-10-18"), { action: "pick", payload: { field: "distance_m", source: "strava" } })).status).toBe(400);
  });

  it("decisions survive a fresh sync", async () => {
    await post(await itemKey("2026-10-02"), { action: "confirm" });
    await runReconcile(env.DB, athleteId, TZ);
    expect((await get("/api/review")).map((i: any) => i.localDate)).not.toContain("2026-10-02");
  });

  it("a session with two kinds of review accepts either action", async () => {
    const key = await itemKey("2026-10-17");
    await env.DB.prepare(
      `UPDATE sessions SET flags = '["ambiguous_split_apple_workout","logged_hours_later"]'
       WHERE athlete_id = ? AND session_key = ? AND generation = (SELECT generation FROM reconcile_generations WHERE athlete_id = ?)`,
    )
      .bind(athleteId, key, athleteId)
      .run();
    const kinds = (await get("/api/review")).filter((i: any) => i.sessionKey === key).map((i: any) => i.kind).sort();
    expect(kinds).toEqual(["confirm", "merge_split"]);
    expect((await postRaw(key, { action: "merge" })).status).toBe(200);
  });

  it("an unknown session key is not found", async () => {
    expect((await postRaw("visit:nope", { action: "confirm" })).status).toBe(404);
  });
});

describe("session detail", () => {
  it("explains every source", async () => {
    const d = await get(`/api/sessions/${encodeURIComponent(await recentKey("2026-10-20"))}`);
    expect(d.sources.map((s: any) => s.source).sort()).toEqual(["apple_health", "apple_health", "mindbody", "wodup", "wodup"]);
    expect(d.sources.every((s: any) => s.summary.length > 5)).toBe(true);
    expect(d.sources.find((s: any) => s.kind === "workout").summary).toMatch(/^Apple Watch workout/);
    expect(d.results[0]).toMatchObject({ benchmark: "fran", value: 261 });
    expect(d.notes.map((n: any) => n.text)).toContain("Unbroken thrusters. Finally.");
  });

  it("another athlete's session is not found", async () => {
    const other = await seededAthlete("Someone Else");
    const key = await (async () => (await get("/api/tiles/recent_sessions?asOf=2026-10-20", other.cookie)).value[0].sessionKey)();
    // Same synthetic data means the same keys exist for both athletes; prove scoping with a key only `other` has after a split.
    const theirs = await (await authedFetch(`/api/review`, {}, other.cookie)).json<any[]>();
    const split = theirs.find((i) => i.localDate === "2026-10-17").sessionKey;
    await authedFetch(`/api/review/${encodeURIComponent(split)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "split" }) }, other.cookie);
    const theirRecent = await get("/api/tiles/recent_sessions?asOf=2026-10-17", other.cookie);
    const onlyTheirs = theirRecent.value.map((s: any) => s.sessionKey).find((k: string) => k !== split && k.startsWith("workout:"));
    expect(key).toBeTruthy();
    expect((await getRaw(`/api/sessions/${encodeURIComponent(onlyTheirs)}`)).status).toBe(404);
  });
});

# Phase A: Data Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two years of synthetic WodUp, Mindbody and Apple Health data flow through real connectors into one D1 store with provenance. They are reconciled into canonical sessions by a sync run that reports live progress and timings.

**Architecture:** A Cloudflare Worker (Hono) serves the API and mock providers that copy the real WodUp and Mindbody API shapes. An `AthleteAgent` Durable Object (Agents SDK) runs sync runs and broadcasts progress through agent state. Pure logic (time, normalization, Apple parsing, reconciliation) lives in `src/core` with no Workers APIs, so it runs in Node tests and in the browser later (Phase B). D1 holds the data and R2 holds the mock fixture payloads.

**Tech Stack:**
- Node 22, TypeScript 5.9.3, wrangler 4.154.0, hono 4.13.14, agents 0.31.0;
- vitest 4.1.12 with @cloudflare/vitest-pool-workers 0.23.0;
- saxes 6.0.0, fflate 0.8.3, ajv 8 (Node tests only).

**Spec:** `docs/SPEC.md` (v0.2, approved 2026-10-27), §§0–6, 9, 10, 12. Also `docs/PRD.md` §6.1 (A1–A3), H1, H2, H11, H12, plus `docs/STORY-PLAYBOOK.md` §8 and `fixtures/README.md`.

## Global Constraints

- Pin exact versions as listed in Tech Stack. Do not enable `experimentalDecorators` (it breaks `@callable`).
- All timestamps are stored as ISO-8601 UTC text (`2026-10-20T13:03:00Z`). `local_date` is `YYYY-MM-DD` in the record's own local time.
- Normalized units are lbs (loads), meters, seconds, bpm, ms, minutes (sleep). Original values stay in `payload`.
- `athlete_id` is on every table. Never edit an applied migration; add a new one.
- D1 writes go in `db.batch()` chunks of ≤ 500 statements.
- Site time zone default is `America/Los_Angeles` (`SITE_TZ` var). The fixture window is 2024-10-28 → 2026-10-25.
- Reconcile thresholds (SPEC §6.3):

  | Rule | Value |
  |---|---|
  | Apple dedupe | \|Δstart\| ≤ 2 min, \|Δend\| ≤ 5 min |
  | Visit overlap window | ±15 min |
  | WodUp attach to Apple workout | end within 90 min of `done_at` |
  | `logged_hours_later` flag | > 6 h after the anchor |

- Per-provider sync retries are bounded at 3 attempts.
- Source priority for duplicates: Apple Watch (`sourceName` ending in "Apple Watch") > any other.
- Conflict precedence: device-measured over self-logged (D-010). Never average.
- Performance targets (SPEC §10):

  | Stage | Target |
  |---|---|
  | Apple parse of the 40 MB fixture | < 15 s |
  | WodUp + Mindbody sync | < 10 s |
  | Reconcile, 2 years | < 5 s |

- Commits end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

These inputs are implied by the spec but not exercised by the per-task tests below. Each line names the input, the behavior a reasonable person expects, and the test that pins it.

1. **Real Apple exports from older iOS versions.** These carry `totalEnergyBurned`/`totalDistance` attributes instead of `WorkoutStatistics` children. The parser reads both. Test: `parses attribute-style workout totals` (Task 10).
2. **Workouts recorded while travelling.** A workout logged at `-0400` belongs to its own local date, not the athlete's home-zone date. Test: `uses the record's own offset for local_date` (Task 10).
3. **A source record edited upstream.** Example: a WodUp result re-scored, with the same ID and a new payload. A re-sync updates it (counted as `updated`); it is not silently ignored. Test: `re-sync with changed payload updates and counts updated` (Task 4).
4. **Double-clicking Sync.** A second `startSync` while a run is in progress returns the current run ID and doesn't start a parallel run. Test: `startSync while running returns the active run` (Task 13).
5. **A sync interrupted mid-run** (Durable Object evicted, tab closed). The next `startSync` closes the stale `running` run as `error: interrupted` and completes idempotently. Test: `stale running run is closed on next start` (Task 13).

---

## File Structure

```
openhealth/
  package.json  tsconfig.json  wrangler.jsonc  vitest.config.ts  .gitignore  .dev.vars.example
  fixtures/generate.mjs (modify)  fixtures/validate.mjs (modify)  fixtures/README.md (modify)
  src/core/
    types.ts            shared types: ProviderId, SourceRecordInput, SourceBatch, Decision, …
    time.ts             zone conversions (Intl), Apple/Mindbody/WodUp time parsing
    normalize.ts        payload → results / measurements / notes rows; benchmark tagging
    apple/parse.ts      two-pass streaming export parser (saxes), HR aggregation
    apple/unzip.ts      streaming zip → export.xml bytes (fflate)
    reconcile/index.ts  reconcile(): dedupe, anchor, attach, leftovers, conflicts, decisions
    reconcile/keys.ts   scope keys for decisions
  src/connectors/
    types.ts            Connector, SyncContext, ScopeDescription
    registry.ts         catalog of 8 providers
    wodup.ts  mindbody.ts  appleHealth.ts  stubs.ts
  src/worker/
    index.ts            Hono app + routeAgentRequest; exports AthleteAgent
    env.ts              Env type
    session.ts          athlete cookie sign/verify, requireAthlete middleware
    store.ts            insertSourceRecords, loadSourceRecords, connection CRUD
    reconcileStore.ts   runReconcile(): load → reconcile() → persist
    agent.ts            AthleteAgent
    routes/athletes.ts  routes/providers.ts  routes/connect.ts  routes/sync.ts
    mock/oauth.ts  mock/wodup.ts  mock/mindbody.ts  mock/fixtures.ts
  src/db/migrations/0001_init.sql
  scripts/seed-mock.sh  scripts/demo-sync.ts
  test/core/*.test.ts   (Node project)   test/worker/*.test.ts (Workers project)   test/setup-worker.ts
```

---

### Task 0: Repository bootstrap

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`, `.gitignore`, `.dev.vars.example`
- Create: `src/worker/index.ts`, `src/worker/env.ts`, `test/setup-worker.ts`, `test/worker/health.test.ts`

**Interfaces:**
- Produces: `Env` in `src/worker/env.ts`:
  ```ts
  { DB: D1Database; RAW: R2Bucket; AthleteAgent: DurableObjectNamespace<AthleteAgent>;
    SITE_TZ: string; PROVIDER_MODE: "demo"|"live"; SESSION_SECRET: string }
  ```
- Produces: `app` (a Hono instance) exported from `src/worker/index.ts`. The default export is `{ fetch }`, which tries `routeAgentRequest` first, then `app.fetch`.
- Produces: npm scripts `test`, `test:core`, `test:worker`, `dev`, `fixtures`, `seed:mock`, `demo:sync`.

- [ ] **Step 1: `git init`.** Add `.gitignore` with `node_modules/ .wrangler/ .dev.vars fixtures/data/ out/ assets/ .superpowers/`. Commit the existing `docs/` and `fixtures/` as "chore: import docs and fixtures".
- [ ] **Step 2: Write `package.json`** with the exact versions from Tech Stack, `"type": "module"`, and these scripts:

  | Script | Runs |
  |---|---|
  | `test` | `vitest run` |
  | `test:core` | `vitest run --project core` |
  | `test:worker` | `vitest run --project worker` |
  | `dev` | `wrangler dev` |
  | `fixtures` | `node fixtures/generate.mjs && node fixtures/validate.mjs` |
  | `seed:mock` | `sh scripts/seed-mock.sh` |
  | `demo:sync` | `tsx scripts/demo-sync.ts` |

  Keep the existing ajv devDependencies. Then run `npm install`.
- [ ] **Step 3: Write `wrangler.jsonc`:**
  - `name: "openhealth"`, `main: "src/worker/index.ts"`, `compatibility_date: "2026-10-01"`, `compatibility_flags: ["nodejs_compat"]`;
  - D1 binding `DB` with `migrations_dir: "src/db/migrations"`;
  - R2 binding `RAW` (bucket `openhealth-raw`);
  - Durable Object binding `AthleteAgent` → class `AthleteAgent`, migration `{ tag: "v1", new_sqlite_classes: ["AthleteAgent"] }`;
  - vars `SITE_TZ`, `PROVIDER_MODE: "demo"`.

  `.dev.vars.example` holds `SESSION_SECRET=change-me`.
- [ ] **Step 4: Write `vitest.config.ts`** with two projects:
  - `core`: Node environment, `test/core/**`.
  - `worker`: the @cloudflare/vitest-pool-workers 0.23 config (per its README for vitest 4), pointing at `wrangler.jsonc`. Read the D1 migrations in config and apply them in `test/setup-worker.ts` with `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)`. Provide `SESSION_SECRET: "test-secret"` as a binding.
- [ ] **Step 5: Write the failing test** `test/worker/health.test.ts`:
  ```ts
  import { SELF } from "cloudflare:test";
  it("GET /api/health returns ok", async () => {
    const r = await SELF.fetch("http://x/api/health");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });
  ```
- [ ] **Step 6: Run `npm run test:worker`.** Expected: FAIL (404 or module missing).
- [ ] **Step 7: Implement** `GET /api/health` in `src/worker/index.ts`, and an empty `AthleteAgent extends Agent<Env, unknown>` in `src/worker/agent.ts`, exported from index.
- [ ] **Step 8: Run `npm test`.** Expected: PASS.
- [ ] **Step 9: Commit** `chore: bootstrap worker, d1, r2, agent and test projects`.

---

### Task 1: Time module

**Files:** Create `src/core/time.ts`, `src/core/types.ts`; Test `test/core/time.test.ts`

**Interfaces:**
- Produces from `src/core/time.ts`:
  - `zonedWallToUtc(wall: string, tz: string): string` — wall is `YYYY-MM-DDTHH:mm:ss`.
  - `utcToLocalDate(utc: string, tz: string): string`
  - `parseAppleDate(s: string): { utc: string; offsetMinutes: number; localDate: string }` — input `YYYY-MM-DD HH:MM:SS ±HHMM`.
  - `normalizeWodupUtc(s: string): string` — microseconds → `…:SSZ`, keeping seconds precision.
- Produces from `src/core/types.ts`: `ProviderId`, `SourceKind`, `SourceRecordInput`, `StoredSourceRecord`, `SourceBatch`, `Decision`, exactly as follows:
  ```ts
  type ProviderId = "wodup"|"mindbody"|"apple_health"|"garmin"|"oura"|"whoop"|"hyrox"|"race_results";
  type SourceKind = "visit"|"training_session"|"result"|"workout"|"daily_metric"|"hr_aggregate";
  interface SourceRecordInput { source: ProviderId; kind: SourceKind; naturalKey: string; payload: unknown;
    startUtc: string|null; endUtc: string|null; localDate: string|null; tz: string|null }
  interface StoredSourceRecord extends SourceRecordInput { id: number }
  interface SourceBatch { records: SourceRecordInput[]; progress: { label: string; done: number; total?: number } }
  interface Decision { scopeKey: string; action: "merge"|"split"|"pick"|"confirm"; payload: Record<string, unknown> }
  ```

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("converts PDT wall time", () => expect(zonedWallToUtc("2026-09-28T06:00:00","America/Los_Angeles")).toBe("2026-09-28T13:00:00Z"));
  it("converts PST wall time", () => expect(zonedWallToUtc("2025-01-06T06:00:00","America/Los_Angeles")).toBe("2025-01-06T14:00:00Z"));
  it("spring-forward gap shifts forward", () => expect(zonedWallToUtc("2025-03-09T02:30:00","America/Los_Angeles")).toBe("2025-03-09T10:30:00Z"));
  it("fall-back ambiguity takes first occurrence", () => expect(zonedWallToUtc("2025-11-02T01:30:00","America/Los_Angeles")).toBe("2025-11-02T08:30:00Z"));
  it("local date across UTC midnight", () => expect(utcToLocalDate("2026-10-22T00:28:00Z","America/Los_Angeles")).toBe("2026-10-21"));
  it("parses Apple dates with offset", () => expect(parseAppleDate("2026-10-21 17:28:00 -0700"))
    .toEqual({ utc: "2026-10-22T00:28:00Z", offsetMinutes: -420, localDate: "2026-10-21" }));
  it("normalizes WodUp microseconds", () => expect(normalizeWodupUtc("2026-10-20T13:07:00.000000Z")).toBe("2026-10-20T13:07:00Z"));
  ```
- [ ] **Step 2: Run `npm run test:core -- time`.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement** with `Intl.DateTimeFormat(..., { timeZone, hourCycle: "h23" })`. Find the offset by guess-and-correct twice (handles the gap and the ambiguity as the tests pin). No date library.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): zone-aware time conversions`.

---

### Task 2: Two-year fixture generator: calendar, DST, edge cases (H1, part 1)

**Files:** Modify `fixtures/generate.mjs`, `fixtures/validate.mjs`; Test `test/core/fixtures.test.ts`

**Interfaces:**
- Produces: `fixtures/data/{wodup/training_sessions.json, wodup/athlete.json, mindbody/client_visits.json, apple-health/export.xml, expected.json}` with the same shapes as today, extended to two years.
- Produces: the `expected.json` keys `canonicalWorkouts[]`, `unmatchedVisits[]`, `duplicates[]`, `conflicts[]` (shapes unchanged), plus `window: { from: "2024-10-28", to: "2026-10-25" }`.

- [ ] **Step 1: Write the failing tests** (they read the generated files):
  ```ts
  it("covers the two-year window", () => { expect(expected.window).toEqual({ from:"2024-10-28", to:"2026-10-25" });
    expect(minLocalDate(expected.canonicalWorkouts)).toBe("2024-10-28"); expect(maxLocalDate(expected.canonicalWorkouts)).toBe("2026-10-25"); });
  it("uses PST in winter and PDT in summer", () => {
    expect(appleWorkoutStarts().some(s => s.startsWith("2025-01-") && s.endsWith("-0800"))).toBe(true);
    expect(appleWorkoutStarts().some(s => s.startsWith("2025-07-") && s.endsWith("-0700"))).toBe(true); });
  it("keeps the 12 edge cases in the final four weeks", () => {
    const last4 = expected.canonicalWorkouts.filter(c => c.localDate >= "2026-09-28");
    expect(last4.find(c => c.localDate==="2026-10-17")!.status).toBe("review_required");
    expect(expected.duplicates.some(d => d.duplicate.startsWith("Strava|") && d.duplicate.includes("2026-10-04"))).toBe(true);
    expect(expected.unmatchedVisits.map(u => u.reason)).toEqual(expect.arrayContaining(["late_cancelled","no_show_overlaps_solo_run"]));
    expect(expected.conflicts.some(c => c.localDate==="2026-10-18")).toBe(true); });
  it("stays under 40 MB for export.xml", () => expect(statSync(appleXmlPath).size).toBeLessThan(40*1024*1024));
  it("is deterministic", () => expect(hashGeneratedTwice()).toEqual({ same: true }));
  it("passes validate.mjs", () => expect(execFileSync("node",["fixtures/validate.mjs"]).toString()).toContain("match the OpenAPI spec"));
  ```
- [ ] **Step 2: Run `npm run fixtures && npm run test:core -- fixtures`.** Expected: FAIL (the window is 4 weeks).
- [ ] **Step 3: Rework the generator.**
  - Replace `OFFSET`/`OFFSET_MS` with a per-instant offset from `Intl` (same approach as `src/core/time.ts`; duplicate the ~20 lines in the `.mjs`, since fixtures stay dependency-free).
  - Loop 104 weeks. Normal weeks use the existing weekly template with seeded variation:
    - attendance 3–6;
    - a holiday dip in the weeks of Dec 22 and Jul 4;
    - an open gym about every 6 weeks.
  - Run the existing planted-case code unchanged for the final 4 weeks (from 2026-09-28).
  - Heart rate is sampled every 30 s before 2026-09-28 and every 15 s after.
  - Validator: also assert that each Apple date's offset matches America/Los_Angeles at that instant.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(fixtures): two-year window with real DST and preserved edge cases`.

---

### Task 3: Fixture storylines, decoys and notes (H1, part 2)

**Files:** Modify `fixtures/generate.mjs`, `fixtures/README.md`; Test `test/core/storylines.test.ts`

**Interfaces:**
- Produces: `expected.json → storylines[]`, as `{ id, angles: string[], from, to, facts: Record<string, unknown> }`, with these `id`s: `fran_rematch`, `summer_gap`, `squat_plateau`, `long_streak`, `row_less_strain`, `winter_fridays`, `heavy_weeks`, `grip_words`, `row_standout`.
- Produces: `expected.json → decoys[]`, as `{ id, from, to, mustNotFire: string[] }`, with `id`s `single_great_day` (mustNotFire `["rematch","plateauBroken"]`) and `short_trend` (mustNotFire `["plateauBroken"]`).

- [ ] **Step 1: Write the failing tests** (values pinned from Playbook §8 and D-018):
  ```ts
  it("plants nine Frans stuck near 5:05 then 4:21", () => { const f = franResults();
    expect(f).toHaveLength(9); expect(f.at(-1)).toEqual({ date:"2026-10-20", seconds:261 });
    expect(f.slice(0,8).every(r => r.seconds >= 295 && r.seconds <= 315)).toBe(true); });
  it("has a 27-day gap with no records in any source", () => {
    expect(recordsBetween("2025-06-09","2025-07-05")).toBe(0);
    expect(notesOn("2025-07-07")).toContain("First day back. Slow."); });
  it("squat sits at 225 for 8+ weeks then breaks to 235+", () => { const s = squatTopSetsByWeek();
    expect(longestRunAt(s, 225)).toBeGreaterThanOrEqual(8); expect(firstAfterRun(s, 225)).toBeGreaterThanOrEqual(235);
    expect(s.at(-1)!.lbs).toBeGreaterThanOrEqual(240); });
  it("has a 14-week run of 4+ sessions", () => expect(longestWeeksAtLeast(expected.canonicalWorkouts, 4)).toBe(14));
  it("says 'grip' in 3+ notes across 2+ months", () => { const g = notesContaining("grip");
    expect(g.length).toBeGreaterThanOrEqual(3); expect(new Set(g.map(n => n.date.slice(0,7))).size).toBeGreaterThanOrEqual(2); });
  it("keeps the injection note verbatim", () => expect(allNotes().some(n => n.text.includes("IGNORE ALL PREVIOUS INSTRUCTIONS"))).toBe(true));
  it("lists every storyline and decoy", () => { expect(expected.storylines.map(s => s.id).sort()).toEqual([...STORY_IDS].sort());
    expect(expected.decoys.map(d => d.id).sort()).toEqual(["short_trend","single_great_day"]); });
  it("ends with the Unbroken note on Fran day", () => expect(notesOn("2026-10-20")).toContain("Unbroken thrusters. Finally."));
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** storyline planting as a schedule layer over the Task 2 calendar.
  - Each storyline overrides benchmark values or notes on specific dates and writes its `facts` (dates, values, record IDs) into `expected.storylines`.
  - The gap removes the Mindbody visits, WodUp sessions and Apple workouts/records for 2025-06-09 → 2025-07-05.
  - `row_less_strain`: the matched 2k-row pace has watch average HR falling ~9 bpm over Apr → Oct 2026.
  - `winter_fridays`: Mindbody late-cancels clustered on Fridays from Dec to Feb.
  - `heavy_weeks`: the top-volume weeks are followed by a lower 3-day HRV.
  - `row_standout`: 7:28 on 2026-04-14, then back to typical.
  - Decoys:
    - `single_great_day`: one deadlift day far above typical with no confirmation.
    - `short_trend`: a 3-week back-squat rise that stays inside the noise band.
  - Notes are written in one dry, first-person voice.
  - Update `fixtures/README.md` (window, storylines table).
- [ ] **Step 4: Run** `npm run fixtures && npm run test:core`. Expected: PASS (the Task 2 tests still pass).
- [ ] **Step 5: Commit** `feat(fixtures): plant storylines and decoys`.

---

### Task 4: Schema and source-record store (A2)

**Files:** Create `src/db/migrations/0001_init.sql`, `src/worker/store.ts`; Test `test/worker/store.test.ts`

**Interfaces:**
- Produces: all tables in SPEC §5, plus these additions:
  - `source_records.payload_hash TEXT NOT NULL` (SHA-256 of the canonical JSON);
  - `source_records.updated_at TEXT`;
  - a table `oauth_states(state TEXT PRIMARY KEY, athlete_id TEXT, provider TEXT, created_at TEXT, used_at TEXT)`.
- Produces from `src/worker/store.ts`:
  - `insertSourceRecords(db: D1Database, athleteId: string, syncRunId: string, recs: SourceRecordInput[]): Promise<{ accepted: number; duplicates: number; updated: number }>`
  - `loadSourceRecords(db: D1Database, athleteId: string): Promise<StoredSourceRecord[]>`

- [ ] **Step 1: Write the failing tests:**
  ```ts
  const rec = (k: string, p: unknown) => ({ source:"wodup", kind:"result", naturalKey:k, payload:p, startUtc:"2026-10-20T13:07:00Z", endUtc:null, localDate:"2026-10-20", tz:null });
  it("inserts then dedupes identical records", async () => {
    expect(await insertSourceRecords(env.DB,"a1","r1",[rec("result:r_1",{v:1}), rec("result:r_2",{v:2})])).toEqual({ accepted:2, duplicates:0, updated:0 });
    expect(await insertSourceRecords(env.DB,"a1","r2",[rec("result:r_1",{v:1})])).toEqual({ accepted:0, duplicates:1, updated:0 }); });
  it("re-sync with changed payload updates and counts updated", async () => {
    await insertSourceRecords(env.DB,"a1","r1",[rec("result:r_9",{v:1})]);
    expect(await insertSourceRecords(env.DB,"a1","r2",[rec("result:r_9",{v:2})])).toEqual({ accepted:0, duplicates:0, updated:1 });
    expect((await loadSourceRecords(env.DB,"a1")).find(r => r.naturalKey==="result:r_9")!.payload).toEqual({ v:2 }); });
  it("isolates athletes", async () => { await insertSourceRecords(env.DB,"a2","r1",[rec("result:r_1",{v:1})]);
    expect((await loadSourceRecords(env.DB,"a2"))).toHaveLength(1); });
  it("chunks large inserts", async () => { const many = Array.from({length:1200},(_,i)=>rec(`result:m_${i}`,{i}));
    expect((await insertSourceRecords(env.DB,"a3","r1",many)).accepted).toBe(1200); });
  ```
- [ ] **Step 2: Run `npm run test:worker -- store`.** Expected: FAIL.
- [ ] **Step 3: Write the migration** (SPEC §5 verbatim, plus the additions above and its indexes).
- [ ] **Step 4: Implement the store.**
  - Pre-read the existing `(natural_key, payload_hash)` pairs for the incoming keys in chunks.
  - Classify each record as new, duplicate or changed.
  - Write with `INSERT … ON CONFLICT(athlete_id, source, natural_key) DO UPDATE SET payload=…, payload_hash=…, updated_at=… WHERE payload_hash <> excluded.payload_hash`, in `batch()` chunks of ≤ 500.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(db): schema and idempotent source-record store`.

---

### Task 5: Athlete session and provider catalog (A1, start of B1)

**Files:** Create `src/worker/session.ts`, `src/worker/routes/athletes.ts`, `src/worker/routes/providers.ts`, `src/connectors/types.ts`, `src/connectors/registry.ts`; Test `test/worker/providers.test.ts`

**Interfaces:**
- Produces from `src/connectors/types.ts`:
  ```ts
  interface ScopeDescription { label: string }
  interface Credentials { token: string; externalId: string }   // externalId: WodUp athlete id / Mindbody ClientId
  interface SyncContext { athleteId: string; credentials: Credentials; siteTz: string; fetch: typeof fetch; baseUrl: string }
  interface Connector { id: ProviderId; kind: "oauth"|"file"; displayName: string; category: "wearables"|"gym"|"races";
    scopes: ScopeDescription[]; status: "available"|"coming_soon"; sync?(ctx: SyncContext): AsyncIterable<SourceBatch> }
  ```
- Produces: `registry: Record<ProviderId, Connector>` and `listProviders(): Connector[]` in display order:
  - wearables: apple_health, garmin, oura, whoop;
  - gym: wodup, mindbody;
  - races: hyrox, race_results.
- Produces from `src/worker/session.ts`:
  - `signSession(athleteId: string, secret: string): Promise<string>`
  - `requireAthlete` (a Hono middleware setting `c.var.athleteId`)
  - cookie `oh_session` (HttpOnly, SameSite=Lax)
- Produces the routes:
  - `POST /api/athletes {name, primarySport, tz}` → `201 {id}` and sets the cookie;
  - `GET /api/me` → `{id, name, primarySport, tz, connections: []}`;
  - `GET /api/providers` → `[{id, displayName, category, kind, status, scopes, connection: {status, lastSyncAt}|null}]`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("creates an athlete and sets a session cookie", async () => {
    const r = await SELF.fetch("http://x/api/athletes",{ method:"POST", body: JSON.stringify({ name:"Alex Rivera", primarySport:"crossfit", tz:"America/Los_Angeles" }) });
    expect(r.status).toBe(201); expect(r.headers.get("set-cookie")).toMatch(/oh_session=/); });
  it("rejects requests without a session", async () => expect((await SELF.fetch("http://x/api/providers")).status).toBe(401));
  it("rejects a tampered cookie", async () => expect((await SELF.fetch("http://x/api/me",{ headers:{ cookie:"oh_session=a1.forged" } })).status).toBe(401));
  it("lists eight providers grouped by category", async () => { const list = await (await authedFetch("/api/providers")).json();
    expect(list.map((p:any)=>p.id)).toEqual(["apple_health","garmin","oura","whoop","wodup","mindbody","hyrox","race_results"]);
    expect(list.find((p:any)=>p.id==="apple_health").kind).toBe("file"); expect(list.every((p:any)=>p.connection===null)).toBe(true); });
  ```
  `authedFetch` lives in `test/worker/helpers.ts`; it creates an athlete and reuses the cookie.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - HMAC-SHA256 via `crypto.subtle`; the cookie value is `${athleteId}.${base64url(sig)}`.
  - Scopes per provider:

    | Provider | Scopes |
    |---|---|
    | WodUp | "Workouts, scores and PRs" / "Your notes on results" / "Programs you follow" |
    | Mindbody | "Class bookings and check-ins" / "Studio and instructor" |
    | Others | One generic line |

- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): athlete session and provider catalog`.

---

### Task 6: Mock providers: data endpoints (A1)

**Files:** Create `src/worker/mock/fixtures.ts`, `src/worker/mock/wodup.ts`, `src/worker/mock/mindbody.ts`, `scripts/seed-mock.sh`; Test `test/core/mock-pagination.test.ts`, `test/worker/mock.test.ts`

**Interfaces:**
- Produces pure pagination functions (Node-testable):
  - `paginateWodup(all: unknown[], q: { limit?: number; after_cursor?: string }): { status: 200|400; body: unknown }`
  - `paginateMindbody(all: Visit[], q: { limit?: number; offset?: number; startDate?: string; endDate?: string }): { status: 200|400; body: { PaginationResponse; Visits } }`
- Produces `loadFixture(env: Env, key: "wodup/training_sessions.json"|"mindbody/client_visits.json"): Promise<unknown>`. It reads from R2 `mock/<key>` and caches in module memory.
- Produces in `src/worker/mock/oauth.ts` (Task 7 adds the routes to this file):
  - `mintMockToken(provider: ProviderId, secret: string): Promise<string>` — returns `mock_<provider>_<base64url hmac>`.
  - `verifyMockToken(provider: ProviderId, token: string, secret: string): Promise<boolean>`
- Produces the routes:
  - `GET /mock/wodup/api/public/athletes/:id/training_sessions`
    - needs `Authorization: Basic base64(<token>:)` with a valid mock token (Task 7's `verifyMockToken`);
    - the path athlete ID must equal `ath_Ax7Rv2Lq`, else 404;
    - `limit` 1–100, default 10, else 400 with an `{ errors: [...] }` body.
  - `GET /mock/mindbody/public/v6/client/clientvisits`
    - needs the `Api-Key`, `SiteId` (`-99` accepted) and `Authorization` headers;
    - query params `request.clientId`, `request.startDate`, `request.endDate`, `request.limit` (≤ 200), `request.offset`;
    - `request.clientId` must equal `100015482`.

- [ ] **Step 1: Write the failing Node tests:**
  ```ts
  it("walks every WodUp page newest-first", () => { let cursor: string|undefined, seen: string[] = [];
    do { const { body } = paginateWodup(sessions, { limit:100, after_cursor:cursor }) as any; seen.push(...body.map((s:any)=>s.id)); cursor = body.at(-1)?.id; } while (cursor && seen.length < sessions.length);
    expect(seen).toEqual(sessions.map((s:any)=>s.id)); });
  it("rejects limit > 100", () => expect(paginateWodup(sessions,{ limit:101 }).status).toBe(400));
  it("WodUp pages validate against the OpenAPI spec", () => expect(validateSessions(paginateWodup(sessions,{ limit:100 }).body)).toBe(true));
  it("Mindbody offset pagination reports totals", () => { const { body } = paginateMindbody(visits,{ limit:200, offset:200 });
    expect(body.PaginationResponse).toEqual({ RequestedLimit:200, RequestedOffset:200, PageSize: Math.min(200, visits.length-200), TotalResults: visits.length }); });
  it("Mindbody filters by date range on local StartDateTime", () => expect(paginateMindbody(visits,{ startDate:"2026-10-01", endDate:"2026-10-07" }).body.Visits.every((v:any)=>v.StartDateTime>="2026-10-01" && v.StartDateTime<"2026-10-08")).toBe(true));
  ```
- [ ] **Step 2: Write the failing Workers tests:**
  - 401 without auth;
  - 404 for the wrong athlete/client;
  - 200 with a token minted by `mintMockToken`.
  - The setup seeds R2 from imported fixture JSON.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement** the pagination, routes and `scripts/seed-mock.sh` (`wrangler r2 object put openhealth-raw/mock/<key> --file fixtures/data/<key> --local` for both files).
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(mock): wodup and mindbody endpoints with real shapes`.

---

### Task 7: OAuth-shaped connect flow (A1, B2 backend)

**Files:** Create `src/worker/mock/oauth.ts`, `src/worker/routes/connect.ts`; Modify `src/worker/store.ts` (connection CRUD); Test `test/worker/connect.test.ts`

**Interfaces:**
- Consumes: `mintMockToken` and `verifyMockToken` (Task 6).
- Produces the mock routes:
  - `GET /mock/:provider/oauth/authorize?state&redirect_uri` → a minimal HTML consent form (Phase B styles it). With `?auto=1` it immediately 302s with a code; this is used by tests and `demo-sync`.
  - `POST /mock/:provider/oauth/token {code}` → `{ access_token, external_id }`:

    | Provider | `external_id` |
    |---|---|
    | WodUp | `ath_Ax7Rv2Lq` |
    | Mindbody | `100015482` |
    | Others | `demo` |

- Produces the API routes:
  - `GET /api/connect/:provider/start` → 302 to authorize, with a single-use `state` row;
  - `GET /api/connect/:provider/callback?code&state` → upserts the connection `{status:"connected", mode:"demo", credentials: JSON{token, externalId}}` → 302 `/onboarding/connect?connected=<provider>`;
  - `DELETE /api/connections/:provider` → status `disconnected`, data kept.
- Produces from store:
  - `getConnections(db, athleteId): Promise<Connection[]>`
  - `upsertConnection(db, athleteId, provider, patch)`
- Constraint: `apple_health` has no OAuth. `start` returns 400 `{error:"file_provider"}`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("completes the flow and stores a connection", async () => {
    const start = await authedFetch("/api/connect/wodup/start", { redirect:"manual" }); const auth = new URL(start.headers.get("location")!);
    const back = await SELF.fetch(`${auth.toString()}&auto=1`, { redirect:"manual" }); const cb = await authedFetch(new URL(back.headers.get("location")!).pathname + new URL(back.headers.get("location")!).search, { redirect:"manual" });
    expect(cb.status).toBe(302); expect((await (await authedFetch("/api/providers")).json()).find((p:any)=>p.id==="wodup").connection.status).toBe("connected"); });
  it("state is single-use", async () => { /* replay the same callback URL */ expect(replay.status).toBe(400); });
  it("unknown state is rejected", async () => expect((await authedFetch("/api/connect/wodup/callback?code=x&state=nope")).status).toBe(400));
  it("state from another athlete is rejected", async () => { /* start as athlete A, call back as athlete B */ expect(r.status).toBe(400); });
  it("apple_health has no oauth", async () => expect((await authedFetch("/api/connect/apple_health/start")).status).toBe(400));
  it("stub providers connect too", async () => expect(await connectVia("oura")).toBe("connected"));
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The state is 32 random bytes in base64url and expires after 10 min. The mock token is `mock_<provider>_<hmac>`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(connect): oauth-shaped demo sign-in with single-use state`.

---

### Task 8: Normalization (payload → results, measurements, notes)

**Files:** Create `src/core/normalize.ts`; Test `test/core/normalize.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ResultRow = { recordKey: string; benchmark: "fran"|"row_2k"|"back_squat_5x5"|"deadlift_1rm"|null; movement: string; scaling: string; metric: "time_s"|"load_lbs"|"distance_m"|"rounds"; value: number; unit: string; localDate: string }
  type MeasurementRow = { recordKey: string; type: "hr_avg"|"hr_max"|"active_kcal"|"distance_m"|"duration_s"|"rhr"|"hrv_sdnn"|"sleep_min"; value: number; unit: string; startUtc: string; endUtc: string; localDate: string }
  type NoteRow = { recordKey: string; localDate: string; text: string }
  function normalize(rec: StoredSourceRecord): { results: ResultRow[]; measurements: MeasurementRow[]; notes: NoteRow[] }
  ```
- **Benchmark rules:**

  | Benchmark | Rule |
  |---|---|
  | `fran` | type `FranStyleResult`, prescribed name "Fran", scaling `rx`. Value `details.total` seconds. |
  | `row_2k` | `CardioResult`, movement "Row", distance 2000 m. Value `duration` seconds. |
  | `back_squat_5x5` | `StrengthResult`, Back Squat, ≥5 sets of 5 reps. Value: max load. |
  | `deadlift_1rm` | `StrengthResult`, Deadlift, reps 1. Value: max load. |

- **Units:** kg × 2.20462 and pood × 36.1128 → lbs, rounded to 0.1. Minutes → seconds. km and miles → meters.

- [ ] **Step 1: Write the failing tests:**
  - one per benchmark, using records from the fixtures (Fran on 2026-10-20 → `{benchmark:"fran", value:261}`);
  - a kg strength set converts (`load:100, load_unit:"kg"` → 220.5);
  - an Apple workout yields `hr_avg`, `hr_max`, `active_kcal` and, for runs, `distance_m` (5.21 km → 5210);
  - a WodUp note yields a `NoteRow` with the exact text;
  - a Mindbody visit yields nothing.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): normalize payloads into results, measurements and notes`.

---

### Task 9: WodUp and Mindbody connectors

**Files:** Create `src/connectors/wodup.ts`, `src/connectors/mindbody.ts`, `src/connectors/stubs.ts`; Modify `src/connectors/registry.ts`; Test `test/worker/connectors.test.ts`

**Interfaces:**
- Consumes: `SyncContext`, `SourceBatch` (Tasks 1, 5), the mock routes (Task 6), `zonedWallToUtc`, `normalizeWodupUtc`.
- Produces:
  - `wodup.sync(ctx)`: yields one batch per page.
    - Records: one `training_session` (`session:<id>`) plus one `result` (`result:<id>`) per result.
    - `startUtc` is `done_at`. `localDate` is `wod.occurs_on`, or else the local date of `done_at` in `ctx.siteTz`.
    - Progress label: "WodUp · N sessions".
  - `mindbody.sync(ctx)`: walks offsets of 200 over the full window.
    - Records: `visit` (`visit:<Id>`).
    - Times come from `zonedWallToUtc(StartDateTime, ctx.siteTz)`; `tz` is set to `ctx.siteTz`.
    - Progress label: "Mindbody · N class visits".
  - Stubs (Garmin, Oura, WHOOP, HYROX, race results): yield a single batch `{ records: [], progress: { label: "No data in demo", done: 0, total: 0 } }`.

- [ ] **Step 1: Write the failing tests** (Workers pool; `ctx.fetch` routes to `app.fetch` in-process):
  ```ts
  it("WodUp sync yields every session and result once", async () => { const recs = await collect(registry.wodup.sync!(ctx("wodup")));
    expect(recs.filter(r=>r.kind==="training_session")).toHaveLength(fixtureSessions.length);
    expect(new Set(recs.map(r=>r.naturalKey)).size).toBe(recs.length); });
  it("Mindbody sync converts local times across DST", async () => { const v = (await collect(registry.mindbody.sync!(ctx("mindbody")))).find(r=>r.localDate==="2025-01-06")!;
    expect(v.startUtc).toBe("2025-01-06T14:00:00Z"); });
  it("stub sync yields an empty batch", async () => expect(await collectBatches(registry.oura.sync!(ctx("oura")))).toEqual([{ records:[], progress:{ label:"No data in demo", done:0, total:0 } }]));
  it("a 500 from the provider surfaces as a thrown error", async () => { await expect(collect(registry.wodup.sync!(ctxWithFailingFetch()))).rejects.toThrow(/wodup.*500/); });
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(connectors): wodup, mindbody and demo stubs`.

---

### Task 10: Apple Health streaming parser and batch upload (H11)

**Files:** Create `src/core/apple/parse.ts`, `src/core/apple/unzip.ts`, `src/connectors/appleHealth.ts`; Modify `src/worker/routes/connect.ts`; Test `test/core/apple.test.ts`, `test/worker/apple-upload.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function parseAppleExport(open: () => AsyncIterable<Uint8Array>, opts?: { batchSize?: number; onProgress?: (p: { pass: 1|2; bytes: number }) => void }): AsyncGenerator<SourceRecordInput[]>
  function unzipExport(chunks: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array>   // yields apple_health_export/export.xml bytes
  ```
- **Two passes:**
  - Pass 1 collects workout windows.
  - Pass 2 emits:
    - `workout` records (`workout:<sourceName>|<type>|<startDate>`), with the payload holding attributes, metadata and statistics;
    - `daily_metric` records for RestingHeartRate, HeartRateVariabilitySDNN and SleepAnalysis (`daily:<type>|<sourceName>|<startDate>`);
    - one `hr_aggregate` per workout: `{ avg, max, samples, gapsOver5Min, fileSha256 }`.
  - Raw `HeartRate` samples are never emitted.
- Default batch size: 1,000.
- Produces the route `POST /api/connect/apple_health/batches`, with body `{ fileSha256: string; records: SourceRecordInput[] }`, returning `{ accepted, duplicates, updated }`. It marks the `apple_health` connection `connected`/`file`.

- [ ] **Step 1: Write the failing Node tests:**
  ```ts
  it("parses the fixture within 15 s", async () => { const t = performance.now(); const recs = await all(parseAppleExport(() => fileChunks(xmlPath)));
    expect(performance.now() - t).toBeLessThan(15_000); expect(recs.filter(r=>r.kind==="workout").length).toBe(expectedAppleWorkoutCount); });
  it("never emits raw heart-rate samples", async () => expect(recs.some(r => (r.payload as any).type === "HKQuantityTypeIdentifierHeartRate")).toBe(false));
  it("HR aggregates equal a direct computation", async () => expect(aggregateFor("2026-10-20")).toEqual(directHrStats("2026-10-20")));
  it("keeps the Strava duplicate as its own record", async () => expect(recs.filter(r=>r.naturalKey.includes("2026-10-04 07:30:00"))).toHaveLength(2));
  it("parses attribute-style workout totals", async () => expect(oneWorkout(`<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" totalDistance="5.0" totalDistanceUnit="km" totalEnergyBurned="300" totalEnergyBurnedUnit="Cal" sourceName="Old Watch" startDate="2019-05-01 07:00:00 -0700" endDate="2019-05-01 07:30:00 -0700"/>`).payload).toMatchObject({ totals: { distance_m: 5000, active_kcal: 300 } }));
  it("uses the record's own offset for local_date", async () => expect(oneWorkout(workoutAt("2026-03-01 23:30:00 -0400")).localDate).toBe("2026-03-01"));
  it("reads a zipped export", async () => expect((await all(parseAppleExport(() => unzipExport(fileChunks(zipPath))))).length).toBe(recs.length));
  it("fails clearly on malformed XML", async () => await expect(all(parseAppleExport(() => chunksOf("<HealthData><Workout")))).rejects.toThrow(/Apple Health export.*malformed/));
  ```
  `zipPath` is created in test setup by zipping the fixture with fflate.
- [ ] **Step 2: Write the failing Workers test:** posting two batches, then the same batches again, gives `{accepted:n, duplicates:0, updated:0}` and then `{accepted:0, duplicates:n, updated:0}`.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement** with `saxes` (`xmlns: false`) and `fflate.Unzip` + `UnzipInflate`. Use `TextDecoder` with `stream: true` across chunks. Hash the file with SHA-256 during pass 1 (`crypto.subtle` digest over the concatenated chunks, or an incremental hash if available). `appleHealth` in the registry has `kind: "file"` and no `sync`.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(apple): streaming two-pass export parser and batch upload`.

---

### Task 11: Reconcile (pure) (H2)

**Files:** Create `src/core/reconcile/index.ts`, `src/core/reconcile/keys.ts`; Test `test/core/reconcile.test.ts`

**Interfaces:**
- Consumes: `StoredSourceRecord`, `Decision`, `parseAppleDate`, `zonedWallToUtc`.
- Produces:
  ```ts
  type SessionOut = { key: string; localDate: string; kind: "class"|"open_gym"|"run"|"other"; category: "strength"|"metcon"|"run"|"row"|"mixed";
    startUtc: string; endUtc: string; status: "auto_match"|"review_required"|"confirmed"; flags: string[];
    sources: { recordId: number; role: "anchor"|"supporting"|"duplicate" }[] }
  type ConflictOut = { sessionKey: string; field: "distance_m"|"duration_s"; values: Record<string, number>; chosen: string; resolvedBy: "rule"|"athlete" }
  type ReconcileResult = { sessions: SessionOut[]; unmatchedVisits: { recordId: number; reason: "late_cancelled"|"no_show" }[];
    duplicates: { kept: number; duplicate: number }[]; conflicts: ConflictOut[] }
  function reconcile(input: { records: StoredSourceRecord[]; decisions: Decision[]; siteTz: string }): ReconcileResult
  function scopeKey(recordNaturalKeys: string[]): string   // sorted keys joined with "+"
  ```
- **Rules:** SPEC §6.3, steps 1–8, in that order, with the Global Constraints thresholds.
- **Flags:**

  | Flag | When |
  |---|---|
  | `logged_hours_later` | WodUp `done_at` more than 6 h after the anchor |
  | `missing_apple_workout` | Class with Mindbody + WodUp and no watch workout |
  | `utc_date_differs_from_local` | The session's UTC date differs from its local date |
  | `no_booking` | Open gym without a Mindbody visit |
  | `ambiguous_split_apple_workout` | Two or more watch workouts overlap one class |

- Session `key` = `scopeKey` of its non-duplicate source natural keys.
- `toComparable` compares only the five reconcile flags above. The other flags in `expected.json` (`missing_heart_rate_segment`, `apple_distance_missing`, `untrusted_note_text`, `conflicting_distance_and_duration`) are data annotations. They are checked where their data lives: the HR gaps in Task 10, the notes in Task 8, and the conflicts via `ReconcileResult.conflicts`.

- [ ] **Step 1: Write the failing tests** against the fixtures (load the records by running the Node parser and the connectors' pure shaping, or read the JSON directly through a `fixtureRecords()` helper that assigns IDs):
  ```ts
  it("matches expected sessions across two years", () => { const r = reconcile({ records, decisions:[], siteTz:TZ });
    expect(toComparable(r.sessions)).toEqual(toComparable(expected.canonicalWorkouts)); });   // compares local date, kind, status, flags, source natural keys
  it("reports unmatched visits with reasons", () => expect(r.unmatchedVisits.map(u=>reasonOf(u))).toEqual(expect.arrayContaining(["late_cancelled","no_show"])));
  it("keeps the Watch and drops Strava", () => expect(r.duplicates.map(d=>keyOf(d.duplicate))).toContain("workout:Strava|HKWorkoutActivityTypeRunning|2026-10-04 07:30:00 -0700"));
  it("never averages a conflict", () => expect(r.conflicts.find(c=>c.field==="distance_m")).toMatchObject({ values:{ wodup:5000, apple_health:5210 }, chosen:"apple_health", resolvedBy:"rule" }));
  it("a merge decision survives re-run", () => { const split = r.sessions.find(s=>s.status==="review_required" && s.localDate==="2026-10-17")!;
    const again = reconcile({ records, siteTz:TZ, decisions:[{ scopeKey: split.key, action:"merge", payload:{} }] });
    expect(again.sessions.find(s=>s.key===split.key)!.status).toBe("confirmed"); });
  it("a split decision separates the watch workouts", () => { /* action:"split" yields two sessions for 2026-10-17 */ });
  it("open gym after 5 pm stays on the local date", () => expect(r.sessions.find(s=>s.kind==="open_gym" && s.startUtc.startsWith("2026-10-22"))!.localDate).toBe("2026-10-21"));
  it("reconciles two years in under 5 s", () => { const t = performance.now(); reconcile({ records, decisions:[], siteTz:TZ }); expect(performance.now()-t).toBeLessThan(5000); });
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Index records by local date. Each step only sees records not yet claimed. Sort deterministically (start time, then natural key).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): deterministic reconciliation with replayable decisions`.

---

### Task 12: Persist reconciliation (H2)

**Files:** Create `src/worker/reconcileStore.ts`; Test `test/worker/reconcile-store.test.ts`

**Interfaces:**
- Consumes: `loadSourceRecords` (Task 4), `reconcile` (Task 11), `normalize` (Task 8).
- Produces: `runReconcile(db: D1Database, athleteId: string, siteTz: string): Promise<{ sessions: number; needsReview: number; duplicatesRemoved: number; durationMs: number }>`.
  - It rebuilds `sessions`, `session_sources`, `results`, `measurements`, `notes` and `conflicts` for the athlete.
  - Delete and insert run in `batch()` chunks. The final state must be all-new or all-old: write to the new rows, then delete the old by `id` range.
  - Decisions are read from `decisions`.
  - Each result, measurement and note row gets the `session_id` of the session that owns its source record (null if none).

- [ ] **Step 1: Write the failing tests:**
  - after inserting the fixture records, `runReconcile` returns `sessions` equal to `expected.canonicalWorkouts.length`;
  - a second run gives the same counts and the same session keys (idempotent);
  - after inserting a `merge` decision, the 2026-10-17 session is `confirmed`;
  - `results` contains 9 rows with `benchmark='fran'`;
  - every `results.session_id` for a class is non-null.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): persist reconciliation and derived rows`.

---

### Task 13: AthleteAgent sync runs (A3, H12)

**Files:** Modify `src/worker/agent.ts`; Create `src/worker/routes/sync.ts`; Test `test/worker/sync.test.ts`

**Interfaces:**
- Consumes: `registry` (Tasks 5, 9), `getConnections`, `insertSourceRecords`, `runReconcile`.
- Produces the agent state, exactly:
  ```ts
  type ProviderProgress = { status: "pending"|"syncing"|"done"|"error"; label: string; done: number; total?: number; error?: string; durationMs?: number }
  type SyncSummary = { workouts: number; duplicatesRemoved: number; needsReview: number; totalRecords: number; timings: Record<string, number> }
  type SyncState = { runId: string|null; status: "idle"|"running"|"done"|"error";
    providers: Partial<Record<ProviderId, ProviderProgress>>; reconcile: { status: "pending"|"running"|"done"; durationMs?: number }; summary: SyncSummary|null }
  ```
- Produces on `AthleteAgent extends Agent<Env, SyncState>`:
  - `@callable() startSync(providers?: ProviderId[]): Promise<{ runId: string }>` — defaults to every connected OAuth provider. If already running, it returns the current `runId`. Otherwise it closes any stale `running` row in `sync_runs` as `error`/`interrupted`, then enqueues `runSync` via `this.queue`.
  - `runSync({ runId, providers })`: per provider, up to 3 attempts with `this.retry`; errors are isolated per provider. Then reconcile, then the summary.
  - `@callable() getSyncState(): SyncState`
- Produces the route `POST /api/sync {providers?}` → `getAgentByName(env.AthleteAgent, athleteId).startSync(...)` → `202 {runId}`.
- **Timing keys** in `summary.timings`: `wodup`, `mindbody`, `apple_health` (time of the last upload, from `sync_runs`), `reconcile`, `total` (ms).
- **`sync_runs` rows:** one per provider per run, with accepted, duplicates, rejected and duration. Changed records are counted into `detail.updated`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("syncs connected providers and reconciles", async () => { await connectAll(["wodup","mindbody"]); await uploadAppleFixture();
    const { runId } = await (await authedFetch("/api/sync",{ method:"POST" })).json(); const s = await waitForSync(agent, runId);
    expect(s.status).toBe("done"); expect(s.providers.wodup!.status).toBe("done"); expect(s.summary!.workouts).toBe(expected.canonicalWorkouts.length);
    expect(s.summary!.timings.wodup + s.summary!.timings.mindbody).toBeLessThan(10_000); });
  it("second sync adds nothing", async () => { const s = await syncAgain(); expect(totalAccepted(s.runId)).toBe(0); expect(totalDuplicates(s.runId)).toBeGreaterThan(0); });
  it("one failing provider doesn't stop the others", async () => { failMock("mindbody"); const s = await syncOnce();
    expect(s.providers.mindbody!.status).toBe("error"); expect(s.providers.wodup!.status).toBe("done"); expect(s.status).toBe("done"); });
  it("startSync while running returns the active run", async () => { const a = await agent.startSync(); const b = await agent.startSync(); expect(b.runId).toBe(a.runId); });
  it("stale running run is closed on next start", async () => { await insertStaleRun(); await agent.startSync();
    expect(await runStatus(staleId)).toEqual({ status:"error", detail: expect.objectContaining({ reason:"interrupted" }) }); });
  it("stub providers complete with zero records", async () => { await connectAll(["oura"]); const s = await syncOnce(["oura"]); expect(s.providers.oura).toMatchObject({ status:"done", label:"No data in demo" }); });
  ```
  `failMock` sets a test-only `MOCK_FAIL` binding that makes `/mock/<provider>/*` return 500.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use `getAgentByName` for RPC, `this.setState` after every batch (throttled to at most 10 per second), and `this.queue` for the run.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent): sync runs with live progress, retries and isolation`.

---

### Task 14: End-to-end demo sync script (H12)

**Files:** Create `scripts/demo-sync.ts`; Modify `fixtures/README.md` (Quickstart); Test: manual run, as specified below.

**Interfaces:**
- Consumes: the running `wrangler dev` (default `http://localhost:8787`), and every route above.
- Produces `npm run demo:sync [-- --apple <path>]`, which runs these steps:
  1. Create the athlete "Alex Rivera".
  2. Connect WodUp and Mindbody through `auto=1`.
  3. Parse the Apple export in Node with `parseAppleExport` (the fixture by default, or `--apple`) and POST the batches.
  4. POST `/api/sync`.
  5. Poll the agent state over the agent WebSocket (`agents/client`), printing a progress line per change.
  6. Print the summary:
     ```
     2 years · <totalRecords> records · Apple parsed in <s> s (<rec/s>/s) · WodUp <s> s · Mindbody <s> s · reconcile <s> s · total <s> s
     <workouts> workouts · <duplicatesRemoved> duplicates removed · <needsReview> need review
     ```

- [ ] **Step 1: Run `npm run fixtures && npm run seed:mock && npm run dev`** in one terminal.
- [ ] **Step 2: Run `npm run demo:sync`** in another. Expected:
  - it exits 0;
  - the summary's workout count equals `expected.canonicalWorkouts.length`;
  - the Apple parse is under 15 s;
  - WodUp + Mindbody are under 10 s;
  - reconcile is under 5 s.
- [ ] **Step 3: Run it again.** Expected: the same summary, and "0 new records" on every provider line.
- [ ] **Step 4: Add a Quickstart** to `fixtures/README.md` (the 4 commands above).
- [ ] **Step 5: Commit** `feat: end-to-end demo sync with timings`.

---

## Self-review notes

- **Spec coverage:**

  | SPEC section | Task(s) |
  |---|---|
  | §3 | Tasks 2–3 |
  | §4.1–4.3 | Tasks 5–7, 9 |
  | §4.4 parser | Task 10 (browser Web Worker wiring is Phase B) |
  | §5 | Task 4 |
  | §6.1 | Task 4 |
  | §6.2 | Task 13 |
  | §6.3 | Tasks 11–12 |
  | §9 API rows in Phase A | Tasks 0, 5, 7, 10, 13 |
  | §10 targets | Tasks 10, 11, 13, 14 |
  | §12 tests | Spread across tasks; the E2E Playwright test is Phase B |

- **Out of this plan** (Phase B): the React app, consent-sheet styling, the dashboard spec/tiles API, review endpoints, and the browser wiring of the Apple parser.
- **Schema additions beyond SPEC §5:** `payload_hash`, `updated_at`, `oauth_states` (Task 4). SPEC §5 should be amended when this lands.

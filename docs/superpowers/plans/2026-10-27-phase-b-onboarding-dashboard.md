# Phase B: Onboarding and First Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new athlete can go through five steps in a browser:
1. Create a profile.
2. Connect WodUp and Mindbody through demo sign-in.
3. Upload an Apple Health export, parsed in the browser.
4. Watch the sync live.
5. Land on the first dashboard: every tile shows how it was calculated, and the athlete can resolve the review queue.

All of it is served by the existing Worker.

**Architecture:**
- **Static pages:** Astro (static output) builds pages into `web/dist`. The Worker serves them as static assets. `/api/*`, `/agents/*` and `/mock/*` run the Worker first.
- **Data in the browser:** per-athlete data is fetched client-side from new dashboard, review and session APIs (Hono, D1, current reconcile generation).
- **React islands:** interaction lives in shadcn/ui React islands:
  - connect grid;
  - Apple upload, with a Web Worker running `src/core/apple/parse.ts`;
  - sync progress, over the agent WebSocket;
  - the dashboard, with tiles and SVG charts;
  - review sheet.
- **Plain Astro:** everything else is plain Astro: layout, onboarding copy, the welcome form.

**Tech Stack:**
- Astro 7.4.2, @astrojs/react 7.1.1, React 19.3.1, Tailwind 4.3.3 (`@tailwindcss/vite`), shadcn 4.23.0 CLI (radix-ui 1.8.1, lucide-react 1.62.0, class-variance-authority 0.7.1, tailwind-merge 3.7.0, clsx 2.1.1);
- agents 0.31.0 (`agents/client`), Hono, D1;
- Vitest 4.1.12 + @cloudflare/vitest-plugin, @playwright/test 1.64.1.

**Spec:** `docs/SPEC.md` v0.2 §7 (onboarding), §8 (dashboards), §9 (API), §10 (targets), §12 (E2E). Decision D-028 and PRD §6.1 B1–B5 also apply. Mockups: `.superpowers/brainstorm/42361-1793123047/content/{onboarding,dashboard}.html`.

## Global Constraints

- **D-029 (logged in Task 0):** tile data renders client-side inside one React island. The static build can't contain per-athlete data. Charts are hand-rolled SVG React components; no chart library.
- **Asset routing in `wrangler.jsonc`:**
  - `assets: { directory: "./web/dist", binding: "ASSETS", not_found_handling: "404-page", run_worker_first: ["/api/*", "/agents/*", "/mock/*"] }`
  - The same assets config is used for previews; asset settings are top-level.
- **Every API query reads the current reconcile generation only:** `generation = (SELECT generation FROM reconcile_generations WHERE athlete_id = ?)`.
- **`asOf` (D-030, logged in Task 1):**
  - An explicit `?asOf=YYYY-MM-DD` wins.
  - Otherwise, when `PROVIDER_MODE = "demo"`, use the latest `local_date` among the athlete's current sessions. The synthetic data ends 2026-10-25.
  - Otherwise, use today in the athlete's time zone.
  - Weeks run Monday–Sunday in the **athlete's** time zone (`athletes.tz`).
- **Number formatting:**
  - times: `m:ss` (261 → `4:21`);
  - loads: `245 lb`;
  - bpm and ms: integers;
  - sleep: `7h 12m`.
- **Copy:** UI copy follows the mockups. Bests are scoped "best in your history since <first date>". Gaps in the data show as gaps, never zeros. There is no "readiness score" anywhere.
- **Performance:** `GET /api/dashboards/home` responds in < 300 ms on local Miniflare with the two-year fixture (SPEC §10).
- **Browser support:** read uploaded files with `file.stream().getReader()` loops, not async iteration (Safari).
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on a branch; `main` is protected, so open a PR when done.

## Review Focus

1. **A brand-new athlete with no synced data.** Every tile returns `value: null` with "No data yet" copy, and the dashboard renders empty states, never `NaN` or an error. Test: `tiles are empty, not broken, before any sync` (Task 1).
2. **The wrong file chosen for Apple Health** (a random zip, a PDF). The upload dialog says "That isn't an Apple Health export", nothing is uploaded, and the athlete can pick again. Test: `rejects a file that isn't a Health export` (Task 5, E2E).
3. **A stale or invalid session cookie** (secret rotated, athlete deleted). Pages send the athlete to `/onboarding`, never a blank page or an error. Test: `stale session lands on onboarding` (Task 4, E2E).
4. **One provider fails during sync.** The sync screen shows that provider's error with a Retry button, the others finish, and the dashboard stays reachable. Test: `a failing provider shows retry and still reaches the dashboard` (Task 6, E2E).
5. **An athlete whose time zone differs from the gym's.** Week boundaries and "this week" use the athlete's time zone. Test: `week boundaries follow the athlete's time zone` (Task 1).

---

## File Structure

```
web/
  astro.config.mjs        static output, @astrojs/react, @tailwindcss/vite, dev proxy → 8787
  components.json         shadcn config (aliases @/components, @/lib)
  src/styles/globals.css  Tailwind 4 + shadcn tokens (light + dark)
  src/lib/utils.ts        cn()
  src/lib/api.ts          typed fetch helpers (getMe, getProviders, getDashboard, postReview…)
  src/lib/format.ts       formatTime, formatLoad, formatSleep
  src/components/ui/*     shadcn primitives (button, card, badge, dialog, sheet, progress, popover, input, label, select)
  src/layouts/App.astro   shell, header, theme tokens
  src/pages/index.astro                   session check → /dashboard or /onboarding
  src/pages/onboarding/index.astro        B1 welcome form
  src/pages/onboarding/connect.astro      B2 provider grid
  src/pages/onboarding/sync.astro         B3 live sync
  src/pages/dashboard.astro               B4 dashboard
  src/islands/ProviderGrid.tsx  AppleUpload.tsx  SyncProgress.tsx  Dashboard.tsx  ReviewSheet.tsx
  src/islands/charts/Sparkline.tsx  Band.tsx  Heatmap.tsx  MixBar.tsx
  src/workers/appleParser.ts    Web Worker: File → parseAppleExport → batches
src/worker/
  dashboard/asOf.ts  dashboard/tiles.ts  dashboard/spec.ts
  routes/dashboard.ts  routes/review.ts  routes/sessions.ts
  mock/oauthRoutes.ts (modify: styled consent page)
e2e/
  playwright.config.ts  global-setup.ts  onboarding.spec.ts  dashboard.spec.ts
test/worker/dashboard.test.ts  review.test.ts  sessions.test.ts
```

---

### Task 0: Frontend scaffold and asset routing

**Files:**
- Create: `web/astro.config.mjs`, `web/components.json`, `web/src/styles/globals.css`, `web/src/lib/utils.ts`, `web/src/layouts/App.astro`, `web/src/pages/index.astro`, `web/src/components/ui/*` (via the shadcn CLI), `e2e/playwright.config.ts`, `e2e/global-setup.ts`, `e2e/smoke.spec.ts`
- Modify: `wrangler.jsonc` (assets), `package.json` (scripts, deps), `tsconfig.json` (include `web`, the `@/*` path, jsx), `.gitignore` (`web/dist`, `.astro`, `test-results`, `playwright-report`), `docs/DECISIONS.md` (D-029)

**Interfaces:**
- Produces these scripts:

  | Script | Runs |
  |---|---|
  | `build:web` | `astro build --root web` |
  | `dev:web` | `astro dev --root web` (proxies `/api`, `/agents`, `/mock` to `http://localhost:8787`) |
  | `dev` | `npm run build:web && wrangler dev` |
  | `e2e` | `playwright test -c e2e/playwright.config.ts` |

- Produces `cn(...classes)` from `web/src/lib/utils.ts`, and the `App.astro` layout with a `title` prop and a slot.
- Produces the Playwright `webServer`:
  - command: `npm run build:web && npx wrangler dev --port 8788 --persist-to .wrangler/e2e`;
  - `global-setup.ts` runs `wrangler d1 migrations apply openhealth --local --persist-to .wrangler/e2e` and seeds both mock fixtures into R2 with `--local --persist-to .wrangler/e2e`;
  - `baseURL: http://localhost:8788`.

- [ ] **Step 1: Write the failing E2E smoke test** `e2e/smoke.spec.ts`:
  ```ts
  test("serves the app shell and keeps the API on the Worker", async ({ page, request }) => {
    expect((await request.get("/api/health")).ok()).toBe(true);
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "Your training, covered like a pro's." })).toBeVisible();
  });
  test("an unknown page is a 404, not the API", async ({ request }) => {
    expect((await request.get("/nope")).status()).toBe(404);
  });
  ```
- [ ] **Step 2: Run `npm run e2e`.** Expected: FAIL. There's no web build and no assets config yet.
- [ ] **Step 3: Install** the exact versions from Tech Stack. Add the Astro project under `web/` with `output: "static"`, `integrations: [react()]`, `vite: { plugins: [tailwind()], server: { proxy } }`.
- [ ] **Step 4: Initialize shadcn.** Run `npx shadcn@4.23.0 init` in `web/` with base color `neutral` and CSS variables, then `npx shadcn@4.23.0 add button card badge dialog sheet progress popover input label select`.
- [ ] **Step 5: Add the pages.** `App.astro`, plus a minimal `onboarding/index.astro` with the heading text above. `index.astro` contains a small inline script: `fetch("/api/me")` → `location.replace(ok ? "/dashboard" : "/onboarding")`.
- [ ] **Step 6: Add the assets config** to `wrangler.jsonc`, exactly as in Global Constraints. Then add `npm run build:web` to `.github/workflows/ci.yml`:
  - in Test, before `npm test`, because Miniflare needs the assets directory to exist;
  - in Preview, before `wrangler preview`;
  - in `deploy.yml`, before `wrangler deploy`.
- [ ] **Step 7: Run `npm run e2e && npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 8: Log D-029** (tile data renders client-side in one React island; it replaces D-028's "static parts are plain Astro" for per-athlete data). Commit `feat(web): astro + shadcn scaffold served by the worker`.

---

### Task 1: Dashboard API, part 1 (envelope, asOf, activity tiles)

**Files:** Create `src/worker/dashboard/asOf.ts`, `src/worker/dashboard/tiles.ts`, `src/worker/dashboard/spec.ts`, `src/worker/routes/dashboard.ts`; Modify `src/worker/index.ts`; Test `test/worker/dashboard.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type TileType = "week_sessions"|"streak"|"rhr_3d"|"hrv_3d"|"record_book"|"review_queue"|"heatmap_52w"|"recent_sessions"|"training_mix"|"stories_placeholder";
  interface TileEnvelope<V = unknown> { type: TileType; value: V | null; display: string; context: string; series?: unknown;
    calc: { description: string; inputs: { sourceRecordIds?: number[]; query?: string }; computedAt: string } }
  interface DashboardSpec { id: "home"; title: string; layout: "home"; tiles: { type: TileType; size: "s"|"m"|"l" }[] }
  function resolveAsOf(env: Env, db: D1Database, athleteId: string, explicit?: string): Promise<{ asOf: string; tz: string }>
  function computeTile(type: TileType, ctx: { db: D1Database; athleteId: string; asOf: string; tz: string; generation: string }): Promise<TileEnvelope>
  ```
- `HOME_SPEC` tile order: week_sessions (s), streak (s), rhr_3d (s), hrv_3d (s), record_book (l), review_queue (m), heatmap_52w (l), recent_sessions (l), training_mix (m), stories_placeholder (m).
- Routes:
  - `GET /api/dashboards/home?asOf=` → `{ spec, asOf, tiles: Record<TileType, TileEnvelope> }`, computing tiles in parallel;
  - `GET /api/tiles/:type?asOf=` → one envelope; 404 for an unknown type.
  - Both require a session.
- **Tile definitions for this task** (SPEC §8.2):

  | Tile | Value | Context | Series |
  |---|---|---|---|
  | `week_sessions` | Count of sessions in the asOf week | `your typical week: X.X` (mean of the previous 12 complete weeks, 1 decimal) | — |
  | `streak` | Consecutive complete weeks with ≥4 sessions ending at the asOf week (the asOf week counts once it reaches 4) | `4+ sessions/week · longest: N` | — |
  | `recent_sessions` | Last 5 sessions ≤ asOf: `{ sessionKey, localDate, title, primary, hrAvg, kcal, sources: ProviderId[] }`. `title` = `"CrossFit 6:00"` for classes (local start time), `"Open gym 17:28"`, `"Run"`. `primary` = first result formatted (`"Fran 4:21 rx"`, `"Back squat 5x5 @245"`, `"Deadlift 385"`, `"2k row 7:35"`), else the Apple activity. | — | — |
  | `training_mix` | Share of session minutes by category over the 56 days ending asOf: `{ strength, metcon, run, row, mixed }`, summing to 1 | — | — |
  | `stories_placeholder` | Static | "Your first story is being reported." | — |

- [ ] **Step 1: Write the failing tests.** Fixture records are inserted, then `runReconcile` runs (reuse `insertAllFixtureRecords`). Expected values are computed from `expectedFixture.canonicalWorkouts` by helpers in the test file, not hard-coded:
  ```ts
  it("returns the home spec and every tile", async () => { const d = await dash(); expect(d.spec.tiles.map(t=>t.type)).toEqual(HOME_ORDER); expect(Object.keys(d.tiles).sort()).toEqual([...HOME_ORDER].sort()); });
  it("demo mode is as of the latest synced day", async () => expect((await dash()).asOf).toBe("2026-10-25"));
  it("counts this week and the typical week", async () => { const t = (await dash()).tiles.week_sessions;
    expect(t.value).toBe(expectedWeekCount("2026-10-19")); expect(t.context).toBe(`your typical week: ${expectedTypical("2026-10-19")}`); });
  it("reports the current and longest streak", async () => { const t = (await dash()).tiles.streak; expect(t.value).toBe(4); expect(t.context).toContain("longest: 14"); });
  it("lists the five most recent sessions with sources", async () => { const t = (await dash()).tiles.recent_sessions;
    expect(t.value).toHaveLength(5); expect(t.value[0].localDate).toBe("2026-10-25");
    expect(t.value.find((s:any)=>s.localDate==="2026-10-20").primary).toBe("Fran 4:21 rx");
    expect(t.value.find((s:any)=>s.localDate==="2026-10-22").sources.sort()).toEqual(["apple_health","mindbody","wodup"]); });
  it("training mix sums to 1", async () => { const v = (await dash()).tiles.training_mix.value; expect(Object.values(v).reduce((a:number,b:any)=>a+b,0)).toBeCloseTo(1, 5); });
  it("every tile explains its calculation", async () => { for (const t of Object.values((await dash()).tiles) as any[]) expect(t.calc.description.length).toBeGreaterThan(10); });
  it("tiles are empty, not broken, before any sync", async () => { const d = await dashFor(newAthleteWithoutData());
    for (const t of Object.values(d.tiles) as any[]) { if (t.type !== "stories_placeholder") { expect(t.value).toBeNull(); expect(t.display).toBe("No data yet"); } } });
  it("week boundaries follow the athlete's time zone", async () => { /* athlete tz America/New_York; a session at 2026-10-19T03:30Z (Sun 23:30 ET, Sun 20:30 PT) counts in the week of 10-12, not 10-19 */ });
  it("an explicit asOf wins", async () => expect((await dash("?asOf=2026-10-11")).asOf).toBe("2026-10-11"));
  it("requires a session", async () => expect((await SELF.fetch("http://x/api/dashboards/home")).status).toBe(401));
  ```
- [ ] **Step 2: Run `npm run test:worker -- dashboard`.** Expected: FAIL (route missing).
- [ ] **Step 3: Implement.**
  - Each tile is one or two SQL queries on the indexed tables, filtered by athlete, generation and date range. JS only buckets and formats.
  - Week math runs in the athlete's time zone, using `utcToLocalDate` / local dates already stored.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Log D-030** (the asOf rule). Commit `feat(api): home dashboard spec and activity tiles`.

---

### Task 2: Dashboard API, part 2 (recovery, records, heatmap, review count)

**Files:** Modify `src/worker/dashboard/tiles.ts`; Test `test/worker/dashboard.test.ts`

**Interfaces:**

| Tile | Value | Display / context | Series |
|---|---|---|---|
| `rhr_3d` / `hrv_3d` | Mean of daily values over the 3 days ending asOf, `{ value, low, high, position: "inside"\|"above"\|"below" }`. The normal range is the 90-day mean ± 1 SD, excluding those 3 days. `hrv_3d` adds `sleepAvgMin7d`. | `inside your 90-day normal (54–58)` | The last 14 daily values, for the band chart |
| `record_book` | Rows for `fran`, `back_squat_5x5`, `deadlift_1rm`, `row_2k`: `{ benchmark, label, best, bestDate, latest, latestDate, attempts, unit: "s"\|"lb", series: {date,value}[] }`. Best = min for time, max for load. | `best in your history since <first local_date>` | — |
| `heatmap_52w` | `{ date, sessions, hasData }` for the 364 days ending asOf. `hasData` = any source record (any kind) with that local date. | `<N> sessions this year · <M> late cancels` | — |
| `review_queue` | Count + items: `{ sessionKey, localDate, kind: "merge_split"\|"pick"\|"confirm", summary }`. Sources: `review_required` sessions, conflicts `resolved_by = 'rule'`, and `logged_hours_later` sessions not `confirmed`. | — | — |

The `calc.inputs.sourceRecordIds` for `record_book` are the best results' source records.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("record book scopes bests to the athlete's history", async () => { const t = (await dash()).tiles.record_book;
    const row = (b:string) => t.value.find((r:any)=>r.benchmark===b);
    expect(row("fran")).toMatchObject({ best: 261, bestDate: "2026-10-20", attempts: 9 });
    expect(row("deadlift_1rm")).toMatchObject({ best: 385, bestDate: "2026-10-22" });
    expect(row("back_squat_5x5")).toMatchObject({ best: 245 });
    expect(row("row_2k")).toMatchObject({ best: 448, bestDate: "2026-04-16", latest: 455 });
    expect(t.context).toBe("best in your history since 2024-10-28"); });
  it("best results link to their source records", async () => expect((await dash()).tiles.record_book.calc.inputs.sourceRecordIds.length).toBe(4));
  it("recovery tiles compare to the athlete's own normal", async () => { const t = (await dash()).tiles.rhr_3d;
    expect(t.value).toMatchObject(expectedRecovery("rhr", "2026-10-25")); expect(t.context).toMatch(/90-day normal \(\d+–\d+\)/); });
  it("the heatmap marks data gaps, not zeros", async () => { const t = await tileAsOf("heatmap_52w", "2025-10-25");
    expect(t.value.find((d:any)=>d.date==="2025-06-20")).toEqual({ date: "2025-06-20", sessions: 0, hasData: false }); });
  it("the review queue lists the split, the conflict, and the late log", async () => {
    expect((await dash()).tiles.review_queue.value.items.map((i:any)=>[i.localDate,i.kind])).toEqual([["2026-10-02","confirm"],["2026-10-17","merge_split"],["2026-10-18","pick"]]); });
  it("serves the home dashboard in under 300 ms", async () => { await dash(); const t = performance.now(); await dash(); expect(performance.now()-t).toBeLessThan(300); });
  ```
  `expectedRecovery` recomputes the 3-day mean and the 90-day band from the fixture's daily records.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): recovery, record book, heatmap and review tiles`.

---

### Task 3: Review and session detail API (B5)

**Files:** Create `src/worker/routes/review.ts`, `src/worker/routes/sessions.ts`; Test `test/worker/review.test.ts`, `test/worker/sessions.test.ts`

**Interfaces:**
- `GET /api/review` → the `review_queue` tile's items.
- `POST /api/review/:sessionKey` with body `{ action: "merge"|"split"|"confirm"|"pick", payload?: { field, source } }`:
  - Validates that the action fits the item kind:

    | Item kind | Allowed actions |
    |---|---|
    | merge_split | merge, split |
    | pick | pick (with `field` ∈ the session's conflict fields, `source` ∈ that conflict's values) |
    | confirm | confirm |

  - 400 otherwise; 404 for a key not in the athlete's current generation.
  - Inserts into `decisions`, runs `runReconcile`, returns `{ ok: true, queue: Item[] }`.
- `GET /api/sessions/:sessionKey` →
  ```
  { session, sources: { id, source, kind, naturalKey, role, summary }[],
    results, measurements, notes, conflicts }
  ```
  - `summary` is a one-line human description of the record ("Mindbody visit · CrossFit 06:00", "Apple Watch workout · 54 min", "WodUp result · Fran 4:21").
  - Session keys contain `+` and `|`, so the URL segment is `encodeURIComponent`'d.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("merging the split workout clears it from the queue and confirms the class", async () => {
    const key = itemKey("2026-10-17"); const r = await post(key, { action: "merge" });
    expect(r.queue.map((i:any)=>i.localDate)).not.toContain("2026-10-17");
    expect((await get(`/api/sessions/${encodeURIComponent(key)}`)).session.status).toBe("confirmed"); });
  it("splitting produces two sessions that day", async () => { await post(itemKey("2026-10-17"), { action: "split" });
    expect((await tile("recent_sessions", "2026-10-17")).value.filter((s:any)=>s.localDate==="2026-10-17")).toHaveLength(2); });
  it("picking a value records the athlete's choice", async () => { await post(itemKey("2026-10-18"), { action: "pick", payload: { field: "distance_m", source: "wodup" } });
    const d = await get(`/api/sessions/${encodeURIComponent(itemKey("2026-10-18"))}`);
    expect(d.conflicts.find((c:any)=>c.field==="distance_m")).toMatchObject({ chosen: "wodup", resolvedBy: "athlete" }); });
  it("rejects an action that doesn't fit the item", async () => expect((await postRaw(itemKey("2026-10-02"), { action: "split" })).status).toBe(400));
  it("rejects a pick with an unknown source", async () => expect((await postRaw(itemKey("2026-10-18"), { action: "pick", payload: { field: "distance_m", source: "strava" } })).status).toBe(400));
  it("decisions survive a fresh sync", async () => { await post(itemKey("2026-10-02"), { action: "confirm" }); await runReconcile(env.DB, athlete, TZ);
    expect((await get("/api/review")).map((i:any)=>i.localDate)).not.toContain("2026-10-02"); });
  it("session detail explains every source", async () => { const d = await get(`/api/sessions/${encodeURIComponent(recentKey("2026-10-20"))}`);
    expect(d.sources.map((s:any)=>s.source).sort()).toEqual(["apple_health","apple_health","mindbody","wodup","wodup"]);
    expect(d.sources.every((s:any)=>s.summary.length > 5)).toBe(true); });
  it("another athlete's session is not found", async () => expect((await getRaw(`/api/sessions/${encodeURIComponent(otherAthleteKey)}`)).status).toBe(404));
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): review actions and session detail`.

---

### Task 4: Onboarding pages and provider grid (B1, B2)

**Files:** Create `web/src/pages/onboarding/index.astro`, `web/src/pages/onboarding/connect.astro`, `web/src/islands/ProviderGrid.tsx`, `web/src/lib/api.ts`, `e2e/onboarding.spec.ts`; Modify `src/worker/mock/oauthRoutes.ts` (styled consent page)

**Interfaces:**
- **Welcome page:** a form with Name, Primary sport (select: CrossFit, Running, HYROX, Other) and Time zone (prefilled from `Intl.DateTimeFormat().resolvedOptions().timeZone`) → `POST /api/athletes` → `/onboarding/connect`.
- **`ProviderGrid`:**
  - Props: none; it reads `GET /api/providers`.
  - Grouped Wearables / Gym & training / Races.
  - A connected tile shows a check badge.
  - **Connect** on an OAuth tile navigates to `/api/connect/:id/start`.
  - The Apple Health tile opens `AppleUpload` (Task 5).
  - The footer button reads "Sync N accounts" (N = connected count) → `POST /api/sync` → `/onboarding/sync`. It is disabled at N = 0.
  - A `?connected=<id>` query shows a toast-style confirmation.
- **Consent page** (Worker HTML): styled like the mockup's sheet, with inline CSS from the same shadcn tokens. It shows the provider name, scopes, the read-only line, email/password inputs, and **Sign in & allow**.
- `api.ts`: `getMe()`, `getProviders()`, `startSync()`. Each throws `UnauthorizedError` on 401; pages catch it and go to `/onboarding`.

- [ ] **Step 1: Write the failing E2E tests:**
  ```ts
  test("connects WodUp and Mindbody through the consent sheet", async ({ page }) => {
    await page.goto("/onboarding"); await page.getByLabel("Name").fill("Alex Rivera"); await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/onboarding\/connect/);
    for (const p of ["WodUp", "Mindbody"]) {
      await page.getByRole("button", { name: `Connect ${p}` }).click();
      await expect(page.getByText("Read-only.")).toBeVisible();
      await page.getByRole("button", { name: "Sign in & allow" }).click();
      await expect(page.getByTestId(`provider-${p.toLowerCase()}`)).toHaveAttribute("data-connected", "true"); }
    await expect(page.getByRole("button", { name: "Sync 2 accounts" })).toBeEnabled(); });
  test("stale session lands on onboarding", async ({ page, context }) => {
    await context.addCookies([{ name: "oh_session", value: "ath_x.forged", url: "http://localhost:8788" }]);
    await page.goto("/"); await expect(page).toHaveURL(/\/onboarding$/); });
  ```
- [ ] **Step 2: Run `npm run e2e`.** Expected: FAIL.
- [ ] **Step 3: Implement** the pages, island, `api.ts` and consent styling. Use shadcn `Card`, `Badge`, `Button`, `Input`, `Label`, `Select`.
- [ ] **Step 4: Run `npm run e2e && npm test`.** Expected: PASS. The existing consent-page tests in `connect.test.ts` stay green.
- [ ] **Step 5: Commit** `feat(web): onboarding welcome and provider grid`.

---

### Task 5: Apple Health upload in the browser (H11, B2)

**Files:** Create `web/src/workers/appleParser.ts`, `web/src/islands/AppleUpload.tsx`; Modify `web/src/islands/ProviderGrid.tsx`, `e2e/onboarding.spec.ts`

**Interfaces:**
- **Worker messages:**

  | Direction | Message |
  |---|---|
  | in | `{ type: "parse", file: File }` |
  | out | `{ type: "progress", pass: 1\|2, bytes, total }` |
  | out | `{ type: "batch", records: SourceRecordInput[], fileSha256 }` |
  | out | `{ type: "done", records: number, ms: number }` |
  | out | `{ type: "error", message: string }` |

  - It uses `parseAppleExport(() => readChunks(file))`, wrapping it in `unzipExport` when the name ends in `.zip`.
  - `readChunks` is a `getReader()` loop.
  - It posts each batch of 1,000 to the main thread. The main thread POSTs it to `/api/connect/apple_health/batches`.
  - Errors from the parser or unzip become `"That isn't an Apple Health export. On your iPhone: Health → profile → Export All Health Data."`
- **`AppleUpload`:** a shadcn `Dialog` with:
  - three how-to steps;
  - a file input (`accept=".zip,.xml"`);
  - a progress bar ("Reading your export… 62%", then "Sending 3,054 records…");
  - the result line "2 years · 3,054 records in 4.8 s";
  - **Done**, which closes the dialog and marks Apple Health connected.

- [ ] **Step 1: Write the failing E2E tests:**
  ```ts
  test("parses the Health export in the browser and uploads records", async ({ page }) => {
    await onboardAndConnect(page, []);
    await page.getByRole("button", { name: "Upload Apple Health export" }).click();
    await page.getByLabel("Health export file").setInputFiles("fixtures/data/apple-health/export.xml");
    await expect(page.getByText(/records in \d+\.\d s/)).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("provider-apple_health")).toHaveAttribute("data-connected", "true"); });
  test("rejects a file that isn't a Health export", async ({ page }) => {
    await onboardAndConnect(page, []); await page.getByRole("button", { name: "Upload Apple Health export" }).click();
    await page.getByLabel("Health export file").setInputFiles({ name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("PK\u0003\u0004nope") });
    await expect(page.getByText("That isn't an Apple Health export.")).toBeVisible();
    await expect(page.getByTestId("provider-apple_health")).toHaveAttribute("data-connected", "false"); });
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The Web Worker is imported with `new Worker(new URL("../workers/appleParser.ts", import.meta.url), { type: "module" })` so Vite bundles `src/core/apple/*`, saxes and fflate.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): parse Apple Health exports in the browser`.

---

### Task 6: Live sync screen (B3)

**Files:** Create `web/src/pages/onboarding/sync.astro`, `web/src/islands/SyncProgress.tsx`; Modify `e2e/onboarding.spec.ts`

**Interfaces:**
- **`SyncProgress`:**
  - Connects with `new AgentClient({ agent: "athlete-agent", name: me.id, host: location.host })` from `agents/client`, and renders from `onStateUpdate`.
  - Falls back to polling `GET /api/sync/state` every 1 s if the socket fails to open within 3 s.
  - **Rows:**
    - one per provider in `state.providers`: label, a shadcn `Progress` (`done/total`, or indeterminate without a total), and status;
    - then "Matching workouts across sources…";
    - then the summary card "N workouts · M duplicates removed · K need review", with the timings line from `summary.timings`.
  - **When a provider has `status: "error"`:** show its message and a **Retry** button (`POST /api/sync { providers: [id] }`).
  - **When `status: "done"`:** show a **See your dashboard** button → `/dashboard`.

- [ ] **Step 1: Write the failing E2E tests:**
  ```ts
  test("shows live progress and lands on the dashboard", async ({ page }) => {
    await onboardAndConnect(page, ["WodUp", "Mindbody"]); await uploadApple(page);
    await page.getByRole("button", { name: "Sync 3 accounts" }).click(); await expect(page).toHaveURL(/onboarding\/sync/);
    await expect(page.getByText(/WodUp · \d+ sessions/)).toBeVisible();
    await expect(page.getByText(/468 workouts · 9 duplicates removed · 1 need review/)).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "See your dashboard" }).click(); await expect(page).toHaveURL(/\/dashboard$/); });
  test("a failing provider shows retry and still reaches the dashboard", async ({ page }) => {
    await failMock("mindbody");   // wrangler r2 object put openhealth-raw/mock/fail/mindbody --local --persist-to .wrangler/e2e
    await onboardAndConnect(page, ["WodUp", "Mindbody"]); await page.getByRole("button", { name: "Sync 2 accounts" }).click();
    await expect(page.getByRole("button", { name: "Retry Mindbody" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "See your dashboard" }).click(); await expect(page).toHaveURL(/\/dashboard$/);
    await clearMockFailure("mindbody"); });
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): live sync progress over the athlete agent`.

---

### Task 7: The dashboard page (B4)

**Files:** Create `web/src/pages/dashboard.astro`, `web/src/islands/Dashboard.tsx`, `web/src/islands/charts/{Sparkline,Band,Heatmap,MixBar}.tsx`, `web/src/lib/format.ts`, `e2e/dashboard.spec.ts`

**Interfaces:**
- **`Dashboard`** fetches `/api/dashboards/home` and renders tiles in spec order, following the dashboard mockup:
  - **Desktop** (≥1024 px): a 4-up KPI row, the record book (l) beside the review queue, the heatmap full width, then recent sessions beside the training mix and stories.
  - **Phone** (<640 px): one column in the order ask → week → review → records → recent.
- **Every tile** is a shadcn `Card` with an ⓘ `Popover` showing `calc.description` and, when present, "Based on N records".
- **Empty envelopes** (`value: null`) render "No data yet" with a link to Sources.
- **Charts:**
  - `Sparkline({ points })` (SVG polyline);
  - `Band({ points, low, high })` (shaded normal range + line);
  - `Heatmap({ days })` (52 × 7 grid; days with `hasData: false` get a dashed outline);
  - `MixBar({ shares })`.
  - All use `currentColor` and CSS variables, so dark mode works.
- **Header:** "Good morning, <name>." plus sync freshness and source badges. Nav: Dashboard · Review (N) · Sources (`/onboarding/connect`).
- **The ask bar** is shown disabled with the placeholder "Ask anything… (coming soon)". Chat-built dashboards are v1.

- [ ] **Step 1: Write the failing E2E tests** (after a full onboarding + sync in `beforeAll`, reusing the helpers):
  ```ts
  test("shows the record book with scoped bests", async ({ page }) => { await page.goto("/dashboard");
    await expect(page.getByTestId("tile-record_book")).toContainText("best in your history since 2024-10-28");
    await expect(page.getByTestId("record-fran")).toContainText("4:21"); await expect(page.getByTestId("record-deadlift_1rm")).toContainText("385 lb"); });
  test("every tile explains itself", async ({ page }) => { await page.goto("/dashboard");
    await page.getByTestId("tile-rhr_3d").getByRole("button", { name: "How this was calculated" }).click();
    await expect(page.getByRole("dialog").or(page.getByRole("tooltip"))).toContainText("90-day"); });
  test("shows the review count in the nav", async ({ page }) => { await page.goto("/dashboard"); await expect(page.getByRole("link", { name: "Review (3)" })).toBeVisible(); });
  test("phone layout stacks in the mockup order", async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/dashboard");
    const order = await page.locator("[data-tile]").evaluateAll((els) => els.map((e) => e.getAttribute("data-tile")));
    expect(order.slice(0, 3)).toEqual(["week_sessions", "review_queue", "record_book"]); });
  test("no horizontal scroll on a phone", async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/dashboard");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); });
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Phone order comes from CSS `order` classes keyed by tile type.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): first dashboard`.

---

### Task 8: Review sheet (B5 UI)

**Files:** Create `web/src/islands/ReviewSheet.tsx`; Modify `web/src/islands/Dashboard.tsx`, `e2e/dashboard.spec.ts`

**Interfaces:**
- Clicking a review item opens a shadcn `Sheet`. It loads `GET /api/sessions/:key` and lists every source with its `summary`. It shows actions for the item kind:

  | Item kind | Actions |
  |---|---|
  | merge_split | **Merge into one workout** / **Keep separate** |
  | pick | One button per source value, e.g. "Use watch: 5,210 m" / "Use WodUp: 5,000 m" |
  | confirm | **Confirm** |

- On success it closes, then refreshes the dashboard data and the review count.

- [ ] **Step 1: Write the failing E2E tests:**
  ```ts
  test("merging the split workout resolves it", async ({ page }) => { await page.goto("/dashboard");
    await page.getByTestId("review-2026-10-17").click(); await expect(page.getByRole("dialog")).toContainText("Apple Watch workout");
    await page.getByRole("button", { name: "Merge into one workout" }).click();
    await expect(page.getByRole("link", { name: "Review (2)" })).toBeVisible(); });
  test("picking the watch distance resolves the conflict", async ({ page }) => { await page.goto("/dashboard");
    await page.getByTestId("review-2026-10-18").click(); await page.getByRole("button", { name: /Use watch: 5,210 m/ }).click();
    await expect(page.getByTestId("review-2026-10-18")).toHaveCount(0); });
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): review sheet`.

---

### Task 9: CI end-to-end job and docs

**Files:** Modify `.github/workflows/ci.yml`, `README.md`, `docs/SPEC.md` (§2 frontend row, D-029/D-030 references)

**Interfaces:**
- **New CI job `E2E`:**
  - needs Test;
  - steps: `npx playwright install --with-deps chromium`, `npm run fixtures`, `npm run e2e`;
  - uploads `playwright-report` on failure.
  - Not yet a required check.
- **README:** the frontend dev loop. Run `npm run dev` (build + wrangler dev on :8787), or `npm run dev:web` against a running `wrangler dev` for hot reload.

- [ ] **Step 1: Push the branch and open the PR.** Expected: Test, E2E and Preview all pass, and the preview comment links to a working `/onboarding`.
- [ ] **Step 2: Walk the preview by hand** (onboarding → connect → upload → sync → dashboard → review), at desktop and phone widths.
- [ ] **Step 3: Update the README and SPEC.** Commit `ci: e2e job; docs: frontend dev loop`.

---

## Self-review notes

- **Spec coverage:**

  | SPEC section | Task(s) |
  |---|---|
  | §7 steps 1–5 | Tasks 4, 4, 4, 6, 7 |
  | §7 rules: subset sync | Task 4 (enabled at N ≥ 1) |
  | §7 rules: later connections | Task 7 (Sources link) |
  | §7 rules: empty/error/no-data copy | Tasks 1, 6, 7 |
  | §8.1 envelope + calc | Tasks 1, 7 |
  | §8.2 tiles | Tasks 1–2 |
  | §8.3 review | Tasks 3, 8 |
  | §9 routes added | `/api/dashboards/home`, `/api/tiles/:type`, `/api/review`, `/api/review/:key`, `/api/sessions/:key` |
  | §10 dashboard < 300 ms | Task 2 |
  | §12 E2E | Tasks 0, 4–8 |

- **Deviations, logged when they land:**
  - D-029: tile data renders client-side in one island.
  - D-030: the demo asOf rule.
  - Session URLs use `session_key`, not ids, because ids change every reconcile generation.
  - `/api/sessions` (timeline list) is deferred; the dashboard uses `recent_sessions`.
- **Out of this plan:** chat-built dashboards and voice (v1), the story engine (Phase C), and a dedicated Sources settings page beyond reusing the connect grid.

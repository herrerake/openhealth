import { type Browser, type Page, expect, test } from "@playwright/test";
import { onboardAndConnect, uploadApple } from "./helpers";

test.describe.configure({ mode: "serial" });

let page: Page;

async function syncedAthlete(browser: Browser): Promise<Page> {
  const p = await browser.newPage();
  await onboardAndConnect(p, ["WodUp", "Mindbody", "HYROX"]);
  await uploadApple(p);
  await p.getByRole("button", { name: "Sync 4 accounts" }).click();
  await expect(p.getByRole("link", { name: "See your dashboard" })).toBeVisible({ timeout: 90_000 });
  return p;
}

test.beforeAll(async ({ browser }) => {
  page = await syncedAthlete(browser);
});

test("shows the record book with scoped bests", async () => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("tile-record_book")).toContainText("best in your history since 2024-10-28");
  await expect(page.getByTestId("record-hyrox_total")).toContainText("1:14:32");
  await expect(page.getByTestId("record-deadlift_4x4")).toContainText("295 lb");
});

test("opens a session's heart-rate timeline from recent sessions", async () => {
  await page.goto("/dashboard");
  // Recent sessions run newest first; the newest is the 2026-10-25 easy run.
  await page.getByTestId(/^session-link-/).first().click();
  await expect(page).toHaveURL(/\/session\/\?key=/);
  await expect(page.getByTestId("timeline-blocks")).toBeVisible();
  await expect(page.getByTestId("timeline-spoken")).toContainText("beats per minute");
});

test("lays a Club Hybrid class out block by block, marked as estimated", async () => {
  await page.goto("/dashboard?asOf=2026-10-19");
  const res = await page.request.get("/api/tiles/recent_sessions?asOf=2026-10-19");
  const key = (await res.json()).value[0].sessionKey;
  await page.goto(`/session/?key=${encodeURIComponent(key)}`);
  await expect(page.getByTestId("session-title")).toHaveText("Club Hybrid");
  await expect(page.getByTestId("timeline-method")).toContainText("estimated");
  for (const label of ["Warm Up", "A. Deadlift", "B. Push Press", "C. Circuit", "D. FC finisher"]) {
    await expect(page.getByTestId("timeline-blocks")).toContainText(label);
  }
});

test("lays a HYROX race on its official splits", async () => {
  const res = await page.request.get("/api/tiles/recent_sessions?asOf=2026-09-19");
  const key = (await res.json()).value[0].sessionKey;
  await page.goto(`/session/?key=${encodeURIComponent(key)}`);
  await expect(page.getByTestId("session-title")).toHaveText("HYROX 2026 Dallas");
  await expect(page.getByTestId("timeline-method")).toHaveText("Official HYROX splits");
  await expect(page.getByTestId("timeline-blocks")).toContainText("Wall Balls");
});

test("every tile explains itself", async () => {
  await page.goto("/dashboard");
  await page.getByTestId("tile-rhr_3d").getByRole("button", { name: "How this was calculated" }).click();
  await expect(page.getByRole("dialog")).toContainText("90 days");
});

test("shows the review count in the nav", async () => {
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "Review (3)" })).toBeVisible();
});

test("marks gaps in the heatmap", async () => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("tile-heatmap_52w")).toContainText(/sessions this year/);
  await expect(page.getByTestId("tile-heatmap_52w").locator("svg rect")).toHaveCount(364);
});

test("phone layout stacks in the mockup order", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await page.getByTestId("tile-record_book").waitFor();
  const tiles = await page.locator("[data-tile]").evaluateAll((els) =>
    els
      .map((e) => ({ tile: e.getAttribute("data-tile"), top: e.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top)
      .map((x) => x.tile),
  );
  expect(tiles.slice(0, 3)).toEqual(["week_sessions", "review_queue", "record_book"]);
});

test("no horizontal scroll on a phone", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await page.getByTestId("tile-record_book").waitFor();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a new athlete sees empty states, not errors", async ({ browser }) => {
  const fresh = await browser.newPage();
  await onboardAndConnect(fresh, []);
  await fresh.goto("/dashboard");
  await expect(fresh.getByTestId("tile-record_book")).toContainText("No data yet");
  await expect(fresh.locator("body")).not.toContainText("NaN");
});

test("the review sheet explains every source", async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dashboard");
  await page.getByTestId("review-2026-10-14").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Apple Watch workout");
  await expect(sheet).toContainText("Mindbody visit");
  await page.keyboard.press("Escape");
});

test("merging the split workout resolves it", async () => {
  await page.goto("/dashboard");
  await page.getByTestId("review-2026-10-14").click();
  await page.getByRole("button", { name: "Merge into one workout" }).click();
  await expect(page.getByRole("link", { name: "Review (2)" })).toBeVisible();
  await expect(page.getByTestId("review-2026-10-14")).toHaveCount(0);
});

test("picking the watch values resolves the conflict", async () => {
  await page.goto("/dashboard");
  await page.getByTestId("review-2026-10-18").click();
  await page.getByRole("button", { name: /Use watch: 5,210 m/ }).click();
  await expect(page.getByTestId("review-2026-10-18")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Review (1)" })).toBeVisible();
});

test("confirming the late log clears the queue", async () => {
  await page.goto("/dashboard");
  await page.getByTestId("review-2026-10-02").click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("link", { name: "Review (0)" })).toBeVisible();
  await expect(page.getByTestId("tile-review_queue")).toContainText("All clear");
});

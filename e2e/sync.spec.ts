import { expect, test } from "@playwright/test";
import { clearMockFailure, failMock, onboardAndConnect, uploadApple } from "./helpers";

test("shows live progress and lands on the dashboard", async ({ page }) => {
  let polled = 0;
  page.on("request", (r) => r.url().includes("/api/sync/state") && polled++);
  await onboardAndConnect(page, ["WodUp", "Mindbody"]);
  await uploadApple(page);
  await page.getByRole("button", { name: "Sync 3 accounts" }).click();
  await expect(page).toHaveURL(/onboarding\/sync/);
  await expect(page.getByText(/WodUp · \d+ sessions/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/468 workouts · 9 duplicates removed · 1 need review/)).toBeVisible({ timeout: 60_000 });
  expect(polled).toBe(0); // progress arrived over the agent WebSocket, not the polling fallback
  await page.getByRole("link", { name: "See your dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
});

test("a failing provider shows retry and still reaches the dashboard", async ({ page }) => {
  failMock("mindbody");
  try {
    await onboardAndConnect(page, ["WodUp", "Mindbody"]);
    await page.getByRole("button", { name: "Sync 2 accounts" }).click();
    await expect(page.getByRole("button", { name: "Retry Mindbody" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("link", { name: "See your dashboard" })).toBeVisible();
    clearMockFailure("mindbody");
    await page.getByRole("button", { name: "Retry Mindbody" }).click();
    await expect(page.getByText(/Mindbody · \d+ class visits/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Retry Mindbody" })).toHaveCount(0);
  } finally {
    try {
      clearMockFailure("mindbody");
    } catch {}
  }
});

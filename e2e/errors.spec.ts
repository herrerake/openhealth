import { expect, test } from "@playwright/test";
import { APPLE_FIXTURE, onboardAndConnect, syncedAthlete } from "./helpers";

test("a failed review action says so and keeps the sheet open", async ({ page }) => {
  await syncedAthlete(page);
  await page.goto("/dashboard");
  await page.route("**/api/review/**", (r) => (r.request().method() === "POST" ? r.fulfill({ status: 500, body: "{}" }) : r.continue()));
  await page.getByTestId("review-2026-10-02").click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("alert")).toHaveText("That didn't save. Try again.");
  await expect(page.getByRole("button", { name: "Confirm" })).toBeEnabled();
});

test("a failed upload batch stops the upload and lets the athlete try again", async ({ page }) => {
  await onboardAndConnect(page, []);
  await page.route("**/api/connect/apple_health/batches", (r) => r.fulfill({ status: 500, body: "{}" }));
  await page.getByRole("button", { name: "Upload Apple Health export" }).click();
  await page.getByLabel("Health export file").setInputFiles(APPLE_FIXTURE);
  await expect(page.getByRole("alert")).toContainText("Upload failed");
  await expect(page.getByLabel("Health export file")).toBeEnabled();
});

test("a dashboard that fails to load says so", async ({ page }) => {
  await onboardAndConnect(page, []);
  await page.route("**/api/dashboards/home", (r) => r.fulfill({ status: 500, body: "{}" }));
  await page.goto("/dashboard");
  await expect(page.getByRole("alert")).toContainText("Couldn't load your dashboard");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

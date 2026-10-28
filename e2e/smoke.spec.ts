import { expect, test } from "@playwright/test";

test("serves the app shell and keeps the API on the Worker", async ({ page, request }) => {
  expect((await request.get("/api/health")).ok()).toBe(true);
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Your training, covered like a pro's." })).toBeVisible();
});

test("the homepage leads to log in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your training, covered like a pro's.");
  await page.getByRole("link", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/login\/?$/);
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
});

test("an unknown page is a 404, not the API", async ({ request }) => {
  expect((await request.get("/nope")).status()).toBe(404);
});

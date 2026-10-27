import { expect, test } from "@playwright/test";
import { onboardAndConnect } from "./helpers";

test("connects WodUp and Mindbody through the consent sheet", async ({ page }) => {
  await onboardAndConnect(page, ["WodUp", "Mindbody"]);
  await expect(page.getByRole("status")).toHaveText("Mindbody connected");
  await expect(page.getByRole("button", { name: "Sync 2 accounts" })).toBeEnabled();
});

test("the consent sheet never puts the password in the URL", async ({ page }) => {
  await onboardAndConnect(page, []);
  await page.getByRole("button", { name: "Connect WodUp" }).click();
  await page.getByLabel("Password").fill("hunter2-demo");
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/oauth/authorize") && r.method() === "POST"),
    page.getByRole("button", { name: "Sign in & allow" }).click(),
  ]);
  expect(request.url()).not.toContain("hunter2");
});

test("sync is disabled until something is connected", async ({ page }) => {
  await onboardAndConnect(page, []);
  await expect(page.getByRole("button", { name: "Sync 0 accounts" })).toBeDisabled();
});

test("stale session lands on onboarding", async ({ page, context }) => {
  await context.addCookies([{ name: "oh_session", value: "ath_x.forged", url: "http://localhost:8788" }]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding\/?$/);
  await page.goto("/onboarding/connect");
  await expect(page).toHaveURL(/\/onboarding\/?$/);
});

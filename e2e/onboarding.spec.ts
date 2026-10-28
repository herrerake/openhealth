import { expect, test } from "@playwright/test";
import { onboardAndConnect, uploadApple } from "./helpers";

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

test("a stale session is sent to log in", async ({ page, context }) => {
  await context.addCookies([{ name: "oh_session", value: "ath_x.forged", url: "http://localhost:8788" }]);
  await page.goto("/onboarding/connect");
  await expect(page).toHaveURL(/\/login\/?$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\/?$/);
});

test("parses the Health export in the browser and uploads records", async ({ page }) => {
  await onboardAndConnect(page, []);
  await uploadApple(page);
  await expect(page.getByRole("button", { name: "Sync 1 account" })).toBeEnabled();
});

test("rejects a file that isn't a Health export", async ({ page }) => {
  await onboardAndConnect(page, []);
  await page.getByRole("button", { name: "Upload Apple Health export" }).click();
  await page.getByLabel("Health export file").setInputFiles({ name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("PK\u0003\u0004nope") });
  await expect(page.getByText("That isn't an Apple Health export.")).toBeVisible();
  await page.getByLabel("Health export file").setInputFiles({ name: "notes.xml", mimeType: "text/xml", buffer: Buffer.from("<notes><note>hi</note></notes>") });
  await expect(page.getByText("That isn't an Apple Health export.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("provider-apple_health")).toHaveAttribute("data-connected", "false");
});

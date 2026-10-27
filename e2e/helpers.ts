import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { type Page, expect } from "@playwright/test";

const ROOT = join(import.meta.dirname, "..");
export const APPLE_FIXTURE = join(ROOT, "fixtures/data/apple-health/export.xml");

/** Welcome form → connect page, then connects each named provider through its consent sheet. */
export async function onboardAndConnect(page: Page, providers: string[], name = "Alex Rivera"): Promise<void> {
  await page.goto("/onboarding");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/onboarding\/connect/);
  for (const p of providers) {
    await page.getByRole("button", { name: `Connect ${p}` }).click();
    await expect(page.getByText("Read-only.")).toBeVisible();
    await page.getByRole("button", { name: "Sign in & allow" }).click();
    await expect(page.getByTestId(`provider-${p.toLowerCase()}`)).toHaveAttribute("data-connected", "true");
  }
}

export async function uploadApple(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Upload Apple Health export" }).click();
  await page.getByLabel("Health export file").setInputFiles(APPLE_FIXTURE);
  await expect(page.getByText(/records in \d+(\.\d)? s/)).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("provider-apple_health")).toHaveAttribute("data-connected", "true");
}

const r2 = (...args: string[]) =>
  execFileSync("npx", ["wrangler", "r2", "object", ...args, "--local", "--persist-to", ".wrangler/e2e"], { cwd: ROOT, stdio: "pipe" });

/** Demo-only fault injection: the mock provider returns 500 while this flag exists. */
export const failMock = (provider: string) => r2("put", `openhealth-raw/mock/fail/${provider}`, "--pipe");
export const clearMockFailure = (provider: string) => r2("delete", `openhealth-raw/mock/fail/${provider}`);

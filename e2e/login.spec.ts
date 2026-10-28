import { expect, test } from "@playwright/test";

// The demo account (D-041): its password is passed to the e2e Worker in playwright.config.ts.
const EMAIL = "henry@example.com";
const PASSWORD = "e2e-demo-password";

async function logIn(page: import("@playwright/test").Page, password = PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

test("Henry logs in and picks up onboarding at Connect", async ({ page }) => {
  await logIn(page);
  await expect(page).toHaveURL(/\/onboarding\/connect\/?$/);
  await expect(page.getByRole("heading", { name: "Where does your training live?" })).toBeVisible();
});

test("a wrong password shows an error and stays on log in", async ({ page }) => {
  await logIn(page, "not-the-password");
  await expect(page.getByRole("alert")).toHaveText("That email and password don't match.");
  await expect(page).toHaveURL(/\/login\/?$/);
});

test("log out returns to the homepage and ends the session", async ({ page }) => {
  await logIn(page);
  await expect(page).toHaveURL(/\/onboarding\/connect\/?$/);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your training, covered like a pro's.");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\/?$/);
});

test("the homepage offers a signed-in athlete their dashboard", async ({ page }) => {
  await logIn(page);
  await expect(page).toHaveURL(/\/onboarding\/connect\/?$/);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
});

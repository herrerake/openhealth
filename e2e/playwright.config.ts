import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against `wrangler dev` serving the built Astro site, with an isolated
// local D1/R2 state in .wrangler/e2e (migrated and seeded by global-setup.ts).
const PORT = 8788;

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./global-setup.ts",
  // The fixtures' gym is in Los Angeles; onboarding defaults the athlete's zone from the browser.
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", timezoneId: "America/Los_Angeles" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The secret is passed here, not via .dev.vars: Playwright starts the server before globalSetup runs.
    command: `npm run build:web && npx wrangler dev --port ${PORT} --persist-to .wrangler/e2e --var SESSION_SECRET:e2e-local-secret`,
    cwd: "..",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

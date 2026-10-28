import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import agents from "agents/vite";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          include: ["test/core/**/*.test.ts"],
          environment: "node",
          testTimeout: 60_000,
        },
      },
      {
        plugins: [
          // TC39 decorators (@callable) — Oxc doesn't transform them yet.
          agents(),
          cloudflareTest(async () => ({
            wrangler: { configPath: `${root}wrangler.jsonc` },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(`${root}src/db/migrations`),
                SESSION_SECRET: "test-secret",
                DEMO_PASSWORD: "test-demo-password",
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["test/worker/**/*.test.ts"],
          globalSetup: ["test/global-apple-records.ts"],
          setupFiles: ["test/setup-worker.ts"],
          testTimeout: 60_000,
        },
      },
    ],
  },
});

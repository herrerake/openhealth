import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
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
          cloudflareTest(async () => ({
            wrangler: { configPath: `${root}wrangler.jsonc` },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(`${root}src/db/migrations`),
                SESSION_SECRET: "test-secret",
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["test/worker/**/*.test.ts"],
          setupFiles: ["test/setup-worker.ts"],
          testTimeout: 60_000,
        },
      },
    ],
  },
});

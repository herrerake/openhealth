// Bindings that `wrangler types` can't see: secrets (.dev.vars) and test-only bindings.
declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string;
    TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
  }
}

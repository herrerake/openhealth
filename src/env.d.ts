// Bindings that `wrangler types` can't see: secrets (.dev.vars) and test-only bindings.
declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string;
    /** Optional: when set, the timeline's block matching asks Claude (D-038). Without it, code matches by duration. */
    ANTHROPIC_API_KEY?: string;
    TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
  }
}

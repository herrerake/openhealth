// Bindings that `wrangler types` can't see: secrets (.dev.vars) and test-only bindings.
declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string;
    /** The demo account's password (D-041). When it's empty, log-in is switched off. */
    DEMO_PASSWORD: string;
    /** Optional: when set, the timeline's block matching asks Claude (D-038). Without it, code matches by duration. */
    ANTHROPIC_API_KEY?: string;
    TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
  }
}

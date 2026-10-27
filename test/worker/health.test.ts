import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("GET /api/health returns ok", async () => {
  const r = await SELF.fetch("http://x/api/health");
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true });
});

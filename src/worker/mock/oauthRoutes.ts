import { Hono } from "hono";
import { html } from "hono/html";
import { isProviderId, registry } from "../../connectors/registry";
import type { AppEnv } from "../env";
import { mintMockCode, mintMockToken, verifyMockCode } from "./oauth";
import { MOCK_MINDBODY_CLIENT, MOCK_WODUP_ATHLETE } from "./providers";

const EXTERNAL_IDS: Record<string, string> = { wodup: MOCK_WODUP_ATHLETE, mindbody: MOCK_MINDBODY_CLIENT };

export const mockOAuth = new Hono<AppEnv>();

// The consent sheet (Phase B styles it). Any credentials work; nothing typed here is stored.
mockOAuth.get("/mock/:provider/oauth/authorize", async (c) => {
  const provider = c.req.param("provider");
  const state = c.req.query("state");
  const redirectUri = c.req.query("redirect_uri");
  if (!isProviderId(provider) || !state || !redirectUri) return c.text("bad request", 400);
  if (c.req.query("auto") === "1") {
    const back = new URL(redirectUri, c.req.url);
    back.searchParams.set("code", await mintMockCode(provider, state, c.env.SESSION_SECRET));
    back.searchParams.set("state", state);
    return c.redirect(back.pathname + back.search, 302);
  }
  const p = registry[provider];
  return c.html(html`<!doctype html>
    <html lang="en">
      <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Connect ${p.displayName}</title></head>
      <body>
        <h1>Connect ${p.displayName}</h1>
        <p>OpenHealth wants to read:</p>
        <ul>${p.scopes.map((s) => html`<li>${s.label}</li>`)}</ul>
        <p>Read-only. OpenHealth can't post, edit, or delete anything in ${p.displayName}.</p>
        <form method="get" action="">
          <input type="hidden" name="state" value="${state}" />
          <input type="hidden" name="redirect_uri" value="${redirectUri}" />
          <input type="hidden" name="auto" value="1" />
          <label>Email <input name="email" type="email" autocomplete="off" /></label>
          <label>Password <input name="password" type="password" autocomplete="off" /></label>
          <button type="submit">Sign in &amp; allow</button>
        </form>
      </body>
    </html>`);
});

mockOAuth.post("/mock/:provider/oauth/token", async (c) => {
  const provider = c.req.param("provider");
  const body = await c.req.json<{ code?: string; state?: string }>().catch(() => ({}) as { code?: string; state?: string });
  if (!isProviderId(provider) || !body.code || !body.state) return c.json({ error: "invalid_request" }, 400);
  if (!(await verifyMockCode(provider, body.state, body.code, c.env.SESSION_SECRET))) return c.json({ error: "invalid_grant" }, 400);
  return c.json({
    access_token: await mintMockToken(provider, c.env.SESSION_SECRET),
    token_type: "bearer",
    external_id: EXTERNAL_IDS[provider] ?? "demo",
  });
});

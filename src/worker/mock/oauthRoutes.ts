import { Hono } from "hono";
import type { Context } from "hono";
import { html, raw } from "hono/html";
import { isProviderId, registry } from "../../connectors/registry";
import type { ProviderId } from "../../core/types";
import type { AppEnv } from "../env";
import { mintMockCode, mintMockToken, verifyMockCode } from "./oauth";
import { MOCK_HYROX_ATHLETE, MOCK_MINDBODY_CLIENT, MOCK_WODUP_ATHLETE } from "./providers";

const EXTERNAL_IDS: Record<string, string> = { wodup: MOCK_WODUP_ATHLETE, mindbody: MOCK_MINDBODY_CLIENT, hyrox: MOCK_HYROX_ATHLETE };

export const mockOAuth = new Hono<AppEnv>();

const CONSENT_CSS = `
  :root { color-scheme: light dark; --bg: #fff; --fg: #0a0a0a; --muted: #737373; --border: #e5e5e5; --primary: #171717; --primary-fg: #fafafa; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --fg: #fafafa; --muted: #a3a3a3; --border: #262626; --primary: #e5e5e5; --primary-fg: #171717; } }
  * { box-sizing: border-box; } body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
    font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; padding: 16px; }
  .sheet { width: 100%; max-width: 380px; border: 1px solid var(--border); border-radius: 14px; padding: 24px; }
  .kicker { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  h1 { font-size: 20px; margin: 4px 0 12px; } ul { padding-left: 18px; margin: 8px 0; } .muted { color: var(--muted); font-size: 13px; }
  label { display: grid; gap: 6px; font-weight: 500; margin-top: 12px; }
  input { height: 36px; border: 1px solid var(--border); border-radius: 8px; padding: 0 10px; background: transparent; color: inherit; font: inherit; }
  button { margin-top: 16px; width: 100%; height: 38px; border: 0; border-radius: 8px; background: var(--primary); color: var(--primary-fg); font: inherit; font-weight: 600; cursor: pointer; }`;

// The provider's consent sheet (demo). Any credentials work; nothing typed here is stored, and the
// form posts so a password never lands in a URL.
async function approve(c: Context<AppEnv>, provider: ProviderId, state: string): Promise<Response> {
  const code = await mintMockCode(provider, state, c.env.SESSION_SECRET);
  return c.redirect(`/api/connect/${provider}/callback?${new URLSearchParams({ code, state })}`, 302);
}

mockOAuth.get("/mock/:provider/oauth/authorize", async (c) => {
  const provider = c.req.param("provider");
  const state = c.req.query("state");
  const redirectUri = c.req.query("redirect_uri");
  if (!isProviderId(provider) || !state || !redirectUri) return c.text("bad request", 400);
  // Only our own callback for this provider: never redirect anywhere a caller names.
  if (redirectUri !== `/api/connect/${provider}/callback`) return c.text("redirect_uri not allowed", 400);
  if (c.req.query("auto") === "1") return approve(c, provider, state);
  const p = registry[provider];
  return c.html(html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Connect ${p.displayName}</title>
        <style>
          ${raw(CONSENT_CSS)}
        </style>
      </head>
      <body>
        <form class="sheet" method="post">
          <div class="kicker">Sign in</div>
          <h1>Connect ${p.displayName}</h1>
          <div><strong>OpenHealth wants to read:</strong></div>
          <ul>
            ${p.scopes.map((s) => html`<li>${s.label}</li>`)}
          </ul>
          <p class="muted">Read-only. OpenHealth can't post, edit, or delete anything in ${p.displayName}.</p>
          <input type="hidden" name="state" value="${state}" />
          <input type="hidden" name="redirect_uri" value="${redirectUri}" />
          <label for="email">Email <input id="email" name="email" type="email" autocomplete="off" /></label>
          <label for="password">Password <input id="password" name="password" type="password" autocomplete="off" /></label>
          <button type="submit">Sign in &amp; allow</button>
        </form>
      </body>
    </html>`);
});

mockOAuth.post("/mock/:provider/oauth/authorize", async (c) => {
  const provider = c.req.param("provider");
  const form = await c.req.parseBody();
  const state = typeof form.state === "string" ? form.state : "";
  if (!isProviderId(provider) || !state || form.redirect_uri !== `/api/connect/${provider}/callback`) return c.text("bad request", 400);
  return approve(c, provider, state);
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

import { Hono } from "hono";
import { MAX_APPLE_BATCH, appleRecordError } from "../../connectors/appleHealth";
import { isProviderId, registry } from "../../connectors/registry";
import type { SourceRecordInput } from "../../core/types";
import type { AppEnv } from "../env";
import { internalFetch, mockBaseUrl } from "../internal";
import { requireAthlete } from "../session";
import { insertSourceRecords, upsertConnection } from "../store";

const STATE_TTL_MS = 10 * 60_000;

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const connect = new Hono<AppEnv>();

connect.get("/api/connect/:provider/start", requireAthlete, async (c) => {
  const provider = c.req.param("provider");
  if (!isProviderId(provider)) return c.json({ error: "unknown_provider" }, 404);
  if (registry[provider].kind === "file") return c.json({ error: "file_provider" }, 400);
  const state = randomState();
  await c.env.DB.prepare("INSERT INTO oauth_states (state, athlete_id, provider, created_at) VALUES (?, ?, ?, ?)")
    .bind(state, c.var.athleteId, provider, new Date().toISOString())
    .run();
  const authorize = new URL(`/mock/${provider}/oauth/authorize`, c.req.url);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("redirect_uri", `/api/connect/${provider}/callback`);
  return c.redirect(authorize.pathname + authorize.search, 302);
});

connect.get("/api/connect/:provider/callback", requireAthlete, async (c) => {
  const provider = c.req.param("provider");
  if (!isProviderId(provider)) return c.json({ error: "unknown_provider" }, 404);
  const state = c.req.query("state") ?? "";
  const code = c.req.query("code") ?? "";
  // Claim the state atomically: only an unused, unexpired state for this athlete and provider.
  const claimed = await c.env.DB.prepare(
    `UPDATE oauth_states SET used_at = ? WHERE state = ? AND athlete_id = ? AND provider = ? AND used_at IS NULL AND created_at > ?`,
  )
    .bind(new Date().toISOString(), state, c.var.athleteId, provider, new Date(Date.now() - STATE_TTL_MS).toISOString())
    .run();
  if (claimed.meta.changes !== 1) return c.json({ error: "invalid_state" }, 400);

  const tokenResponse = await internalFetch(c.env)(`${mockBaseUrl(provider)}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
  if (!tokenResponse.ok) return c.json({ error: "invalid_grant" }, 400);
  const token = await tokenResponse.json<{ access_token: string; external_id: string }>();
  await upsertConnection(c.env.DB, c.var.athleteId, provider, {
    status: "connected",
    mode: "demo",
    credentials: { token: token.access_token, externalId: token.external_id },
    lastError: null,
  });
  return c.redirect(`/onboarding/connect?connected=${provider}`, 302);
});

connect.delete("/api/connections/:provider", requireAthlete, async (c) => {
  const provider = c.req.param("provider");
  if (!isProviderId(provider)) return c.json({ error: "unknown_provider" }, 404);
  await upsertConnection(c.env.DB, c.var.athleteId, provider, { status: "disconnected", credentials: null });
  return c.json({ ok: true });
});

connect.post("/api/connect/apple_health/batches", requireAthlete, async (c) => {
  const body = await c.req.json<{ fileSha256?: string; records?: SourceRecordInput[] }>().catch(() => null);
  const records = body?.records;
  if (!body || typeof body.fileSha256 !== "string" || !Array.isArray(records)) return c.json({ error: "invalid_batch" }, 400);
  if (records.length > MAX_APPLE_BATCH) return c.json({ error: "batch_too_large", max: MAX_APPLE_BATCH }, 413);
  for (const [index, record] of records.entries()) {
    const reason = appleRecordError(record);
    if (reason) return c.json({ error: "invalid_record", index, reason }, 400);
  }
  const counts = await insertSourceRecords(c.env.DB, c.var.athleteId, `upload:${body.fileSha256}`, records);
  await upsertConnection(c.env.DB, c.var.athleteId, "apple_health", { status: "connected", mode: "file", lastSyncAt: new Date().toISOString() });
  return c.json(counts);
});

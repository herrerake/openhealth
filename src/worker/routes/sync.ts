import { getAgentByName } from "agents";
import { Hono } from "hono";
import { isProviderId } from "../../connectors/registry";
import type { AppEnv } from "../env";
import { requireAthlete } from "../session";

export const sync = new Hono<AppEnv>();

sync.post("/api/sync", requireAthlete, async (c) => {
  const body = await c.req.json<{ providers?: string[] }>().catch(() => ({}) as { providers?: string[] });
  if (body.providers && !body.providers.every(isProviderId)) return c.json({ error: "unknown_provider" }, 400);
  const agent = await getAgentByName(c.env.AthleteAgent, c.var.athleteId);
  const { runId } = await agent.startSync(body.providers as never);
  return c.json({ runId }, 202);
});

sync.get("/api/sync/state", requireAthlete, async (c) => {
  const agent = await getAgentByName(c.env.AthleteAgent, c.var.athleteId);
  return c.json(await agent.getSyncState());
});

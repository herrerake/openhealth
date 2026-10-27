import { Hono } from "hono";
import { listProviders } from "../../connectors/registry";
import type { AppEnv } from "../env";
import { requireAthlete } from "../session";
import { getConnections } from "../store";

export const providers = new Hono<AppEnv>();

providers.get("/api/providers", requireAthlete, async (c) => {
  const connections = new Map((await getConnections(c.env.DB, c.var.athleteId)).map((x) => [x.provider, x]));
  return c.json(
    listProviders().map((p) => {
      const conn = connections.get(p.id);
      return {
        id: p.id,
        displayName: p.displayName,
        category: p.category,
        kind: p.kind,
        status: p.status,
        scopes: p.scopes,
        connection: conn ? { status: conn.status, lastSyncAt: conn.lastSyncAt } : null,
      };
    }),
  );
});

import { Hono } from "hono";
import { resolveAsOf } from "../dashboard/asOf";
import { HOME_SPEC, isTileType } from "../dashboard/spec";
import { type TileContext, computeTile, recordDetail } from "../dashboard/tiles";
import type { AppEnv } from "../env";
import { currentGeneration } from "../reconcileStore";
import { requireAthlete } from "../session";

export const dashboard = new Hono<AppEnv>();

async function context(c: { env: AppEnv["Bindings"]; var: { athleteId: string }; req: { query(k: string): string | undefined } }): Promise<TileContext> {
  const { asOf, tz } = await resolveAsOf(c.env, c.env.DB, c.var.athleteId, c.req.query("asOf"));
  return { env: c.env, db: c.env.DB, athleteId: c.var.athleteId, asOf, tz, generation: await currentGeneration(c.env.DB, c.var.athleteId) };
}

dashboard.get("/api/dashboards/home", requireAthlete, async (c) => {
  const ctx = await context(c);
  const tiles = await Promise.all(HOME_SPEC.tiles.map((t) => computeTile(t.type, ctx)));
  return c.json({ spec: HOME_SPEC, asOf: ctx.asOf, tiles: Object.fromEntries(tiles.map((t) => [t.type, t])) });
});

dashboard.get("/api/tiles/:type", requireAthlete, async (c) => {
  const type = c.req.param("type");
  if (!isTileType(type)) return c.json({ error: "unknown_tile" }, 404);
  return c.json(await computeTile(type, await context(c)));
});

/** One benchmark's full record: every attempt, the progression of the best, and links to each session. */
dashboard.get("/api/records/:benchmark", requireAthlete, async (c) => {
  const detail = await recordDetail(await context(c), c.req.param("benchmark"));
  return detail ? c.json(detail) : c.json({ error: "not_found" }, 404);
});

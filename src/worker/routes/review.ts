import { Hono } from "hono";
import { type ReviewItem, reviewItems } from "../dashboard/tiles";
import type { AppEnv } from "../env";
import { currentGeneration, runReconcile } from "../reconcileStore";
import { requireAthlete } from "../session";

const ALLOWED: Record<ReviewItem["kind"], string[]> = { merge_split: ["merge", "split"], pick: ["pick"], confirm: ["confirm"] };

export const review = new Hono<AppEnv>();

review.get("/api/review", requireAthlete, async (c) => {
  return c.json(await reviewItems(c.env.DB, c.var.athleteId, await currentGeneration(c.env.DB, c.var.athleteId)));
});

review.post("/api/review/:sessionKey", requireAthlete, async (c) => {
  const athleteId = c.var.athleteId;
  const key = c.req.param("sessionKey");
  const body = await c.req.json<{ action?: string; payload?: { field?: string; source?: string } }>().catch(() => ({}) as never);
  const generation = await currentGeneration(c.env.DB, athleteId);
  const item = (await reviewItems(c.env.DB, athleteId, generation)).find((i) => i.sessionKey === key);
  if (!item) {
    const exists = await c.env.DB.prepare("SELECT 1 AS x FROM sessions WHERE athlete_id = ? AND generation = ? AND session_key = ?")
      .bind(athleteId, generation, key)
      .first();
    return exists ? c.json({ error: "nothing_to_review" }, 400) : c.json({ error: "not_found" }, 404);
  }
  if (!body?.action || !ALLOWED[item.kind].includes(body.action)) return c.json({ error: "action_not_allowed", allowed: ALLOWED[item.kind] }, 400);

  const payload: Record<string, string> = {};
  if (body.action === "pick") {
    const { results: conflicts } = await c.env.DB.prepare(
      `SELECT c.field, c.values_json FROM conflicts c JOIN sessions s ON s.id = c.session_id
       WHERE c.athlete_id = ? AND c.generation = ? AND s.session_key = ?`,
    )
      .bind(athleteId, generation, key)
      .all<{ field: string; values_json: string }>();
    const field = body.payload?.field;
    const source = body.payload?.source;
    const targets = conflicts.filter((x) => !field || x.field === field);
    if (!source || !targets.length || !targets.every((x) => source in JSON.parse(x.values_json))) {
      return c.json({ error: "invalid_pick", fields: conflicts.map((x) => x.field) }, 400);
    }
    payload.source = source;
    if (field) payload.field = field;
  }

  await c.env.DB.prepare("INSERT INTO decisions (athlete_id, scope_key, action, payload, decided_at) VALUES (?, ?, ?, ?, ?)")
    .bind(athleteId, key, body.action, JSON.stringify(payload), new Date().toISOString())
    .run();
  await runReconcile(c.env.DB, athleteId, c.env.SITE_TZ);
  return c.json({ ok: true, queue: await reviewItems(c.env.DB, athleteId, await currentGeneration(c.env.DB, athleteId)) });
});

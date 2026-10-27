import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { SESSION_COOKIE, requireAthlete, signSession } from "../session";
import { getConnections } from "../store";

const validTimeZone = (tz: unknown): tz is string => {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const athletes = new Hono<AppEnv>();

athletes.post("/api/athletes", async (c) => {
  const body = await c.req.json<{ name?: string; primarySport?: string; tz?: string }>().catch(() => ({}) as never);
  const name = body?.name?.trim();
  if (!name || !validTimeZone(body.tz)) return c.json({ error: "name and a valid IANA time zone are required" }, 400);
  const id = `ath_${crypto.randomUUID()}`;
  await c.env.DB.prepare("INSERT INTO athletes (id, name, primary_sport, tz, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, name, body.primarySport ?? null, body.tz, new Date().toISOString())
    .run();
  setCookie(c, SESSION_COOKIE, await signSession(id, c.env.SESSION_SECRET), {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: new URL(c.req.url).protocol === "https:",
  });
  return c.json({ id }, 201);
});

athletes.get("/api/me", requireAthlete, async (c) => {
  const athlete = await c.env.DB.prepare("SELECT id, name, primary_sport, tz FROM athletes WHERE id = ?")
    .bind(c.var.athleteId)
    .first<{ id: string; name: string; primary_sport: string | null; tz: string }>();
  if (!athlete) return c.json({ error: "unauthorized" }, 401);
  const connections = await getConnections(c.env.DB, athlete.id);
  return c.json({ id: athlete.id, name: athlete.name, primarySport: athlete.primary_sport, tz: athlete.tz, connections });
});

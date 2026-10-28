import { Hono } from "hono";
import type { AppEnv } from "../env";
import { endSession, requireAthlete, secretsEqual, startSession } from "../session";
import { deleteAthlete, getConnections } from "../store";

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
  await startSession(c, id);
  return c.json({ id }, 201);
});

// The demo account (D-041): Hyrox Henry, already signed up. Its email is a var and its password a secret.
// Every log-in starts him over (D-043): the old Henry and all his data go, and a new one picks up onboarding
// at Connect, so each rehearsal and the stage demo run the same flow.
const DEMO_ATHLETE = { name: "Henry Walsh", primarySport: "hyrox", tz: "America/Chicago" };

athletes.post("/api/login", async (c) => {
  if (!c.env.DEMO_EMAIL || !c.env.DEMO_PASSWORD) return c.json({ error: "log-in isn't set up" }, 503);
  const body = await c.req.json<{ email?: unknown; password?: unknown }>().catch(() => ({}) as never);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const emailOk = email === c.env.DEMO_EMAIL.toLowerCase();
  const passwordOk = await secretsEqual(password, c.env.DEMO_PASSWORD, c.env.SESSION_SECRET);
  if (!emailOk || !passwordOk) return c.json({ error: "invalid credentials" }, 401);

  const previous = await c.env.DB.prepare("SELECT id FROM athletes WHERE email = ?").bind(email).first<{ id: string }>();
  if (previous) await deleteAthlete(c.env.DB, previous.id);
  // A new id also means a new AthleteAgent, so no sync state carries over.
  const id = `ath_${crypto.randomUUID()}`;
  await c.env.DB.prepare("INSERT INTO athletes (id, name, primary_sport, tz, created_at, email) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, DEMO_ATHLETE.name, DEMO_ATHLETE.primarySport, DEMO_ATHLETE.tz, new Date().toISOString(), email)
    .run();
  await startSession(c, id);
  return c.json({ next: "/onboarding/connect" });
});

athletes.post("/api/logout", (c) => {
  endSession(c);
  return c.body(null, 204);
});

athletes.get("/api/me", requireAthlete, async (c) => {
  const athlete = await c.env.DB.prepare("SELECT id, name, primary_sport, tz FROM athletes WHERE id = ?")
    .bind(c.var.athleteId)
    .first<{ id: string; name: string; primary_sport: string | null; tz: string }>();
  if (!athlete) return c.json({ error: "unauthorized" }, 401);
  const connections = await getConnections(c.env.DB, athlete.id);
  return c.json({ id: athlete.id, name: athlete.name, primarySport: athlete.primary_sport, tz: athlete.tz, connections });
});

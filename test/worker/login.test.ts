import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const login = (body: unknown) =>
  SELF.fetch("http://x/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];

describe("demo account log-in (D-041)", () => {
  it("signs Henry in, creating his athlete on first log-in, and sends him to connect his apps", async () => {
    const r = await login({ email: " Henry@Example.com ", password: "test-demo-password" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ next: "/onboarding/connect" });
    const me = await SELF.fetch("http://x/api/me", { headers: { cookie: cookieOf(r) } });
    expect(await me.json()).toMatchObject({ name: "Henry Walsh", primarySport: "hyrox", tz: "America/Chicago", connections: [] });
  });

  it("starts Henry over on every log-in: a new athlete, none of the old data, back at Connect (D-043)", async () => {
    const first = await (await SELF.fetch("http://x/api/me", { headers: { cookie: cookieOf(await login({ email: "henry@example.com", password: "test-demo-password" })) } })).json<{ id: string }>();
    await env.DB.prepare("INSERT INTO connections (id, athlete_id, provider, status, mode) VALUES ('c1', ?, 'wodup', 'connected', 'demo')").bind(first.id).run();
    await env.DB.prepare("INSERT INTO sessions (athlete_id, session_key, local_date, kind, category, status) VALUES (?, 'k1', '2026-10-01', 'class', 'metcon', 'confirmed')").bind(first.id).run();

    const r = await login({ email: "henry@example.com", password: "test-demo-password" });
    expect(await r.json()).toEqual({ next: "/onboarding/connect" });
    const second = await (await SELF.fetch("http://x/api/me", { headers: { cookie: cookieOf(r) } })).json<{ id: string; connections: unknown[] }>();
    expect(second.id).not.toBe(first.id);
    expect(second.connections).toEqual([]);
    for (const table of ["athletes WHERE id", "connections WHERE athlete_id", "sessions WHERE athlete_id"]) {
      expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} = ?`).bind(first.id).first("n")).toBe(0);
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM athletes WHERE email = 'henry@example.com'").first("n")).toBe(1);
  });

  it("ends the old session when Henry logs in again", async () => {
    const old = cookieOf(await login({ email: "henry@example.com", password: "test-demo-password" }));
    await login({ email: "henry@example.com", password: "test-demo-password" });
    expect((await SELF.fetch("http://x/api/me", { headers: { cookie: old } })).status).toBe(401);
  });

  it("rejects a wrong password or email without setting a cookie", async () => {
    for (const body of [{ email: "henry@example.com", password: "nope" }, { email: "someone@example.com", password: "test-demo-password" }, {}]) {
      const r = await login(body);
      expect(r.status).toBe(401);
      expect(r.headers.get("set-cookie")).toBeNull();
    }
  });

  it("log-out clears the session cookie", async () => {
    const r = await SELF.fetch("http://x/api/logout", { method: "POST" });
    expect(r.status).toBe(204);
    expect(r.headers.get("set-cookie")).toMatch(/oh_session=;.*Max-Age=0/);
  });
});

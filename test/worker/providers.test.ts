import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authedFetch } from "./helpers";

describe("athlete session", () => {
  it("creates an athlete and sets a session cookie", async () => {
    const r = await SELF.fetch("http://x/api/athletes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alex Rivera", primarySport: "crossfit", tz: "America/Los_Angeles" }),
    });
    expect(r.status).toBe(201);
    expect(r.headers.get("set-cookie")).toMatch(/oh_session=/);
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly/);
  });

  it("rejects an athlete without a name or time zone", async () => {
    const r = await SELF.fetch("http://x/api/athletes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "", tz: "Not/AZone" }),
    });
    expect(r.status).toBe(400);
  });

  it("returns the current athlete", async () => {
    const me = await (await authedFetch("/api/me")).json();
    expect(me).toMatchObject({ name: "Alex Rivera", primarySport: "crossfit", tz: "America/Los_Angeles", connections: [] });
  });

  it("rejects requests without a session", async () => {
    expect((await SELF.fetch("http://x/api/providers")).status).toBe(401);
  });

  it("rejects a tampered cookie", async () => {
    expect((await SELF.fetch("http://x/api/me", { headers: { cookie: "oh_session=a1.forged" } })).status).toBe(401);
  });
});

describe("provider catalog", () => {
  it("lists eight providers grouped by category", async () => {
    const list = await (await authedFetch("/api/providers")).json();
    expect(list.map((p: any) => p.id)).toEqual([
      "apple_health",
      "garmin",
      "oura",
      "whoop",
      "wodup",
      "mindbody",
      "hyrox",
      "race_results",
    ]);
    expect(list.find((p: any) => p.id === "apple_health").kind).toBe("file");
    expect(list.find((p: any) => p.id === "wodup").scopes.map((s: any) => s.label)).toEqual([
      "Workouts, scores and PRs",
      "Your notes on results",
      "Programs you follow",
    ]);
    expect(list.every((p: any) => p.connection === null)).toBe(true);
  });
});

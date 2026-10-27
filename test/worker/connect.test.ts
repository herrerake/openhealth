import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authedFetch, createAthlete } from "./helpers";

const pathOf = (location: string) => {
  const u = new URL(location, "http://x");
  return u.pathname + u.search;
};

/** start → authorize?auto=1 → callback URL (not yet visited). */
async function callbackUrlFor(provider: string, cookie?: string): Promise<string> {
  const start = await authedFetch(`/api/connect/${provider}/start`, { redirect: "manual" }, cookie);
  expect(start.status).toBe(302);
  const auth = new URL(start.headers.get("location")!, "http://x");
  auth.searchParams.set("auto", "1");
  const back = await SELF.fetch(auth.toString(), { redirect: "manual" });
  expect(back.status).toBe(302);
  return pathOf(back.headers.get("location")!);
}

async function connectVia(provider: string): Promise<string> {
  const cb = await authedFetch(await callbackUrlFor(provider), { redirect: "manual" });
  expect(cb.status).toBe(302);
  const list = await (await authedFetch("/api/providers")).json<any[]>();
  return list.find((p) => p.id === provider).connection?.status;
}

describe("connect flow", () => {
  it("completes the flow and stores a connection", async () => {
    const cb = await authedFetch(await callbackUrlFor("wodup"), { redirect: "manual" });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/onboarding/connect?connected=wodup");
    const list = await (await authedFetch("/api/providers")).json<any[]>();
    expect(list.find((p) => p.id === "wodup").connection.status).toBe("connected");
  });

  it("stores the provider's external id with the token", async () => {
    await connectVia("mindbody");
    const me = await (await authedFetch("/api/me")).json<any>();
    expect(me.connections.find((c: any) => c.provider === "mindbody").credentials.externalId).toBe("100015482");
  });

  it("state is single-use", async () => {
    const url = await callbackUrlFor("wodup");
    expect((await authedFetch(url, { redirect: "manual" })).status).toBe(302);
    expect((await authedFetch(url, { redirect: "manual" })).status).toBe(400);
  });

  it("unknown state is rejected", async () => {
    expect((await authedFetch("/api/connect/wodup/callback?code=x&state=nope")).status).toBe(400);
  });

  it("state from another athlete is rejected", async () => {
    const other = await createAthlete("Someone Else");
    const url = await callbackUrlFor("wodup", other);
    expect((await authedFetch(url, { redirect: "manual" })).status).toBe(400);
  });

  it("a forged code is rejected", async () => {
    const url = new URL(await callbackUrlFor("wodup"), "http://x");
    url.searchParams.set("code", "code_wodup_forged");
    expect((await authedFetch(url.pathname + url.search, { redirect: "manual" })).status).toBe(400);
  });

  it("the consent page refuses foreign redirect URIs", async () => {
    for (const uri of ["https://a//evil.com/p", "//evil.com/p", "https://evil.com/api/connect/wodup/callback", "/api/connect/mindbody/callback"]) {
      const r = await SELF.fetch(`http://x/mock/wodup/oauth/authorize?state=s&auto=1&redirect_uri=${encodeURIComponent(uri)}`, { redirect: "manual" });
      expect(r.status).toBe(400);
    }
  });

  it("apple_health has no oauth", async () => {
    expect((await authedFetch("/api/connect/apple_health/start")).status).toBe(400);
  });

  it("unknown providers 404", async () => {
    expect((await authedFetch("/api/connect/strava/start")).status).toBe(404);
  });

  it("stub providers connect too", async () => {
    expect(await connectVia("oura")).toBe("connected");
  });

  it("the consent page lists the provider's scopes", async () => {
    const start = await authedFetch("/api/connect/wodup/start", { redirect: "manual" });
    const html = await (await SELF.fetch(new URL(start.headers.get("location")!, "http://x"))).text();
    expect(html).toContain("Workouts, scores and PRs");
    expect(html).toContain("Read-only");
  });

  it("disconnect keeps the connection row as disconnected", async () => {
    await connectVia("wodup");
    expect((await authedFetch("/api/connections/wodup", { method: "DELETE" })).status).toBe(200);
    const list = await (await authedFetch("/api/providers")).json<any[]>();
    expect(list.find((p) => p.id === "wodup").connection.status).toBe("disconnected");
  });
});

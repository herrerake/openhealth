import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { mintMockToken } from "../../src/worker/mock/oauth";
import { seedMockFixtures } from "./seed";

beforeEach(seedMockFixtures);

const basic = (token: string) => `Basic ${btoa(`${token}:`)}`;
const wodupUrl = (athlete = "ath_Hn4Rx8Yk", q = "limit=100") =>
  `http://x/mock/wodup/api/public/athletes/${athlete}/training_sessions?${q}`;
const mindbodyUrl = (client = "100015482") =>
  `http://x/mock/mindbody/public/v6/client/clientvisits?request.clientId=${client}&request.limit=200&request.offset=0`;

describe("WodUp mock", () => {
  it("requires auth", async () => {
    expect((await SELF.fetch(wodupUrl())).status).toBe(401);
    expect((await SELF.fetch(wodupUrl(), { headers: { authorization: basic("mock_wodup_forged") } })).status).toBe(401);
  });

  it("404s for another athlete", async () => {
    const token = await mintMockToken("wodup", env.SESSION_SECRET);
    expect((await SELF.fetch(wodupUrl("ath_someoneelse"), { headers: { authorization: basic(token) } })).status).toBe(404);
  });

  it("serves a page with a valid token", async () => {
    const token = await mintMockToken("wodup", env.SESSION_SECRET);
    const r = await SELF.fetch(wodupUrl(), { headers: { authorization: basic(token) } });
    expect(r.status).toBe(200);
    expect(await r.json()).toHaveLength(100);
  });

  it("returns the error envelope for a bad limit", async () => {
    const token = await mintMockToken("wodup", env.SESSION_SECRET);
    const r = await SELF.fetch(wodupUrl(undefined, "limit=500"), { headers: { authorization: basic(token) } });
    expect(r.status).toBe(400);
    expect(await r.json()).toHaveProperty("errors");
  });

  it("a token for another provider is rejected", async () => {
    const token = await mintMockToken("mindbody", env.SESSION_SECRET);
    expect((await SELF.fetch(wodupUrl(), { headers: { authorization: basic(token) } })).status).toBe(401);
  });
});

describe("Mindbody mock", () => {
  const headers = async () => ({
    "api-key": "demo-key",
    siteid: "-99",
    authorization: await mintMockToken("mindbody", env.SESSION_SECRET),
  });

  it("requires the Api-Key, SiteId and Authorization headers", async () => {
    expect((await SELF.fetch(mindbodyUrl())).status).toBe(401);
  });

  it("404s for another client", async () => {
    expect((await SELF.fetch(mindbodyUrl("999"), { headers: await headers() })).status).toBe(404);
  });

  it("serves visits with pagination", async () => {
    const r = await SELF.fetch(mindbodyUrl(), { headers: await headers() });
    expect(r.status).toBe(200);
    const body = await r.json<any>();
    expect(body.PaginationResponse.RequestedLimit).toBe(200);
    expect(body.Visits).toHaveLength(Math.min(200, body.PaginationResponse.TotalResults));
  });
});

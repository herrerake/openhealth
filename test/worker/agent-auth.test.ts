import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authedFetch, createAthlete } from "./helpers";

const myId = async () => (await (await authedFetch("/api/me")).json<{ id: string }>()).id;

describe("agent access", () => {
  it("rejects agent requests without a session", async () => {
    const id = await myId();
    expect((await SELF.fetch(`http://x/agents/athlete-agent/${id}`)).status).toBe(401);
  });

  it("rejects a double-slash path without a session", async () => {
    const id = await myId();
    expect((await SELF.fetch(`http://x//agents/athlete-agent/${id}`)).status).toBe(401);
    expect((await SELF.fetch(`http://x/agents//athlete-agent/${id}`)).status).toBe(401);
  });

  it("rejects another athlete's session", async () => {
    const id = await myId();
    const other = await createAthlete("Someone Else");
    expect((await SELF.fetch(`http://x/agents/athlete-agent/${id}`, { headers: { cookie: other } })).status).toBe(403);
  });

  it("serves the owner's sync state over HTTP", async () => {
    const state = await (await authedFetch("/api/sync/state")).json<any>();
    expect(state).toMatchObject({ runId: null, status: "idle" });
  });
});

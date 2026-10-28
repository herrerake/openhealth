import { SELF } from "cloudflare:test";
import { expect } from "vitest";

const cookies = new Map<string, string>();

export async function createAthlete(name = "Henry Walsh"): Promise<string> {
  const r = await SELF.fetch("http://x/api/athletes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, primarySport: "hyrox", tz: "America/Chicago" }),
  });
  const cookie = r.headers.get("set-cookie")!.split(";")[0];
  return cookie;
}

/** Fetches as a signed-in athlete; one athlete per test (storage is isolated per test). */
export async function authedFetch(path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  const testName = expect.getState().currentTestName ?? "default";
  let c = cookie ?? cookies.get(testName);
  if (!c) {
    c = await createAthlete();
    cookies.set(testName, c);
  }
  const headers = new Headers(init.headers);
  headers.set("cookie", c);
  return SELF.fetch(`http://x${path}`, { ...init, headers });
}

export async function currentCookie(): Promise<string> {
  await authedFetch("/api/me");
  return cookies.get(expect.getState().currentTestName ?? "default")!;
}

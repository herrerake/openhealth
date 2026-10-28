import type { Env } from "../env";

export type FixtureKey = "wodup/training_sessions.json" | "mindbody/client_visits.json" | "hyrox/results.json";

const cache = new Map<FixtureKey, unknown>();

/** Reads a fixture the seed script put in R2 at mock/<key>; parsed once per isolate. */
export async function loadFixture(env: Env, key: FixtureKey): Promise<unknown> {
  if (cache.has(key)) return cache.get(key);
  const obj = await env.RAW.get(`mock/${key}`);
  if (!obj) throw new Error(`Mock fixture mock/${key} is missing; run npm run seed:mock`);
  const value = await obj.json();
  cache.set(key, value);
  return value;
}

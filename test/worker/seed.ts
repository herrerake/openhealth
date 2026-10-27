import { env } from "cloudflare:test";
import visits from "../../fixtures/data/mindbody/client_visits.json";
import sessions from "../../fixtures/data/wodup/training_sessions.json";

/** Puts the generated fixtures where the mock providers read them (R2 mock/<key>). */
export async function seedMockFixtures(): Promise<void> {
  await env.RAW.put("mock/wodup/training_sessions.json", JSON.stringify(sessions));
  await env.RAW.put("mock/mindbody/client_visits.json", JSON.stringify(visits));
}

export const fixtureSessions = sessions as unknown as any[];
export const fixtureVisits = (visits as any).Visits as any[];

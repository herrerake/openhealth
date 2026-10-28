import { env } from "cloudflare:test";
import appleRecords from "../../fixtures/data/apple-health/records.json";
import expected from "../../fixtures/data/expected.json";
import hyrox from "../../fixtures/data/hyrox/results.json";
import visits from "../../fixtures/data/mindbody/client_visits.json";
import sessions from "../../fixtures/data/wodup/training_sessions.json";
import { hyroxRecord } from "../../src/connectors/hyrox";
import { mindbodyRecord } from "../../src/connectors/mindbody";
import { wodupRecords } from "../../src/connectors/wodup";
import type { SourceRecordInput } from "../../src/core/types";
import { insertSourceRecords } from "../../src/worker/store";

export const fixtureSessions = sessions as unknown as any[];
export const fixtureVisits = (visits as any).Visits as any[];
export const expectedFixture = expected as any;

/** Puts the generated fixtures where the mock providers read them (R2 mock/<key>). */
export async function seedMockFixtures(): Promise<void> {
  await env.RAW.put("mock/wodup/training_sessions.json", JSON.stringify(sessions));
  await env.RAW.put("mock/mindbody/client_visits.json", JSON.stringify(visits));
  await env.RAW.put("mock/hyrox/results.json", JSON.stringify(hyrox));
}

/** The Apple Health records the browser parser would upload (parsed once by test/global-apple-records.ts). */
export const fixtureAppleRecords = appleRecords as unknown as SourceRecordInput[];

export function allFixtureRecords(tz = "America/Chicago"): SourceRecordInput[] {
  return [
    ...fixtureVisits.map((v) => mindbodyRecord(v, tz)),
    ...fixtureSessions.flatMap((s) => wodupRecords(s, tz)),
    ...(hyrox as any).results.map((r: any) => hyroxRecord(r, tz)),
    ...fixtureAppleRecords,
  ];
}

export async function insertAllFixtureRecords(athleteId: string): Promise<void> {
  await insertSourceRecords(env.DB, athleteId, "seed", allFixtureRecords());
}

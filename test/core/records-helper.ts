import { createReadStream } from "node:fs";
import { mindbodyRecord } from "../../src/connectors/mindbody";
import { wodupRecords } from "../../src/connectors/wodup";
import { parseAppleExport } from "../../src/core/apple/parse";
import type { SourceRecordInput, StoredSourceRecord } from "../../src/core/types";
import { appleXmlPath, ensureGenerated, readSessions, readVisits } from "./fixture-helpers";

export const TZ = "America/Los_Angeles";

async function* fileChunks(path: string): AsyncIterable<Uint8Array> {
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) yield chunk as Uint8Array;
}

let cached: StoredSourceRecord[] | null = null;

/** Every fixture record shaped exactly as the connectors and the Apple parser produce them, with ids. */
export async function fixtureRecords(): Promise<StoredSourceRecord[]> {
  if (cached) return cached;
  ensureGenerated();
  const inputs: SourceRecordInput[] = [
    ...readVisits().map((v) => mindbodyRecord(v, TZ)),
    ...readSessions().flatMap((s) => wodupRecords(s, TZ)),
  ];
  for await (const batch of parseAppleExport(() => fileChunks(appleXmlPath))) inputs.push(...batch);
  cached = inputs.map((r, i) => ({ ...r, id: i + 1 }));
  return cached;
}

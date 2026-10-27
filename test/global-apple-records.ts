// Worker tests can't stream a 20+ MB XML file through the Workers runtime cheaply, so the
// Node side parses the Apple fixture once and writes the resulting source records as JSON.
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAppleExport } from "../src/core/apple/parse";
import type { SourceRecordInput } from "../src/core/types";

const ROOT = join(import.meta.dirname, "..");
const XML = join(ROOT, "fixtures/data/apple-health/export.xml");
const OUT = join(ROOT, "fixtures/data/apple-health/records.json");
const PARSER = join(ROOT, "src/core/apple/parse.ts");

async function* fileChunks(path: string): AsyncIterable<Uint8Array> {
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) yield chunk as Uint8Array;
}

export default async function setup(): Promise<void> {
  if (!existsSync(XML)) execFileSync("node", [join(ROOT, "fixtures/generate.mjs")], { stdio: "pipe" });
  const fresh = existsSync(OUT) && statSync(OUT).mtimeMs >= Math.max(statSync(XML).mtimeMs, statSync(PARSER).mtimeMs);
  if (fresh) return;
  const records: SourceRecordInput[] = [];
  for await (const batch of parseAppleExport(() => fileChunks(XML))) records.push(...batch);
  writeFileSync(OUT, JSON.stringify(records));
}

// End-to-end Phase A demo against a running `wrangler dev`: create the athlete, connect WodUp and
// Mindbody through the demo sign-in, parse and upload the Apple Health export, run a sync, and
// print live progress and timings.
//
//   npm run demo:sync                      # synthetic fixture export
//   npm run demo:sync -- --apple <file>    # your own export.xml or export.zip
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAppleExport } from "../src/core/apple/parse";
import { unzipExport } from "../src/core/apple/unzip";
import type { SyncState } from "../src/worker/agent";

const BASE = process.env.OPENHEALTH_URL ?? "http://localhost:8787";
const argIndex = process.argv.indexOf("--apple");
const applePath = argIndex > 0 ? process.argv[argIndex + 1] : join(import.meta.dirname, "../fixtures/data/apple-health/export.xml");
const BATCH = 1000;
// Re-runs reuse the same demo athlete, so a second run shows that nothing is duplicated.
const SESSION_FILE = join(import.meta.dirname, "../.wrangler/demo-session");

let cookie = "";
const secs = (ms: number) => (ms / 1000).toFixed(1);

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  const r = await fetch(new URL(path, BASE), { ...init, headers, redirect: "manual" });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return r;
}

async function connect(provider: string): Promise<void> {
  const start = await call(`/api/connect/${provider}/start`);
  const authorize = new URL(start.headers.get("location")!, BASE);
  authorize.searchParams.set("auto", "1");
  const back = await call(authorize.pathname + authorize.search);
  const done = await call(back.headers.get("location")!);
  if (done.status !== 302) throw new Error(`connecting ${provider} failed: HTTP ${done.status}`);
  console.log(`✓ connected ${provider}`);
}

async function* fileChunks(path: string): AsyncIterable<Uint8Array> {
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) yield chunk as Uint8Array;
}

async function uploadApple(): Promise<{ ms: number; records: number; accepted: number }> {
  const open = () => (applePath.endsWith(".zip") ? unzipExport(fileChunks(applePath)) : fileChunks(applePath));
  const started = Date.now();
  let records = 0;
  let accepted = 0;
  let batch: unknown[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const r = await call("/api/connect/apple_health/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileSha256: "demo", records: batch }),
    });
    if (!r.ok) throw new Error(`Apple upload failed: HTTP ${r.status} ${await r.text()}`);
    const counts = (await r.json()) as { accepted: number; updated: number };
    accepted += counts.accepted + counts.updated;
    batch = [];
  };
  for await (const recs of parseAppleExport(open, { batchSize: BATCH })) {
    records += recs.length;
    batch.push(...recs);
    if (batch.length >= BATCH) await flush();
    process.stdout.write(`\r… Apple Health · ${records} records`);
  }
  await flush();
  process.stdout.write("\n");
  return { ms: Date.now() - started, records, accepted };
}

async function main(): Promise<void> {
  if (existsSync(SESSION_FILE)) cookie = readFileSync(SESSION_FILE, "utf8").trim();
  if (cookie && (await call("/api/me")).ok) {
    console.log("✓ athlete Alex Rivera (existing)");
  } else {
    cookie = "";
    const created = await call("/api/athletes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alex Rivera", primarySport: "crossfit", tz: "America/Los_Angeles" }),
    });
    if (created.status !== 201) throw new Error(`could not create athlete: HTTP ${created.status} (is wrangler dev running at ${BASE}?)`);
    mkdirSync(join(SESSION_FILE, ".."), { recursive: true });
    writeFileSync(SESSION_FILE, cookie);
    console.log("✓ athlete Alex Rivera");
  }

  await connect("wodup");
  await connect("mindbody");

  const apple = await uploadApple();
  console.log(`✓ Apple Health · ${apple.records} records parsed and sent in ${secs(apple.ms)} s · ${apple.accepted} new`);

  const started = await call("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const { runId } = (await started.json()) as { runId: string };
  let last = "";
  let state: SyncState;
  for (let i = 0; ; i++) {
    state = (await (await call("/api/sync/state")).json()) as SyncState;
    const line = Object.entries(state.providers)
      .map(([p, s]) => `${s!.label} (${s!.status})`)
      .concat(`matching (${state.reconcile.status})`)
      .join(" · ");
    if (line !== last) console.log(`… ${line}`);
    last = line;
    if (state.runId === runId && (state.status === "done" || state.status === "error")) break;
    if (i > 1200) throw new Error("sync did not finish within 5 minutes");
    await new Promise((r) => setTimeout(r, 250));
  }
  if (state.status === "error") throw new Error(`sync failed: ${state.error}`);

  for (const [p, s] of Object.entries(state.providers)) console.log(`✓ ${p} · ${s!.accepted ?? 0} new records · ${s!.duplicates ?? 0} unchanged`);
  const t = state.summary!.timings;
  const recsPerSec = Math.round(apple.records / (apple.ms / 1000));
  console.log(
    `\n2 years · ${state.summary!.totalRecords} records · Apple parsed in ${secs(apple.ms)} s (${recsPerSec}/s) · ` +
      `WodUp ${secs(t.wodup ?? 0)} s · Mindbody ${secs(t.mindbody ?? 0)} s · reconcile ${secs(t.reconcile)} s · total ${secs(t.total)} s`,
  );
  console.log(`${state.summary!.workouts} workouts · ${state.summary!.duplicatesRemoved} duplicates removed · ${state.summary!.needsReview} need review`);
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});

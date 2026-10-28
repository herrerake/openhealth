import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "../..");
export const DATA = join(ROOT, "fixtures/data");
export const appleXmlPath = join(DATA, "apple-health/export.xml");
const FILES = [
  "wodup/training_sessions.json",
  "wodup/athlete.json",
  "mindbody/client_visits.json",
  "hyrox/results.json",
  "apple-health/export.xml",
  "expected.json",
];

export function generate(): void {
  execFileSync("node", [join(ROOT, "fixtures/generate.mjs")], { stdio: "pipe" });
}

export function ensureGenerated(): void {
  if (!FILES.every((f) => existsSync(join(DATA, f)))) generate();
}

export function hashOutputs(): string {
  const h = createHash("sha256");
  for (const f of FILES) h.update(readFileSync(join(DATA, f)));
  return h.digest("hex");
}

export function hashGeneratedTwice(): { same: boolean } {
  generate();
  const a = hashOutputs();
  generate();
  return { same: a === hashOutputs() };
}

export const readJson = (f: string): any => JSON.parse(readFileSync(join(DATA, f), "utf8"));
export const readExpected = (): any => readJson("expected.json");
export const readSessions = (): any[] => readJson("wodup/training_sessions.json");
export const readVisits = (): any[] => readJson("mindbody/client_visits.json").Visits;
export const readHyrox = (): any => readJson("hyrox/results.json");
export const readAppleXml = (): string => readFileSync(appleXmlPath, "utf8");

export function appleWorkoutStarts(xml = readAppleXml()): string[] {
  return [...xml.matchAll(/<Workout [^>]*?startDate="([^"]+)"/g)].map((m) => m[1]);
}

export const minLocalDate = (rows: { localDate: string }[]) => rows.map((r) => r.localDate).sort()[0];
export const maxLocalDate = (rows: { localDate: string }[]) => rows.map((r) => r.localDate).sort().at(-1);

const CT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" });
export const ctDate = (utc: string) => CT.format(new Date(utc));

/** All WodUp results with their local date (wod.occurs_on, else done_at in Austin). */
export function allResults(): { date: string; result: any }[] {
  return readSessions().flatMap((s) =>
    s.results.map((r: any) => ({ date: s.wod?.occurs_on ?? ctDate(r.done_at), result: r })),
  );
}

export function allNotes(): { date: string; text: string }[] {
  return allResults()
    .filter((r) => r.result.notes)
    .map((r) => ({ date: r.date, text: r.result.notes }));
}

export const notesOn = (date: string) => allNotes().filter((n) => n.date === date).map((n) => n.text);
export const notesContaining = (word: string) =>
  allNotes().filter((n) => n.text.toLowerCase().includes(word.toLowerCase()));

/** Official HYROX finish times in date order. */
export function raceResults(): { date: string; event: string; seconds: number }[] {
  return readHyrox()
    .results.map((r: any) => {
      const [h, m, sec] = r.overall.time.split(":").map(Number);
      return { date: r.event.date, event: r.event.name, seconds: h * 3600 + m * 60 + sec };
    })
    .sort((a: any, b: any) => a.date.localeCompare(b.date));
}

/** Top deadlift 4x4 load per session, in date order. */
export function deadliftTopSets(): { date: string; lbs: number }[] {
  return allResults()
    .filter((r) => r.result.type === "StrengthResult" && r.result.movements[0]?.name === "Deadlift")
    .filter((r) => r.result.details.sets.length === 4 && r.result.details.sets.every((s: any) => s.reps === 4))
    .map((r) => ({ date: r.date, lbs: Math.max(...r.result.details.sets.map((s: any) => s.load)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function longestRunAt(series: { lbs: number }[], value: number): number {
  let best = 0;
  let run = 0;
  for (const s of series) {
    run = s.lbs === value ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** First value after the longest run at `value`. */
export function firstAfterRun(series: { lbs: number }[], value: number): number {
  let best = 0;
  let run = 0;
  let endIdx = -1;
  series.forEach((s, i) => {
    run = s.lbs === value ? run + 1 : 0;
    if (run > best) {
      best = run;
      endIdx = i;
    }
  });
  return series[endIdx + 1]?.lbs ?? Number.NaN;
}

const mondayOf = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

/** Longest run of consecutive weeks (Mon–Sun) with at least `n` canonical sessions. */
export function longestWeeksAtLeast(rows: { localDate: string }[], n: number): number {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(mondayOf(r.localDate), (counts.get(mondayOf(r.localDate)) ?? 0) + 1);
  const first = mondayOf(minLocalDate(rows)!);
  const last = mondayOf(maxLocalDate(rows)!);
  let best = 0;
  let run = 0;
  for (let d = new Date(`${first}T12:00:00Z`); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + 7)) {
    run = (counts.get(d.toISOString().slice(0, 10)) ?? 0) >= n ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Count of source records of any kind whose local date falls in [from, to]. */
export function recordsBetween(from: string, to: string): number {
  const inRange = (d: string) => d >= from && d <= to;
  const visits = readVisits().filter((v) => inRange(v.StartDateTime.slice(0, 10))).length;
  const results = allResults().filter((r) => inRange(r.date)).length;
  const races = readHyrox().results.filter((r: any) => inRange(r.event.date)).length;
  const apple = [...readAppleXml().matchAll(/ startDate="(\d{4}-\d{2}-\d{2})/g)].filter((m) => inRange(m[1])).length;
  return visits + results + races + apple;
}

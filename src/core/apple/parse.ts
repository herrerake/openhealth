import { SaxesParser } from "saxes";
import type { AppleDailyPayload, AppleWorkoutPayload, HrAggregatePayload } from "../normalize";
import { parseAppleDate } from "../time";
import type { SourceRecordInput } from "../types";
import { Sha256 } from "./sha256";

// Two-pass streaming parser for the Health app's export.xml.
// Pass 1 hashes the file and collects workout windows (workouts come after the
// heart-rate records in the file). Pass 2 emits workouts and daily metrics, and
// aggregates heart-rate samples per workout window. Raw samples never leave here.

const HEART_RATE = "HKQuantityTypeIdentifierHeartRate";
const DAILY_TYPES = new Set([
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  "HKCategoryTypeIdentifierSleepAnalysis",
]);
const GAP_MS = 5 * 60_000;
const MAX_WORKOUT_MS = 24 * 3_600_000;

const DURATION_TO_S: Record<string, number> = { s: 1, min: 60, hr: 3600 };
const DISTANCE_TO_M: Record<string, number> = { m: 1, km: 1000, mi: 1609.344, yd: 0.9144, ft: 0.3048 };
const ENERGY_TO_KCAL: Record<string, number> = { Cal: 1, kcal: 1, kJ: 1 / 4.184 };
const round1 = (n: number) => Math.round(n * 10) / 10;

type Attrs = Record<string, string>;
interface Handlers {
  open(name: string, attrs: Attrs): void;
  close(name: string): void;
}
interface Window {
  key: string;
  start: number;
  end: number;
  sum: number;
  samples: number;
  max: number;
  lastSample: number | null;
  gaps: number;
}

export interface ParseOptions {
  batchSize?: number;
  onProgress?: (p: { pass: 1 | 2; bytes: number }) => void;
}

const workoutKey = (a: Attrs) => `workout:${a.sourceName}|${a.workoutActivityType}|${a.startDate}`;
const instant = (s: string) => Date.parse(parseAppleDate(s).utc);

async function* saxPass(chunks: AsyncIterable<Uint8Array>, handlers: Handlers, onChunk: (c: Uint8Array) => void): AsyncGenerator<void> {
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (node) => handlers.open(node.name, node.attributes as Attrs));
  parser.on("closetag", (node) => handlers.close(node.name));
  const decoder = new TextDecoder();
  try {
    for await (const chunk of chunks) {
      onChunk(chunk);
      parser.write(decoder.decode(chunk, { stream: true }));
      yield;
    }
    parser.write(decoder.decode());
    parser.close();
  } catch (e) {
    throw new Error(`Apple Health export is malformed: ${(e as Error).message}`);
  }
}

function totalsOf(a: Attrs, statistics: AppleWorkoutPayload["statistics"]): AppleWorkoutPayload["totals"] {
  const totals: AppleWorkoutPayload["totals"] = {};
  if (a.duration) totals.duration_s = round1(Number(a.duration) * (DURATION_TO_S[a.durationUnit ?? "min"] ?? 60));
  const energy = statistics.HKQuantityTypeIdentifierActiveEnergyBurned;
  if (energy?.sum != null) totals.active_kcal = round1(energy.sum * (ENERGY_TO_KCAL[energy.unit ?? "Cal"] ?? 1));
  else if (a.totalEnergyBurned) totals.active_kcal = round1(Number(a.totalEnergyBurned) * (ENERGY_TO_KCAL[a.totalEnergyBurnedUnit ?? "Cal"] ?? 1));
  const distance = Object.entries(statistics).find(([type]) => type.startsWith("HKQuantityTypeIdentifierDistance"))?.[1];
  if (distance?.sum != null) totals.distance_m = round1(distance.sum * (DISTANCE_TO_M[distance.unit ?? "km"] ?? 1));
  else if (a.totalDistance) totals.distance_m = round1(Number(a.totalDistance) * (DISTANCE_TO_M[a.totalDistanceUnit ?? "km"] ?? 1));
  return totals;
}

function timing(startDate: string, endDate: string) {
  const start = parseAppleDate(startDate);
  return { startUtc: start.utc, endUtc: parseAppleDate(endDate).utc, localDate: start.localDate, tz: startDate.slice(-5) };
}

export async function* parseAppleExport(open: () => AsyncIterable<Uint8Array>, opts: ParseOptions = {}): AsyncGenerator<SourceRecordInput[]> {
  const batchSize = opts.batchSize ?? 1000;

  // Pass 1: file hash and workout windows.
  const hasher = new Sha256();
  const windows: Window[] = [];
  let bytes = 0;
  const pass1: Handlers = {
    open(name, a) {
      if (name === "Workout" && a.startDate && a.endDate) {
        windows.push({ key: workoutKey(a), start: instant(a.startDate), end: instant(a.endDate), sum: 0, samples: 0, max: 0, lastSample: null, gaps: 0 });
      }
    },
    close() {},
  };
  for await (const _ of saxPass(open(), pass1, (c) => {
    hasher.update(c);
    bytes += c.length;
    opts.onProgress?.({ pass: 1, bytes });
  }));
  const fileSha256 = hasher.hex();
  windows.sort((x, y) => x.start - y.start);
  const starts = windows.map((w) => w.start);

  // Pass 2: records, workouts, and heart-rate aggregation.
  const queue: SourceRecordInput[] = [];
  const workoutTimes = new Map<string, ReturnType<typeof timing>>();
  let current: { attrs: Attrs; metadata: Record<string, string>; statistics: AppleWorkoutPayload["statistics"] } | null = null;

  const addSample = (t: number, bpm: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= t) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    for (let i = idx; i >= 0 && t - windows[i].start <= MAX_WORKOUT_MS; i--) {
      const w = windows[i];
      if (t > w.end) continue;
      if (w.lastSample != null && t - w.lastSample > GAP_MS) w.gaps++;
      w.lastSample = t;
      w.sum += bpm;
      w.samples++;
      w.max = Math.max(w.max, bpm);
    }
  };

  const pass2: Handlers = {
    open(name, a) {
      if (name === "Record") {
        if (a.type === HEART_RATE && a.startDate) addSample(instant(a.startDate), Number(a.value));
        else if (DAILY_TYPES.has(a.type) && a.startDate && a.endDate) {
          const payload: AppleDailyPayload = {
            type: a.type,
            value: a.type.startsWith("HKCategory") ? a.value : Number(a.value),
            unit: a.unit,
            sourceName: a.sourceName,
            startDate: a.startDate,
            endDate: a.endDate,
          };
          queue.push({
            source: "apple_health",
            kind: "daily_metric",
            naturalKey: `daily:${a.type}|${a.sourceName}|${a.startDate}`,
            payload,
            ...timing(a.startDate, a.endDate),
          });
        }
      } else if (name === "Workout") {
        current = { attrs: a, metadata: {}, statistics: {} };
      } else if (current && name === "MetadataEntry") {
        current.metadata[a.key] = a.value;
      } else if (current && name === "WorkoutStatistics") {
        const num = (v?: string) => (v == null ? undefined : Number(v));
        current.statistics[a.type] = { sum: num(a.sum), average: num(a.average), minimum: num(a.minimum), maximum: num(a.maximum), unit: a.unit };
      }
    },
    close(name) {
      if (name !== "Workout" || !current) return;
      const a = current.attrs;
      const indoor = current.metadata.HKIndoorWorkout;
      const payload: AppleWorkoutPayload = {
        workoutActivityType: a.workoutActivityType,
        sourceName: a.sourceName,
        startDate: a.startDate,
        endDate: a.endDate,
        indoor: indoor === "1" ? true : indoor === "0" ? false : null,
        metadata: current.metadata,
        statistics: current.statistics,
        totals: totalsOf(a, current.statistics),
      };
      const t = timing(a.startDate, a.endDate);
      workoutTimes.set(workoutKey(a), t);
      queue.push({ source: "apple_health", kind: "workout", naturalKey: workoutKey(a), payload, ...t });
      current = null;
    },
  };

  bytes = 0;
  for await (const _ of saxPass(open(), pass2, (c) => {
    bytes += c.length;
    opts.onProgress?.({ pass: 2, bytes });
  })) {
    while (queue.length >= batchSize) yield queue.splice(0, batchSize);
  }

  for (const w of windows) {
    if (!w.samples) continue;
    const payload: HrAggregatePayload = {
      workoutKey: w.key,
      avg: round1(w.sum / w.samples),
      max: w.max,
      samples: w.samples,
      gapsOver5Min: w.gaps,
      fileSha256,
    };
    queue.push({ source: "apple_health", kind: "hr_aggregate", naturalKey: `hr:${w.key}`, payload, ...workoutTimes.get(w.key)! });
  }
  while (queue.length) yield queue.splice(0, batchSize);
}

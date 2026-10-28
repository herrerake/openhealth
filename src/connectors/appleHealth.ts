import { parseAppleDate } from "../core/time";
import type { SourceRecordInput } from "../core/types";

export const MAX_APPLE_BATCH = 5000;

const DAILY_TYPES = new Set([
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  "HKCategoryTypeIdentifierSleepAnalysis",
]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const appleDate = (v: unknown) => {
  if (typeof v !== "string") return false;
  try {
    parseAppleDate(v);
    return true;
  } catch {
    return false;
  }
};
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/**
 * Apple Health has no server API: the browser parses the export and posts batches.
 * Returns why a posted record can't be stored, or null when it is well-formed.
 */
export function appleRecordError(r: SourceRecordInput): string | null {
  if (!r || r.source !== "apple_health") return "source must be apple_health";
  if (typeof r.naturalKey !== "string" || !r.naturalKey) return "naturalKey is required";
  if (r.startUtc == null || !ISO_UTC.test(r.startUtc)) return "startUtc must be ISO-8601 UTC";
  if (r.localDate == null || !LOCAL_DATE.test(r.localDate)) return "localDate must be YYYY-MM-DD";
  const p = r.payload as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return "payload is required";
  switch (r.kind) {
    case "workout":
      if (typeof p.workoutActivityType !== "string" || typeof p.sourceName !== "string") return "workout needs activity type and source";
      if (!appleDate(p.startDate) || !appleDate(p.endDate)) return "workout needs valid start and end dates";
      if (r.endUtc == null || !ISO_UTC.test(r.endUtc)) return "endUtc must be ISO-8601 UTC";
      if (!p.totals || typeof p.totals !== "object") return "workout needs totals";
      return null;
    case "daily_metric":
      if (!DAILY_TYPES.has(String(p.type))) return "unsupported daily metric type";
      if (!appleDate(p.startDate) || !appleDate(p.endDate)) return "daily metric needs valid start and end dates";
      if (!num(p.value) && typeof p.value !== "string") return "daily metric needs a value";
      return null;
    case "hr_aggregate":
      if (typeof p.workoutKey !== "string" || !num(p.avg) || !num(p.max) || !num(p.samples)) return "hr aggregate needs workoutKey, avg, max, samples";
      return null;
    case "hr_series":
      if (typeof p.workoutKey !== "string" || !num(p.stepS) || !Array.isArray(p.points)) return "hr series needs workoutKey, stepS, points";
      if (!(p.points as unknown[]).every((x) => Array.isArray(x) && x.length === 2 && num(x[0]) && num(x[1]))) return "hr series points must be [seconds, bpm]";
      return null;
    default:
      return "unsupported kind";
  }
}

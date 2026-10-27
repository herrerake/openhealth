import type { SourceRecordInput } from "../core/types";

export const MAX_APPLE_BATCH = 5000;
const APPLE_KINDS = new Set(["workout", "daily_metric", "hr_aggregate"]);

/** Apple Health has no server API: the browser parses the export and posts batches of these records. */
export function isAppleRecord(r: SourceRecordInput): boolean {
  return r?.source === "apple_health" && APPLE_KINDS.has(r.kind) && typeof r.naturalKey === "string" && r.naturalKey.length > 0;
}

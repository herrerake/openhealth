import type { SourceBatch } from "../core/types";

/** Demo stub for providers without synthetic data: sign-in works, sync returns nothing. */
export async function* syncStub(): AsyncIterable<SourceBatch> {
  yield { records: [], progress: { label: "No data in demo", done: 0, total: 0 } };
}

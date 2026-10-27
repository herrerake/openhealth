import { describe, expect, it } from "vitest";
import type { SourceRecordInput } from "../../src/core/types";
import { authedFetch } from "./helpers";

const daily = (i: number): SourceRecordInput => ({
  source: "apple_health",
  kind: "daily_metric",
  naturalKey: `daily:HKQuantityTypeIdentifierRestingHeartRate|Watch|2026-10-${String(i).padStart(2, "0")} 00:00:00 -0700`,
  payload: { type: "HKQuantityTypeIdentifierRestingHeartRate", value: 55, startDate: "", endDate: "" },
  startUtc: `2026-10-${String(i).padStart(2, "0")}T07:00:00Z`,
  endUtc: null,
  localDate: `2026-10-${String(i).padStart(2, "0")}`,
  tz: "-0700",
});

const post = (records: SourceRecordInput[]) =>
  authedFetch("/api/connect/apple_health/batches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileSha256: "f".repeat(64), records }),
  });

describe("Apple Health batch upload", () => {
  it("is idempotent across re-uploads and marks the connection", async () => {
    const a = [1, 2, 3].map(daily);
    const b = [4, 5].map(daily);
    expect(await (await post(a)).json()).toEqual({ accepted: 3, duplicates: 0, updated: 0 });
    expect(await (await post(b)).json()).toEqual({ accepted: 2, duplicates: 0, updated: 0 });
    expect(await (await post(a)).json()).toEqual({ accepted: 0, duplicates: 3, updated: 0 });
    expect(await (await post(b)).json()).toEqual({ accepted: 0, duplicates: 2, updated: 0 });
    const list = await (await authedFetch("/api/providers")).json<any[]>();
    expect(list.find((p) => p.id === "apple_health").connection.status).toBe("connected");
  });

  it("rejects records from another source", async () => {
    const r = await post([{ ...daily(1), source: "wodup" }]);
    expect(r.status).toBe(400);
  });

  it("rejects an oversized batch", async () => {
    const r = await post(Array.from({ length: 5001 }, (_, i) => ({ ...daily(1), naturalKey: `daily:x|${i}` })));
    expect(r.status).toBe(413);
  });
});

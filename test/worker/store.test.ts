import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { SourceRecordInput } from "../../src/core/types";
import { insertSourceRecords, loadSourceRecords } from "../../src/worker/store";

const rec = (k: string, p: unknown): SourceRecordInput => ({
  source: "wodup",
  kind: "result",
  naturalKey: k,
  payload: p,
  startUtc: "2026-10-20T13:07:00Z",
  endUtc: null,
  localDate: "2026-10-20",
  tz: null,
});

describe("source record store", () => {
  it("inserts then dedupes identical records", async () => {
    expect(await insertSourceRecords(env.DB, "a1", "r1", [rec("result:r_1", { v: 1 }), rec("result:r_2", { v: 2 })])).toEqual({
      accepted: 2,
      duplicates: 0,
      updated: 0,
    });
    expect(await insertSourceRecords(env.DB, "a1", "r2", [rec("result:r_1", { v: 1 })])).toEqual({
      accepted: 0,
      duplicates: 1,
      updated: 0,
    });
  });

  it("re-sync with changed payload updates and counts updated", async () => {
    await insertSourceRecords(env.DB, "a1", "r1", [rec("result:r_9", { v: 1 })]);
    expect(await insertSourceRecords(env.DB, "a1", "r2", [rec("result:r_9", { v: 2 })])).toEqual({
      accepted: 0,
      duplicates: 0,
      updated: 1,
    });
    expect((await loadSourceRecords(env.DB, "a1")).find((r) => r.naturalKey === "result:r_9")!.payload).toEqual({ v: 2 });
  });

  it("isolates athletes", async () => {
    await insertSourceRecords(env.DB, "a2", "r1", [rec("result:r_1", { v: 1 })]);
    expect(await loadSourceRecords(env.DB, "a2")).toHaveLength(1);
  });

  it("chunks large inserts", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => rec(`result:m_${i}`, { i }));
    expect((await insertSourceRecords(env.DB, "a3", "r1", many)).accepted).toBe(1200);
    expect(await loadSourceRecords(env.DB, "a3")).toHaveLength(1200);
  });

  it("treats a record repeated within one batch as one record", async () => {
    expect(await insertSourceRecords(env.DB, "a4", "r1", [rec("result:x", { v: 1 }), rec("result:x", { v: 1 })])).toEqual({
      accepted: 1,
      duplicates: 1,
      updated: 0,
    });
  });
});

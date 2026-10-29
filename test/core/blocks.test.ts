import { beforeAll, describe, expect, it } from "vitest";
import { CLUB_HYBRID, blockWeek } from "../../src/core/blocks";
import { ensureGenerated, readExpected } from "./fixture-helpers";

let expected: any;
beforeAll(() => {
  ensureGenerated();
  expected = readExpected();
});

describe("block calendar", () => {
  it("puts every day in the fixtures' 13 Club Hybrid blocks", () => {
    for (const b of expected.blocks) {
      expect(blockWeek(CLUB_HYBRID, b.from)).toEqual({ block: b.block, week: 1, from: b.from, to: b.to });
      expect(blockWeek(CLUB_HYBRID, b.to)).toEqual({ block: b.block, week: 8, from: b.from, to: b.to });
    }
  });

  it("counts weeks Monday to Sunday from the block's start", () => {
    expect(blockWeek(CLUB_HYBRID, "2026-10-04")).toMatchObject({ block: 13, week: 5 });
    expect(blockWeek(CLUB_HYBRID, "2026-10-05")).toMatchObject({ block: 13, week: 6 });
    expect(blockWeek(CLUB_HYBRID, "2026-10-19")).toMatchObject({ block: 13, week: 8 });
  });

  it("keeps running blocks back to back after the fixtures end", () => {
    expect(blockWeek(CLUB_HYBRID, "2026-10-26")).toEqual({ block: 14, week: 1, from: "2026-10-26", to: "2026-12-20" });
  });

  it("has no block before the first one starts", () => {
    expect(blockWeek(CLUB_HYBRID, "2024-10-27")).toBeNull();
  });
});

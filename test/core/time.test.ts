import { describe, expect, it } from "vitest";
import { normalizeWodupUtc, parseAppleDate, utcToLocalDate, zonedWallToUtc } from "../../src/core/time";

const LA = "America/Los_Angeles";

describe("zonedWallToUtc", () => {
  it("converts PDT wall time", () => expect(zonedWallToUtc("2026-09-28T06:00:00", LA)).toBe("2026-09-28T13:00:00Z"));
  it("converts PST wall time", () => expect(zonedWallToUtc("2025-01-06T06:00:00", LA)).toBe("2025-01-06T14:00:00Z"));
  it("spring-forward gap shifts forward", () => expect(zonedWallToUtc("2025-03-09T02:30:00", LA)).toBe("2025-03-09T10:30:00Z"));
  it("fall-back ambiguity takes first occurrence", () =>
    expect(zonedWallToUtc("2025-11-02T01:30:00", LA)).toBe("2025-11-02T08:30:00Z"));
});

describe("utcToLocalDate", () => {
  it("local date across UTC midnight", () => expect(utcToLocalDate("2026-10-22T00:28:00Z", LA)).toBe("2026-10-21"));
});

describe("parseAppleDate", () => {
  it("parses Apple dates with offset", () =>
    expect(parseAppleDate("2026-10-21 17:28:00 -0700")).toEqual({
      utc: "2026-10-22T00:28:00Z",
      offsetMinutes: -420,
      localDate: "2026-10-21",
    }));
  it("handles positive offsets", () =>
    expect(parseAppleDate("2026-03-01 08:00:00 +0530")).toEqual({
      utc: "2026-03-01T02:30:00Z",
      offsetMinutes: 330,
      localDate: "2026-03-01",
    }));
});

describe("normalizeWodupUtc", () => {
  it("normalizes WodUp microseconds", () =>
    expect(normalizeWodupUtc("2026-10-20T13:07:00.000000Z")).toBe("2026-10-20T13:07:00Z"));
});

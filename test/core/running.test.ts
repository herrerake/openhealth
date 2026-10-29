import { describe, expect, it } from "vitest";
import { cadenceSpm, formatPace, metersPerBeat, paceSPerKm, runningForm, verticalRatioPct } from "../../src/core/running";

describe("running form", () => {
  it("converts the watch's units", () => {
    expect(
      runningForm({
        HKQuantityTypeIdentifierRunningSpeed: { average: 6.8, unit: "mi/hr" },
        HKQuantityTypeIdentifierRunningStrideLength: { average: 106, unit: "cm" },
        HKQuantityTypeIdentifierRunningGroundContactTime: { average: 0.262, unit: "s" },
        HKQuantityTypeIdentifierRunningVerticalOscillation: { average: 91, unit: "mm" },
      }),
    ).toEqual({ powerW: null, speedMps: 3.04, strideM: 1.06, groundContactMs: 262, verticalOscillationCm: 9.1 });
  });

  it("is null for a workout without running stats", () => {
    expect(runningForm({ HKQuantityTypeIdentifierActiveEnergyBurned: { sum: 263, unit: "Cal" } })).toBeNull();
    expect(runningForm(undefined)).toBeNull();
  });

  it("derives pace, meters per heartbeat and vertical ratio", () => {
    // Henry's 2026-10-25 run: 9.99 km in 55:00 at 119 bpm.
    expect(paceSPerKm(9990, 3300)).toBe(330);
    expect(formatPace(330)).toBe("5:30 /km");
    expect(metersPerBeat(9990, 3300, 119)).toBe(1.53);
    expect(verticalRatioPct(9.1, 1.06)).toBe(8.6);
  });

  it("derives cadence in steps per minute from speed and stride", () => {
    // Apple's stride length is one step, so 3.06 m/s over 1.06 m is 173 steps a minute.
    expect(cadenceSpm(3.06, 1.06)).toBe(173);
  });

  it("refuses to divide by nothing", () => {
    expect(paceSPerKm(0, 3300)).toBeNull();
    expect(metersPerBeat(9990, 3300, 0)).toBeNull();
    expect(verticalRatioPct(9.1, 0)).toBeNull();
    expect(cadenceSpm(3.06, 0)).toBeNull();
  });
});

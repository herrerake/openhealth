import type { AppleWorkoutPayload } from "./normalize";

// Running form from the watch (Apple Watch running metrics), and the economy figures derived from it.
// Every number here is computed in code; nothing is estimated by a model.

export interface RunningForm {
  powerW: number | null;
  speedMps: number | null;
  strideM: number | null;
  groundContactMs: number | null;
  verticalOscillationCm: number | null;
}

const SPEED_TO_MPS: Record<string, number> = { "km/hr": 1 / 3.6, "m/s": 1, "mi/hr": 0.44704 };
const LENGTH_TO_M: Record<string, number> = { m: 1, cm: 0.01, km: 1000, ft: 0.3048, in: 0.0254 };
const LENGTH_TO_CM: Record<string, number> = { cm: 1, m: 100, mm: 0.1, in: 2.54 };
const TIME_TO_MS: Record<string, number> = { ms: 1, s: 1000 };

export const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** The watch's workout averages, in SI-ish units. Null for a stat the watch didn't record (older watches, treadmill runs). */
export function runningForm(statistics: AppleWorkoutPayload["statistics"] | undefined): RunningForm | null {
  if (!statistics) return null;
  const avg = (type: string, factors: Record<string, number>, fallback: string, places: number) => {
    const s = statistics[`HKQuantityTypeIdentifier${type}`];
    const unit = s?.unit ?? fallback;
    // An unknown unit yields null rather than a guessed conversion.
    if (typeof s?.average !== "number" || !Number.isFinite(s.average) || !Object.hasOwn(factors, unit)) return null;
    return round(s.average * factors[unit], places);
  };
  const form: RunningForm = {
    powerW: avg("RunningPower", { W: 1 }, "W", 0),
    speedMps: avg("RunningSpeed", SPEED_TO_MPS, "km/hr", 2),
    strideM: avg("RunningStrideLength", LENGTH_TO_M, "m", 2),
    groundContactMs: avg("RunningGroundContactTime", TIME_TO_MS, "ms", 0),
    verticalOscillationCm: avg("RunningVerticalOscillation", LENGTH_TO_CM, "cm", 1),
  };
  return Object.values(form).some((v) => v != null) ? form : null;
}

/** Seconds per kilometer over the whole workout, stops included. */
export const paceSPerKm = (distanceM: number, durationS: number): number | null =>
  distanceM > 0 && durationS > 0 ? Math.round(durationS / (distanceM / 1000)) : null;

/** Meters covered per heartbeat: distance over total beats (duration × average heart rate). Higher is more economical. */
export const metersPerBeat = (distanceM: number, durationS: number, avgHr: number): number | null =>
  distanceM > 0 && durationS > 0 && avgHr > 0 ? round(distanceM / ((durationS / 60) * avgHr), 2) : null;

/** Vertical oscillation as a share of stride length, in percent (cm ÷ m is already ×100). Lower means less bounce per meter. */
export const verticalRatioPct = (verticalOscillationCm: number, strideM: number): number | null =>
  verticalOscillationCm > 0 && strideM > 0 ? round(verticalOscillationCm / strideM, 1) : null;

export function formatPace(sPerKm: number): string {
  const s = Math.round(sPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} /km`;
}

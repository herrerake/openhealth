// Training blocks on a gym's calendar (D-046, D-048). WodUp has no block or week field, so the
// calendar is a gym-level fact the app is told: the first block's Monday and the block length.
// Blocks then follow back to back, numbered from 1.

export interface BlockCalendar {
  /** The WodUp program the calendar belongs to (`wod.program.name`). */
  program: string;
  /** Monday of block 1, local date. */
  firstBlockStart: string;
  weeks: number;
}

export interface BlockWeek {
  block: number;
  /** 1 to `calendar.weeks`. */
  week: number;
  /** First and last local date of the block. */
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;
const noon = (date: string) => Date.parse(`${date}T12:00:00Z`);
const addDays = (date: string, n: number) => new Date(noon(date) + n * DAY_MS).toISOString().slice(0, 10);

/** The block and week a local date falls in; null before the first block. */
export function blockWeek(calendar: BlockCalendar, date: string): BlockWeek | null {
  const days = Math.round((noon(date) - noon(calendar.firstBlockStart)) / DAY_MS);
  if (days < 0) return null;
  const length = calendar.weeks * 7;
  const index = Math.floor(days / length);
  const from = addDays(calendar.firstBlockStart, index * length);
  return { block: index + 1, week: Math.floor((days % length) / 7) + 1, from, to: addDays(from, length - 1) };
}

/** A session the program repeats, found among the athlete's results by its result fields. */
export interface RepeatedSession {
  key: string;
  label: string;
  /** How a spoken sentence names it: "you logged 193 reps on Threshold Intervals". */
  say: string;
  match: { benchmark: string } | { movement: string; metric: string };
  unit: "lb" | "reps" | "rounds";
  /** Whether the session timeline's heart rate for this block of the class is worth showing. */
  heartRate: boolean;
}

export interface BlockProgram extends BlockCalendar {
  repeats: RepeatedSession[];
}

/**
 * Club Hybrid, Austin: the demo's calendar, 8-week blocks from 2024-10-28, and the sessions each
 * block repeats (D-046): the deadlift 4x4 and Threshold Intervals in weeks 6 and 8, the 40-min AMRAP in week 8.
 */
export const CLUB_HYBRID: BlockProgram = {
  program: "Club Hybrid",
  firstBlockStart: "2024-10-28",
  weeks: 8,
  repeats: [
    { key: "deadlift_4x4", label: "Deadlift 4x4", say: "deadlift 4x4", match: { benchmark: "deadlift_4x4" }, unit: "lb", heartRate: false },
    {
      key: "threshold_intervals",
      label: "Threshold Intervals",
      say: "Threshold Intervals",
      match: { movement: "Threshold Intervals", metric: "reps" },
      unit: "reps",
      heartRate: true,
    },
    { key: "amrap_40", label: "40-min AMRAP", say: "the 40-min AMRAP", match: { benchmark: "amrap_40" }, unit: "rounds", heartRate: true },
  ],
};

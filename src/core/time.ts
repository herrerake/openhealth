// Zone-aware time handling for the three sources:
// Mindbody gives site-local wall time with no offset, WodUp gives UTC,
// Apple Health gives local time with its offset.

const MINUTE = 60_000;
const DAY = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Wall-clock time in `tz` at instant `ms`, expressed as if it were UTC milliseconds. */
function wallMs(ms: number, tz: string): number {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

function offsetMs(ms: number, tz: string): number {
  return Math.round((wallMs(ms, tz) - ms) / MINUTE) * MINUTE;
}

export function toIsoUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Converts a site-local wall time (YYYY-MM-DDTHH:mm:ss) to UTC.
 * A time inside a spring-forward gap shifts forward by the gap; an ambiguous
 * fall-back time resolves to its first occurrence.
 */
export function zonedWallToUtc(wall: string, tz: string): string {
  const asUtc = Date.parse(`${wall}Z`);
  if (Number.isNaN(asUtc)) throw new Error(`Invalid wall time: ${wall}`);
  const before = offsetMs(asUtc - DAY, tz);
  const after = offsetMs(asUtc + DAY, tz);
  const valid = [...new Set([before, after])]
    .map((o) => asUtc - o)
    .filter((ms) => wallMs(ms, tz) === asUtc)
    .sort((a, b) => a - b);
  return toIsoUtc(valid[0] ?? asUtc - before);
}

export function utcToLocalDate(utc: string, tz: string): string {
  return new Date(wallMs(Date.parse(utc), tz)).toISOString().slice(0, 10);
}

const APPLE_DATE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/;

export function parseAppleDate(s: string): { utc: string; offsetMinutes: number; localDate: string } {
  const m = APPLE_DATE.exec(s);
  if (!m) throw new Error(`Invalid Apple Health date: ${s}`);
  const offsetMinutes = (m[3] === "-" ? -1 : 1) * (Number(m[4]) * 60 + Number(m[5]));
  const utcMs = Date.parse(`${m[1]}T${m[2]}Z`) - offsetMinutes * MINUTE;
  return { utc: toIsoUtc(utcMs), offsetMinutes, localDate: m[1] };
}

export function normalizeWodupUtc(s: string): string {
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`Invalid WodUp timestamp: ${s}`);
  return toIsoUtc(ms);
}

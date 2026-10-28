// The session timeline (D-038): heart rate across one workout with its blocks laid over it.
// Races use the official HYROX splits, track days the watch's segments, classes the WodUp
// blocks matched to boundaries that code finds in the heart rate. Every time and number here
// is computed by code; a model may only choose among `candidates` (see the worker's AI matcher).

/** whole_workout: heart rate exists but couldn't be split into blocks. none: no heart rate at all. */
export type TimelineMethod = "hyrox_splits" | "watch_segments" | "duration_match" | "ai_match" | "whole_workout" | "none";
export type BlockSource = "official" | "watch" | "estimated";

export interface PlannedBlock {
  label: string;
  /** The coach's prescription, as written in WodUp. */
  prescription: string;
  /** Expected length from the prescription, in seconds. */
  priorS: number;
}

export interface Candidate {
  id: number;
  offsetS: number;
  /** How clearly the heart rate changes here (0–1). */
  strength: number;
  kind: "dip" | "peak" | "drop" | "rise";
}

export interface TimelineBlock {
  label: string;
  prescription: string | null;
  startS: number;
  endS: number;
  source: BlockSource;
  /** Computed from the heart-rate series; null when the watch recorded nothing in the block. */
  avgHr: number | null;
  maxHr: number | null;
}

export type HrPoint = [number, number];

const round = (n: number) => Math.round(n);

// ---------- planned blocks from WodUp ----------

const isWarmUp = (r: any) => r.type === "WarmUpResult";

/** Seconds a block should take, read from its prescription. A prior, not a fact: it only guides the match. */
export function priorSeconds(result: any): number {
  const w = result.prescribed_workout ?? {};
  const text = String(w.description ?? "");
  if (isWarmUp(result)) return (Number(/(\d+)\s*min/i.exec(text)?.[1]) || 11) * 60;
  if (w.type === "Amrap" && Number(w.details?.duration)) return Number(w.details.duration) * 60;
  if (w.type === "Strength") {
    const sets = result.details?.sets?.length || Number(/(\d+)\s*sets/i.exec(text)?.[1]) || 4;
    return sets * 180 + 60;
  }
  // A written length wins: a time cap ("Time Cap: 25 minutes", "(16 TC)"), rounds of fixed minutes, an EMOM.
  const cap = /time\s*cap:?\s*(\d+)\s*min|\((\d+)\s*TC\)/i.exec(text);
  if (cap) return Number(cap[1] ?? cap[2]) * 60;
  const intervals = /(\d+)\s*x\s*(\d+)\s*min[\s\S]*?(\d+)\s*min\s*rest/i.exec(text);
  if (intervals) {
    const [n, work, rest] = intervals.slice(1).map(Number);
    return (n * work + (n - 1) * rest) * 60;
  }
  const fixedRounds = /(\d+)\s*x\s*(\d+)\s*min\b/i.exec(text) ?? /(\d+)\s*rounds?\s*-?\s*every\s*(\d+)\s*min/i.exec(text);
  if (fixedRounds) return Number(fixedRounds[1]) * Number(fixedRounds[2]) * 60;
  const emom = /(\d+)\s*min\s*emom|emom\s*-?\s*(\d+)/i.exec(text);
  if (emom) return Number(emom[1] ?? emom[2]) * 60;
  const rounds = /x\s*(\d+)\s*rounds|^x\s*(\d+)/im.exec(text) ?? /(?:\d+\s*-\s*)?(\d+)\s*rounds/i.exec(text);
  if (rounds) return Number(rounds[1] ?? rounds[2]) * 240 + 60;
  const carries = /(\d+)\s*x\s*[\d.]+\s*m\b/i.exec(text);
  if (carries) return Number(carries[1]) * 100;
  const minutes = /(\d+)\s*mins?\b/i.exec(text);
  if (minutes) return Number(minutes[1]) * 60;
  return 300;
}

/** WodUp results in session order → labeled blocks: "Warm Up", then "A. Deadlift", "B. Push Press", … */
export function plannedBlocks(orderedResults: any[]): PlannedBlock[] {
  let letter = 0;
  return orderedResults.map((r) => {
    const w = r.prescribed_workout ?? {};
    const name = w.name ?? r.movements?.[0]?.name ?? "Block";
    const label = isWarmUp(r) ? "Warm Up" : `${String.fromCharCode(65 + letter++)}. ${name}`;
    return { label, prescription: String(w.description ?? ""), priorS: priorSeconds(r) };
  });
}

// ---------- boundary candidates from heart rate ----------

/** Resamples the series onto a regular grid, carrying values across short holes and leaving long gaps as null. */
function regular(points: HrPoint[], stepS: number, totalS: number): (number | null)[] {
  const n = Math.floor(totalS / stepS) + 1;
  const out: (number | null)[] = Array(n).fill(null);
  for (const [s, bpm] of points) {
    const i = Math.round(s / stepS);
    if (i >= 0 && i < n) out[i] = bpm;
  }
  let last: number | null = null;
  let since = 0;
  for (let i = 0; i < n; i++) {
    if (out[i] != null) {
      last = out[i];
      since = 0;
    } else if (last != null && ++since * stepS <= 60) out[i] = last;
  }
  return out;
}

function smooth(xs: (number | null)[], half: number): (number | null)[] {
  return xs.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(xs.length - 1, i + half); j++) {
      if (xs[j] != null) {
        sum += xs[j]!;
        n++;
      }
    }
    return n ? sum / n : null;
  });
}

/**
 * Moments where effort visibly changes: dips (a rest or transition, where the next block tends
 * to start), peaks right before a sustained drop (where a hard block tends to end), and level
 * shifts where the two minutes after differ clearly from the two minutes before (a steady block
 * starting or stopping).
 */
export function findCandidates(points: HrPoint[], stepS: number, totalS: number): Candidate[] {
  const grid = smooth(regular(points, stepS, totalS), Math.max(1, Math.round(30 / stepS)));
  const reach = Math.max(1, Math.round(90 / stepS));
  const out: Omit<Candidate, "id">[] = [];
  for (let i = reach; i < grid.length - 1; i++) {
    const v = grid[i];
    if (v == null) continue;
    const window = grid.slice(Math.max(0, i - reach), i + reach + 1).filter((x): x is number => x != null);
    const before = grid.slice(Math.max(0, i - 2 * reach), i).filter((x): x is number => x != null);
    const after = grid.slice(i + 1, i + 2 * reach + 1).filter((x): x is number => x != null);
    if (!before.length || !after.length) continue;
    if (v <= Math.min(...window)) {
      const prominence = Math.min(Math.max(...before), Math.max(...after)) - v;
      if (prominence >= 6) out.push({ offsetS: i * stepS, strength: Math.min(1, prominence / 30), kind: "dip" });
    } else if (v >= Math.max(...window)) {
      const drop = v - Math.min(...after);
      if (drop >= 12) out.push({ offsetS: i * stepS, strength: Math.min(1, drop / 40), kind: "peak" });
    }
  }
  const span = Math.max(1, Math.round(120 / stepS));
  const meanOf = (from: number, to: number) => {
    const xs = grid.slice(Math.max(0, from), Math.min(grid.length, to)).filter((x): x is number => x != null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const shift = grid.map((_, i) => {
    const a = meanOf(i - span, i);
    const b = meanOf(i, i + span);
    return a == null || b == null ? 0 : b - a;
  });
  for (let i = span; i < shift.length - span; i++) {
    const d = shift[i];
    const near = shift.slice(i - reach, i + reach + 1);
    if (d <= -10 && d <= Math.min(...near)) out.push({ offsetS: i * stepS, strength: Math.min(1, -d / 35), kind: "drop" });
    if (d >= 10 && d >= Math.max(...near)) out.push({ offsetS: i * stepS, strength: Math.min(1, d / 35), kind: "rise" });
  }
  out.sort((a, b) => a.offsetS - b.offsetS);
  // Keep the clearer of two candidates closer than 45 s.
  const kept: Omit<Candidate, "id">[] = [];
  for (const c of out) {
    const prev = kept.at(-1);
    if (prev && c.offsetS - prev.offsetS < 45) {
      if (c.strength > prev.strength) kept[kept.length - 1] = c;
    } else kept.push(c);
  }
  return kept.map((c, id) => ({ ...c, id }));
}

// ---------- matching planned blocks to candidates ----------

/**
 * Chooses one start per block after the first (which starts with the workout), in order, among
 * the candidates. Minimizes how far each block's length strays from its prior, minus a bonus for
 * clear heart-rate changes. Returns candidate ids, one per block after the first.
 */
export function matchByDuration(planned: PlannedBlock[], candidates: Candidate[], totalS: number): number[] {
  const n = planned.length;
  if (n <= 1) return [];
  const m = candidates.length;
  if (m < n - 1) return [];
  const pos = [0, ...candidates.map((c) => c.offsetS)]; // index 0 is the workout start
  const cost = (from: number, to: number, block: number) => {
    const len = to - from;
    if (len <= 30) return Number.POSITIVE_INFINITY;
    const rel = (len - planned[block].priorS) / Math.max(120, planned[block].priorS);
    return rel * rel;
  };
  const bonus = (c: Candidate) => 0.15 * c.strength;
  // best[k][j]: cheapest way for block k to start at pos[j] (j ≥ 1 indexes candidates).
  const best: number[][] = Array.from({ length: n }, () => Array(m + 1).fill(Number.POSITIVE_INFINITY));
  const from: number[][] = Array.from({ length: n }, () => Array(m + 1).fill(-1));
  best[0][0] = 0;
  for (let k = 1; k < n; k++) {
    for (let j = 1; j <= m; j++) {
      for (let i = k === 1 ? 0 : 1; i < j; i++) {
        if (!Number.isFinite(best[k - 1][i])) continue;
        const c = best[k - 1][i] + cost(pos[i], pos[j], k - 1) - bonus(candidates[j - 1]);
        if (c < best[k][j]) {
          best[k][j] = c;
          from[k][j] = i;
        }
      }
    }
  }
  let end = -1;
  let endCost = Number.POSITIVE_INFINITY;
  for (let j = 1; j <= m; j++) {
    const c = best[n - 1][j] + cost(pos[j], totalS, n - 1);
    if (c < endCost) {
      endCost = c;
      end = j;
    }
  }
  if (end < 0) return [];
  const starts: number[] = [];
  for (let k = n - 1, j = end; k >= 1; k--) {
    starts.unshift(candidates[j - 1].id);
    j = from[k][j];
  }
  return starts;
}

/** A model's (or anyone's) choice is only accepted if it names real candidates in increasing order. */
export function validStarts(starts: unknown, planned: PlannedBlock[], candidates: Candidate[]): starts is number[] {
  if (!Array.isArray(starts) || starts.length !== planned.length - 1) return false;
  const byId = new Map(candidates.map((c) => [c.id, c.offsetS]));
  let last = 0;
  for (const id of starts) {
    const at = typeof id === "number" ? byId.get(id) : undefined;
    if (at == null || at <= last) return false;
    last = at;
  }
  return true;
}

// ---------- assembling ----------

export function hrStats(points: HrPoint[], startS: number, endS: number): { avgHr: number | null; maxHr: number | null } {
  const inside = points.filter(([s]) => s >= startS && s < endS).map(([, bpm]) => bpm);
  if (!inside.length) return { avgHr: null, maxHr: null };
  return { avgHr: round(inside.reduce((a, b) => a + b, 0) / inside.length), maxHr: Math.max(...inside) };
}

export function blocksFromStarts(
  planned: PlannedBlock[],
  startsS: number[],
  totalS: number,
  points: HrPoint[],
  source: BlockSource,
): TimelineBlock[] {
  const bounds = [0, ...startsS, totalS];
  return planned.map((p, i) => ({
    label: p.label,
    prescription: p.prescription,
    startS: bounds[i],
    endS: bounds[i + 1],
    source,
    ...hrStats(points, bounds[i], bounds[i + 1]),
  }));
}

const HYROX_STATIONS = new Set([
  "1000m SkiErg",
  "50m Sled Push",
  "50m Sled Pull",
  "80m Burpee Broad Jump",
  "1000m Row",
  "200m Farmers Carry",
  "100m Sandbag Lunges",
  "Wall Balls",
]);
const hms = (t: string) => t.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);

/**
 * Lays the official splits end to end from the wave start. The results page gives Roxzone only as
 * a total, so it is spread evenly into and out of each station: those edges are estimates, the
 * run and station lengths are official.
 */
export function raceBlocks(result: any, waveOffsetS: number, points: HrPoint[]): TimelineBlock[] {
  const splits: { split: string; time: string }[] = result.workoutSummary ?? [];
  const order = splits.filter((s) => /^Running \d$/.test(s.split) || HYROX_STATIONS.has(s.split));
  const rox = hms(splits.find((s) => s.split === "Roxzone Time")?.time ?? "0:0:0");
  const roxEach = rox / (2 * order.filter((s) => HYROX_STATIONS.has(s.split)).length || 1);
  const blocks: TimelineBlock[] = [];
  let t = waveOffsetS;
  for (const s of order) {
    const station = HYROX_STATIONS.has(s.split);
    if (station) t += roxEach;
    const len = hms(s.time);
    blocks.push({ label: s.split, prescription: null, startS: round(t), endS: round(t + len), source: "official", ...hrStats(points, t, t + len) });
    t += len + (station ? roxEach : 0);
  }
  return blocks;
}

/**
 * Names watch segments: the hard ones are the work (named from WodUp), easy ones in between are
 * recovery, an easy first one is the warm-up and an easy last one the cool-down.
 */
export function segmentBlocks(segments: { offsetS: number; seconds: number }[], points: HrPoint[], workName: string, warmUp: boolean): TimelineBlock[] {
  const stats = segments.map((s) => hrStats(points, s.offsetS, s.offsetS + s.seconds));
  const avgs = stats.map((x) => x.avgHr ?? 0).sort((a, b) => a - b);
  const median = avgs[Math.floor(avgs.length / 2)] ?? 0;
  const hard = stats.map((x, i) => (x.avgHr ?? 0) > median || (segments.length <= 2 && i === segments.length - 1));
  if (!hard.some(Boolean)) hard[hard.length - 1] = true;
  const workCount = hard.filter(Boolean).length;
  let k = 0;
  return segments.map((s, i) => {
    let label: string;
    if (hard[i]) label = workCount === 1 ? workName : `${workName} ${++k}`;
    else if (i === 0 && warmUp) label = "Warm Up";
    else if (i === segments.length - 1) label = "Cool Down";
    else label = "Recovery";
    return { label, prescription: null, startS: round(s.offsetS), endS: round(s.offsetS + s.seconds), source: "watch", ...stats[i] };
  });
}

/** One sentence a voice surface can read: built from computed numbers only (D-033). */
export function spokenSummary(blocks: TimelineBlock[], method: TimelineMethod): string {
  const scored = blocks.filter((b) => b.avgHr != null && !/^(Warm Up|Cool Down|Recovery)$/.test(b.label));
  if (!scored.length) return "No heart rate was recorded for this session.";
  const hardest = scored.reduce((a, b) => (b.avgHr! > a.avgHr! ? b : a));
  const estimate = method === "duration_match" || method === "ai_match" ? ", by estimated block times" : "";
  return `Your hardest block was ${hardest.label}, averaging ${hardest.avgHr} beats per minute${estimate}.`;
}

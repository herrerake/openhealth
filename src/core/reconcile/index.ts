import type { AppleWorkoutPayload } from "../normalize";
import type { Decision, StoredSourceRecord } from "../types";
import { scopeKey } from "./keys";

// Deterministic reconciliation of three sources into canonical sessions (SPEC §6.3).
// Each step only sees records the earlier steps left unclaimed.

const MIN = 60_000;
const DEDUPE_START_MS = 2 * MIN;
const DEDUPE_END_MS = 5 * MIN;
const VISIT_WINDOW_MS = 15 * MIN;
const WODUP_TO_APPLE_MS = 90 * MIN;
const LOGGED_LATE_MS = 6 * 60 * MIN;
const CONFLICT_TOLERANCE = 0.01;

export type SessionKind = "class" | "open_gym" | "run" | "other";
export type SessionCategory = "strength" | "metcon" | "run" | "row" | "mixed";
export type SourceRole = "anchor" | "supporting" | "duplicate";

export interface SessionOut {
  key: string;
  localDate: string;
  kind: SessionKind;
  category: SessionCategory;
  startUtc: string;
  endUtc: string;
  status: "auto_match" | "review_required" | "confirmed";
  flags: string[];
  sources: { recordId: number; role: SourceRole }[];
}

export interface ConflictOut {
  sessionKey: string;
  field: "distance_m" | "duration_s";
  values: Record<string, number>;
  chosen: string;
  resolvedBy: "rule" | "athlete";
}

export interface ReconcileResult {
  sessions: SessionOut[];
  unmatchedVisits: { recordId: number; reason: "late_cancelled" | "no_show" }[];
  duplicates: { kept: number; duplicate: number }[];
  conflicts: ConflictOut[];
}

interface Draft {
  anchor: StoredSourceRecord | null;
  apple: StoredSourceRecord[];
  wodup: StoredSourceRecord | null;
  flags: Set<string>;
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);
const iso = (n: number) => new Date(n).toISOString().replace(/\.\d{3}Z$/, "Z");
const isWatch = (r: StoredSourceRecord) => /Apple Watch$/.test((r.payload as AppleWorkoutPayload).sourceName ?? "");
const activity = (r: StoredSourceRecord) => (r.payload as AppleWorkoutPayload).workoutActivityType;
const overlapMs = (aStart: number, aEnd: number, bStart: number, bEnd: number) => Math.min(aEnd, bEnd) - Math.max(aStart, bStart);

const APPLE_CATEGORY: Record<string, SessionCategory> = {
  HKWorkoutActivityTypeRunning: "run",
  HKWorkoutActivityTypeRowing: "row",
  HKWorkoutActivityTypeFunctionalStrengthTraining: "strength",
  HKWorkoutActivityTypeTraditionalStrengthTraining: "strength",
  HKWorkoutActivityTypeHighIntensityIntervalTraining: "metcon",
  HKWorkoutActivityTypeCrossTraining: "metcon",
};

function resultCategory(result: any): SessionCategory {
  if (result.type === "StrengthResult") return "strength";
  if (result.type === "CardioResult") {
    const name = result.movements?.[0]?.name;
    return name === "Row" ? "row" : name === "Run" ? "run" : "mixed";
  }
  return "metcon";
}

const DISTANCE_TO_M: Record<string, number> = { meters: 1, km: 1000, miles: 1609.344, yards: 0.9144, feet: 0.3048 };
const DURATION_TO_S: Record<string, number> = { seconds: 1, minutes: 60 };

/** Records reconcile can't place (no payload, no times) are left out rather than failing the run. */
function usable(r: StoredSourceRecord): boolean {
  const p = r.payload as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return false;
  if (r.kind === "visit" || r.kind === "workout") return !Number.isNaN(ms(r.startUtc)) && !Number.isNaN(ms(r.endUtc)) && !!r.localDate;
  if (r.kind === "training_session") return typeof p.id === "string" && Array.isArray(p.resultIds);
  if (r.kind === "result") return typeof p.sessionId === "string";
  if (r.kind === "hr_aggregate") return typeof p.workoutKey === "string";
  return true;
}

export function reconcile(input: { records: StoredSourceRecord[]; decisions: Decision[]; siteTz: string }): ReconcileResult {
  const recs = input.records.filter(usable).sort((a, b) => a.id - b.id);
  const visits = recs.filter((r) => r.source === "mindbody" && r.kind === "visit");
  const wodupSessions = recs.filter((r) => r.source === "wodup" && r.kind === "training_session");
  const workouts = recs
    .filter((r) => r.source === "apple_health" && r.kind === "workout")
    .sort((a, b) => ms(a.startUtc) - ms(b.startUtc) || a.id - b.id);

  const resultsBySession = new Map<string, StoredSourceRecord[]>();
  for (const r of recs) {
    if (r.source !== "wodup" || r.kind !== "result") continue;
    const sid = (r.payload as any).sessionId;
    resultsBySession.set(sid, [...(resultsBySession.get(sid) ?? []), r]);
  }
  const hrByWorkout = new Map<string, StoredSourceRecord>();
  for (const r of recs) if (r.kind === "hr_aggregate") hrByWorkout.set((r.payload as any).workoutKey, r);

  // 1. Apple dedupe: same activity, near-identical window, different source. The Watch wins.
  const duplicates: ReconcileResult["duplicates"] = [];
  const duplicateOf = new Map<number, number>();
  for (let i = 0; i < workouts.length; i++) {
    const a = workouts[i];
    if (duplicateOf.has(a.id)) continue;
    for (let j = i + 1; j < workouts.length && ms(workouts[j].startUtc) - ms(a.startUtc) <= DEDUPE_START_MS; j++) {
      const b = workouts[j];
      if (duplicateOf.has(b.id) || activity(a) !== activity(b)) continue;
      if ((a.payload as any).sourceName === (b.payload as any).sourceName) continue;
      if (Math.abs(ms(a.endUtc) - ms(b.endUtc)) > DEDUPE_END_MS) continue;
      const [kept, dup] = isWatch(b) && !isWatch(a) ? [b, a] : [a, b];
      duplicateOf.set(dup.id, kept.id);
      duplicates.push({ kept: kept.id, duplicate: dup.id });
      if (dup === a) break;
    }
  }
  const primaryWorkouts = workouts.filter((w) => !duplicateOf.has(w.id));

  // 2. Anchor on Mindbody check-ins. Late cancels and no-shows create no session.
  const unmatchedVisits: ReconcileResult["unmatchedVisits"] = [];
  const drafts: Draft[] = [];
  for (const v of visits) {
    const p = v.payload as any;
    if (p.LateCancelled) unmatchedVisits.push({ recordId: v.id, reason: "late_cancelled" });
    else if (!p.SignedIn) unmatchedVisits.push({ recordId: v.id, reason: "no_show" });
    else drafts.push({ anchor: v, apple: [], wodup: null, flags: new Set() });
  }

  // 3. Attach Apple workouts that overlap a class window (±15 min) to the class they overlap most.
  const claimed = new Set<number>();
  for (const w of primaryWorkouts) {
    let best: Draft | null = null;
    let bestOverlap = 0;
    for (const d of drafts) {
      const o = overlapMs(ms(w.startUtc), ms(w.endUtc), ms(d.anchor!.startUtc) - VISIT_WINDOW_MS, ms(d.anchor!.endUtc) + VISIT_WINDOW_MS);
      if (o > bestOverlap) {
        best = d;
        bestOverlap = o;
      }
    }
    if (best) {
      best.apple.push(w);
      claimed.add(w.id);
    }
  }

  // 4. Attach WodUp sessions to the class on the WOD's day (the one that ended nearest the log when
  //    there are several). Otherwise, and for logs without a WOD, attach to the unclaimed Apple
  //    workout that ended within 90 min of the log, on any date (a workout can cross midnight).
  const anchorsByDate = new Map<string, Draft[]>();
  for (const d of drafts) anchorsByDate.set(d.anchor!.localDate!, [...(anchorsByDate.get(d.anchor!.localDate!) ?? []), d]);
  const draftEnd = (d: Draft) => Math.max(ms(d.anchor!.endUtc), ...d.apple.map((w) => ms(w.endUtc)));
  for (const s of wodupSessions) {
    const occursOn = (s.payload as any).wod?.occurs_on as string | undefined;
    const done = ms(s.startUtc);
    const open = occursOn ? (anchorsByDate.get(occursOn) ?? []).filter((d) => !d.wodup) : [];
    const anchor = open.sort((a, b) => Math.abs(done - draftEnd(a)) - Math.abs(done - draftEnd(b)) || a.anchor!.id - b.anchor!.id)[0];
    if (anchor) {
      anchor.wodup = s;
      if (done - ms(anchor.anchor!.endUtc) > LOGGED_LATE_MS) anchor.flags.add("logged_hours_later");
      continue;
    }
    const near = primaryWorkouts
      .filter((w) => !claimed.has(w.id) && Math.abs(done - ms(w.endUtc)) <= WODUP_TO_APPLE_MS)
      .sort((a, b) => Math.abs(done - ms(a.endUtc)) - Math.abs(done - ms(b.endUtc)) || a.id - b.id)[0];
    if (near) claimed.add(near.id);
    drafts.push({ anchor: null, apple: near ? [near] : [], wodup: s, flags: new Set() });
  }

  // 5. Leftover Apple workouts become their own sessions.
  for (const w of primaryWorkouts) if (!claimed.has(w.id)) drafts.push({ anchor: null, apple: [w], wodup: null, flags: new Set() });

  // Build sessions, then apply the athlete's decisions.
  const decisions = new Map(input.decisions.map((d) => [d.scopeKey, d]));
  const sessions: SessionOut[] = [];
  const conflicts: ConflictOut[] = [];
  for (const draft of drafts) {
    const key = draftKey(draft);
    const decision = decisions.get(key);
    if (decision?.action === "split" && draft.apple.length > 1) {
      const [first, ...rest] = [...draft.apple].sort((a, b) => ms(a.startUtc) - ms(b.startUtc));
      const main = buildSession({ ...draft, apple: [first] }, resultsBySession, hrByWorkout, duplicateOf, workouts, conflicts);
      sessions.push({ ...main, status: "confirmed" });
      for (const w of rest) {
        const s = buildSession({ anchor: null, apple: [w], wodup: null, flags: new Set() }, resultsBySession, hrByWorkout, duplicateOf, workouts, conflicts);
        sessions.push({ ...s, status: "confirmed" });
      }
      continue;
    }
    const session = buildSession(draft, resultsBySession, hrByWorkout, duplicateOf, workouts, conflicts);
    if (decision && decision.action !== "pick") session.status = "confirmed";
    if (decision?.action === "pick") {
      const c = conflicts.find((x) => x.sessionKey === key && x.field === decision.payload.field);
      if (c && typeof decision.payload.source === "string" && decision.payload.source in c.values) {
        c.chosen = decision.payload.source;
        c.resolvedBy = "athlete";
      }
    }
    sessions.push(session);
  }

  sessions.sort((a, b) => a.startUtc.localeCompare(b.startUtc) || a.key.localeCompare(b.key));
  conflicts.sort((a, b) => a.sessionKey.localeCompare(b.sessionKey) || a.field.localeCompare(b.field));
  return { sessions, unmatchedVisits, duplicates: duplicates.sort((a, b) => a.kept - b.kept), conflicts };
}

function draftKey(d: Draft): string {
  return scopeKey([...(d.anchor ? [d.anchor.naturalKey] : []), ...d.apple.map((w) => w.naturalKey), ...(d.wodup ? [d.wodup.naturalKey] : [])]);
}

function buildSession(
  d: Draft,
  resultsBySession: Map<string, StoredSourceRecord[]>,
  hrByWorkout: Map<string, StoredSourceRecord>,
  duplicateOf: Map<number, number>,
  workouts: StoredSourceRecord[],
  conflicts: ConflictOut[],
): SessionOut {
  const key = draftKey(d);
  const results = d.wodup ? (resultsBySession.get((d.wodup.payload as any).id) ?? []) : [];
  const flags = new Set(d.flags);

  const sources: SessionOut["sources"] = [];
  if (d.anchor) sources.push({ recordId: d.anchor.id, role: "anchor" });
  for (const w of d.apple) {
    sources.push({ recordId: w.id, role: "supporting" });
    const hr = hrByWorkout.get(w.naturalKey);
    if (hr) sources.push({ recordId: hr.id, role: "supporting" });
    for (const other of workouts) if (duplicateOf.get(other.id) === w.id) sources.push({ recordId: other.id, role: "duplicate" });
  }
  if (d.wodup) sources.push({ recordId: d.wodup.id, role: "supporting" });
  for (const r of results) sources.push({ recordId: r.id, role: "supporting" });
  sources.sort((a, b) => a.recordId - b.recordId);

  const starts = [d.anchor, ...d.apple].filter(Boolean).map((r) => ms(r!.startUtc));
  const ends = [d.anchor, ...d.apple].filter(Boolean).map((r) => ms(r!.endUtc));
  const startUtc = starts.length ? iso(Math.min(...starts)) : (d.wodup?.startUtc ?? "");
  const endUtc = ends.length ? iso(Math.max(...ends)) : (d.wodup?.endUtc ?? startUtc);
  const localDate = d.anchor?.localDate ?? d.apple[0]?.localDate ?? d.wodup?.localDate ?? "";

  const running = d.apple.some((w) => activity(w) === "HKWorkoutActivityTypeRunning");
  const kind: SessionKind = d.anchor
    ? "class"
    : running
      ? "run"
      : d.wodup && !(d.wodup.payload as any).wod
        ? "open_gym"
        : "other";

  let status: SessionOut["status"] = "auto_match";
  if (d.anchor && d.apple.length > 1) {
    status = "review_required";
    flags.add("ambiguous_split_apple_workout");
  }
  if (d.anchor && d.wodup && d.apple.length === 0) flags.add("missing_apple_workout");
  if (kind === "open_gym") flags.add("no_booking");
  if (startUtc && startUtc.slice(0, 10) !== localDate) flags.add("utc_date_differs_from_local");

  const ordered = d.wodup ? ((d.wodup.payload as any).resultIds as string[]) : [];
  const primary = results.find((r) => (r.payload as any).id === ordered[0]) ?? results[0];
  const category: SessionCategory = primary
    ? resultCategory(primary.payload)
    : (APPLE_CATEGORY[d.apple[0] ? activity(d.apple[0]) : ""] ?? "mixed");

  // Conflicts: a self-logged single cardio result against the device's measurement. Never averaged.
  if (!d.anchor && d.apple.length === 1 && results.length === 1 && (results[0].payload as any).type === "CardioResult") {
    const set = (results[0].payload as any).details?.sets?.[0] ?? {};
    const totals = (d.apple[0].payload as AppleWorkoutPayload).totals ?? {};
    const logged: Record<ConflictOut["field"], number | undefined> = {
      distance_m: typeof set.distance === "number" ? set.distance * (DISTANCE_TO_M[set.distance_unit ?? "meters"] ?? 1) : undefined,
      duration_s: typeof set.duration === "number" ? set.duration * (DURATION_TO_S[set.duration_unit ?? "seconds"] ?? 1) : undefined,
    };
    for (const field of ["distance_m", "duration_s"] as const) {
      const a = logged[field];
      const b = totals[field];
      if (a == null || b == null || Math.abs(a - b) <= CONFLICT_TOLERANCE * Math.max(a, b)) continue;
      conflicts.push({ sessionKey: key, field, values: { wodup: a, apple_health: b }, chosen: "apple_health", resolvedBy: "rule" });
    }
  }

  return { key, localDate, kind, category, startUtc, endUtc, status, flags: [...flags].sort(), sources };
}

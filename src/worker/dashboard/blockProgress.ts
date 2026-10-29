import { type BlockProgram, type RepeatedSession, CLUB_HYBRID, blockWeek } from "../../core/blocks";
import { formatLoad, formatRounds } from "../../core/format";
import { sessionTimeline } from "../timeline/build";
import type { TileEnvelope } from "./spec";
import { type TileContext, emptyTile } from "./tiles";

// Progress through the gym's training blocks (D-048): where the athlete is on the block calendar,
// the sessions the block repeats compared with each other (week 6 against week 8), and the same
// week's session block over block. The calendar is the gym's, not WodUp's; results are placed in
// a block and week by their class date.

/** The gym programs the app knows a block calendar for (D-048). */
const PROGRAMS: BlockProgram[] = [CLUB_HYBRID];

export interface BlockEntry {
  block: number;
  week: number;
  date: string;
  value: number;
  display: string;
  sessionKey: string;
  /** Average heart rate over this block of the class, from the session timeline; null when unknown or not shown. */
  avgHr: number | null;
  /** How the timeline found the block's edges (`duration_match`, `ai_match`, …). */
  hrMethod: string | null;
}

interface Row {
  source_record_id: number;
  benchmark: string | null;
  movement: string;
  metric: string;
  value: number;
  local_date: string;
  session_key: string;
}

const format = (s: RepeatedSession, v: number) => (s.unit === "lb" ? formatLoad(v) : s.unit === "rounds" ? formatRounds(v) : `${v} reps`);
const round1 = (n: number) => Math.round(n * 10) / 10;
const signed = (s: RepeatedSession, d: number) => {
  const r = round1(d);
  return r === 0 ? "level" : `${r > 0 ? "+" : "−"}${format(s, Math.abs(r))}`;
};
const matches = (s: RepeatedSession, r: Row) =>
  "benchmark" in s.match ? r.benchmark === s.match.benchmark : r.movement === s.match.movement && r.metric === s.match.metric;

/** Results from the program's classes up to the day, oldest first. */
async function programResults(ctx: TileContext, program: BlockProgram): Promise<Row[]> {
  const { results } = await ctx.db
    .prepare(
      `SELECT r.source_record_id, r.benchmark, r.movement, r.metric, r.value, r.local_date, s.session_key
       FROM results r JOIN sessions s ON s.id = r.session_id
       WHERE r.athlete_id = ? AND r.generation = ? AND r.local_date BETWEEN ? AND ?
         AND EXISTS (SELECT 1 FROM session_sources ss JOIN source_records sr ON sr.id = ss.source_record_id
                     WHERE ss.session_id = s.id AND sr.kind = 'training_session' AND json_extract(sr.payload, '$.wod.program.name') = ?)
       ORDER BY r.local_date, r.source_record_id`,
    )
    .bind(ctx.athleteId, ctx.generation, program.firstBlockStart, ctx.asOf, program.program)
    .all<Row>();
  return results;
}

/** Heart rate over the matching block of the class (its label is "A. Threshold Intervals"), from the session timeline. */
async function blockHeartRate(ctx: TileContext, sessionKey: string, movement: string): Promise<{ avgHr: number | null; hrMethod: string | null }> {
  const timeline = await sessionTimeline(ctx.env, ctx.athleteId, ctx.generation, sessionKey, { callModel: false });
  const block = timeline?.blocks.find((b) => b.label.replace(/^[A-Z]\. /, "") === movement);
  return { avgHr: block?.avgHr ?? null, hrMethod: block?.avgHr != null ? timeline!.method : null };
}

function description(program: BlockProgram): string {
  const names = program.repeats.map((s) => s.label).join(", ");
  return (
    `${program.program} runs in ${program.weeks}-week blocks from ${program.firstBlockStart}, on the gym's calendar (WodUp doesn't record blocks). ` +
    `Each of your ${program.program} results is placed in its block and week by its class date. The repeated sessions are ${names}, ` +
    "found by name and scoring in your WodUp results. A session's weeks are the weeks it landed in during at least two blocks. " +
    "Heart rate is the average over that part of the class on its session timeline, where the part's start and end are estimated from your heart rate."
  );
}

export async function blockProgress(ctx: TileContext): Promise<TileEnvelope> {
  // The first program the athlete has repeated sessions in, on its own calendar.
  let program: BlockProgram | undefined;
  let tracked: Row[] = [];
  for (const p of PROGRAMS) {
    if (!blockWeek(p, ctx.asOf)) continue;
    tracked = (await programResults(ctx, p)).filter((r) => p.repeats.some((s) => matches(s, r)));
    if (tracked.length) {
      program = p;
      break;
    }
  }
  if (!program) return emptyTile("block_progress", description(PROGRAMS[0]));
  const desc = description(program);
  const now = blockWeek(program, ctx.asOf)!;

  const sessions = await Promise.all(
    program.repeats.map(async (s) => {
      // One entry per block and week; a second result in the same week replaces the first.
      const byWeek = new Map<string, BlockEntry>();
      for (const r of tracked.filter((x) => matches(s, x))) {
        const at = blockWeek(program, r.local_date)!;
        byWeek.set(`${at.block}:${at.week}`, {
          block: at.block,
          week: at.week,
          date: r.local_date,
          value: r.value,
          display: format(s, r.value),
          sessionKey: r.session_key,
          avgHr: null,
          hrMethod: null,
        });
      }
      const entries = [...byWeek.values()];
      const blocksIn = (week: number) => new Set(entries.filter((e) => e.week === week).map((e) => e.block)).size;
      const allWeeks = [...new Set(entries.map((e) => e.week))].sort((a, b) => a - b);
      const multiBlock = allWeeks.filter((w) => blocksIn(w) >= 2);
      const weeks = multiBlock.length ? multiBlock : allWeeks;
      const inTemplate = entries.filter((e) => weeks.includes(e.week));

      const thisBlock = await Promise.all(
        weeks.map(async (week) => {
          const e = inTemplate.find((x) => x.block === now.block && x.week === week);
          if (!e) return { week, entry: null };
          const movement = tracked.find((r) => r.session_key === e.sessionKey && matches(s, r))!.movement;
          return { week, entry: s.heartRate ? { ...e, ...(await blockHeartRate(ctx, e.sessionKey, movement)) } : e };
        }),
      );
      const done = thisBlock.flatMap((x) => (x.entry ? [x.entry] : []));
      const inBlockChange = done.length >= 2 ? round1(done.at(-1)!.value - done[0].value) : null;

      // Block over block: every block with the session, each with its weeks. The headline comparison is
      // the session's last week in the template (week 8 for all three at Club Hybrid).
      const blocks = [...new Set(inTemplate.map((e) => e.block))]
        .sort((a, b) => a - b)
        .map((block) => ({
          block,
          from: blockWeek(program, inTemplate.find((e) => e.block === block)!.date)!.from,
          entries: weeks.flatMap((week) => {
            const e = inTemplate.find((x) => x.block === block && x.week === week);
            return e ? [{ week, date: e.date, value: e.value, display: e.display, sessionKey: e.sessionKey }] : [];
          }),
        }));
      const compareWeek = weeks.at(-1)!;
      const series = inTemplate.filter((e) => e.week === compareWeek).sort((a, b) => a.block - b.block);
      const first = series[0];
      const latest = series.at(-1);
      return {
        key: s.key,
        label: s.label,
        unit: s.unit,
        weeks,
        thisBlock,
        inBlockChange,
        inBlockChangeDisplay: inBlockChange == null ? null : signed(s, inBlockChange),
        compareWeek,
        blocks,
        sinceFirst:
          first && latest && latest.block !== first.block
            ? { fromBlock: first.block, toBlock: latest.block, change: round1(latest.value - first.value), display: signed(s, latest.value - first.value) }
            : null,
        def: s,
        entries: inTemplate,
      };
    }),
  );

  // The spoken line leads with the newest repeated session this block, against its earlier week in the
  // block, or else the same week of the last block that has it.
  const newest = sessions
    .flatMap((x) => x.thisBlock.flatMap((w) => (w.entry ? [{ s: x, e: w.entry }] : [])))
    .sort((a, b) => a.e.date.localeCompare(b.e.date))
    .at(-1);
  const where = `week ${now.week} of ${program.weeks}, block ${now.block}`;
  let spoken = `You're in ${where}; no repeated sessions logged yet this block.`;
  if (newest) {
    const { s, e } = newest;
    const earlier = s.thisBlock.map((w) => w.entry).filter((x): x is BlockEntry => !!x && x.week < e.week).at(-1);
    const lastBlock = s.entries.filter((x) => x.week === e.week && x.block < e.block).sort((a, b) => a.block - b.block).at(-1);
    const against = earlier ? `, against ${earlier.display} in week ${earlier.week}` : lastBlock ? `, against ${lastBlock.display} in block ${lastBlock.block}` : "";
    spoken = `In ${where}, you logged ${e.display} on ${s.def.say}${against}.`;
  }

  return {
    type: "block_progress",
    value: {
      program: program.program,
      weeks: program.weeks,
      block: now.block,
      week: now.week,
      from: now.from,
      to: now.to,
      sessions: sessions.map(({ def, entries, ...rest }) => rest),
    },
    display: `Week ${now.week} of ${program.weeks}, Block ${now.block}`,
    context: `${program.program} · block ${now.block} runs ${now.from} to ${now.to}`,
    spoken,
    calc: { description: desc, inputs: { sourceRecordIds: tracked.map((r) => r.source_record_id) }, computedAt: new Date().toISOString() },
  };
}

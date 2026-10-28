import Anthropic from "@anthropic-ai/sdk";
import { type Candidate, type PlannedBlock, validStarts } from "../../core/timeline";

// Asks Claude which code-found boundary starts each WodUp block (D-038). The model never sees
// or returns a time it could invent: it picks candidate ids, and code checks the answer and
// computes every number shown. Any failure falls back to the duration match. Answers are cached
// in R2 per workout so a session's timeline costs one call, ever.

const MODEL = "claude-opus-5-5";

const SYSTEM = `You match the blocks of a coached fitness class to moments in the athlete's heart rate.
You get the blocks in order, each with the coach's prescription and its expected length, and a numbered list of candidate boundaries that code found in the heart rate (dips where a rest or transition happens, peaks before a drop, sharp rises or drops).
Choose, for every block after the first, the candidate where that block starts. The first block starts when the workout starts.
Use the prescriptions: strength sets show as repeated short rises with rests, AMRAPs as a long steady high stretch, intervals as regular work-and-rest cycles, cool-downs as a falling stretch at the end.
Return candidate ids in increasing time order. Only use ids from the list.`;

const SCHEMA = {
  type: "object",
  properties: {
    starts: { type: "array", items: { type: "integer" }, description: "Candidate id where each block after the first starts, in order" },
  },
  required: ["starts"],
  additionalProperties: false,
} as const;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function matchPrompt(planned: PlannedBlock[], candidates: Candidate[], totalS: number): string {
  const blocks = planned.map((b, i) => `${i + 1}. ${b.label} (expected about ${Math.round(b.priorS / 60)} min)\n   ${b.prescription.replace(/\n+/g, " / ")}`).join("\n");
  const cands = candidates.map((c) => `id ${c.id}: ${mmss(c.offsetS)} from start, ${c.kind}, strength ${c.strength.toFixed(2)}`).join("\n");
  return `Workout length: ${mmss(totalS)}.\n\nBlocks:\n${blocks}\n\nCandidate boundaries:\n${cands}\n\nReturn ${planned.length - 1} ids.`;
}

/** Claude's choice of block starts, or null when there's no key, the call fails, or the answer doesn't check out. */
export async function aiMatch(
  env: { ANTHROPIC_API_KEY?: string; RAW: R2Bucket },
  cacheKey: string,
  planned: PlannedBlock[],
  candidates: Candidate[],
  totalS: number,
): Promise<number[] | null> {
  if (!env.ANTHROPIC_API_KEY || planned.length < 2) return null;
  const key = `timeline/ai/${cacheKey}`;
  const cached = await env.RAW.get(key);
  if (cached) {
    const starts = (await cached.json<{ starts: unknown }>()).starts;
    return validStarts(starts, planned, candidates) ? starts : null;
  }
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: matchPrompt(planned, candidates, totalS) }],
    });
    if (response.stop_reason !== "end_turn") return null;
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return null;
    const starts = (JSON.parse(text.text) as { starts?: unknown }).starts;
    if (!validStarts(starts, planned, candidates)) return null;
    await env.RAW.put(key, JSON.stringify({ starts, model: response.model }));
    return starts;
  } catch {
    return null;
  }
}

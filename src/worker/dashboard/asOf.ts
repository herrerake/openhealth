import { utcToLocalDate } from "../../core/time";
import type { Env } from "../env";
import { currentGeneration } from "../reconcileStore";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day dashboards are computed "as of" (D-030): an explicit ?asOf wins; in demo mode it's the
 * athlete's latest synced day (the synthetic history has an end); otherwise today in their time zone.
 */
export async function resolveAsOf(
  env: Pick<Env, "PROVIDER_MODE">,
  db: D1Database,
  athleteId: string,
  explicit?: string,
  now: Date = new Date(),
): Promise<{ asOf: string; tz: string }> {
  const athlete = await db.prepare("SELECT tz FROM athletes WHERE id = ?").bind(athleteId).first<{ tz: string }>();
  const tz = athlete?.tz ?? "UTC";
  if (explicit && DATE.test(explicit)) return { asOf: explicit, tz };
  if (env.PROVIDER_MODE === "demo") {
    const latest = await db
      .prepare("SELECT max(local_date) AS d FROM sessions WHERE athlete_id = ? AND generation = ?")
      .bind(athleteId, await currentGeneration(db, athleteId))
      .first<{ d: string | null }>();
    if (latest?.d) return { asOf: latest.d, tz };
  }
  return { asOf: utcToLocalDate(now.toISOString(), tz), tz };
}

import type { AthleteAgent } from "./agent";

export interface Env {
  DB: D1Database;
  RAW: R2Bucket;
  AthleteAgent: DurableObjectNamespace<AthleteAgent>;
  SITE_TZ: string;
  PROVIDER_MODE: "demo" | "live";
  SESSION_SECRET: string;
}

export type AppEnv = { Bindings: Env; Variables: { athleteId: string } };

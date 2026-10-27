import type { ProviderId, SourceBatch } from "../core/types";

export interface ScopeDescription {
  label: string;
}

export interface Credentials {
  token: string;
  /** The athlete's id at the provider: WodUp athlete id, Mindbody ClientId. */
  externalId: string;
}

export interface SyncContext {
  athleteId: string;
  credentials: Credentials;
  siteTz: string;
  fetch: typeof fetch;
  baseUrl: string;
}

export interface Connector {
  id: ProviderId;
  kind: "oauth" | "file";
  displayName: string;
  category: "wearables" | "gym" | "races";
  scopes: ScopeDescription[];
  status: "available" | "coming_soon";
  sync?(ctx: SyncContext): AsyncIterable<SourceBatch>;
}

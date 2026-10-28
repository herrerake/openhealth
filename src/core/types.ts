export type ProviderId =
  | "wodup"
  | "mindbody"
  | "apple_health"
  | "garmin"
  | "oura"
  | "whoop"
  | "hyrox"
  | "race_results";

export type SourceKind =
  | "visit"
  | "training_session"
  | "result"
  | "workout"
  | "daily_metric"
  | "hr_aggregate"
  | "hr_series"
  | "race_result";

export interface SourceRecordInput {
  source: ProviderId;
  kind: SourceKind;
  naturalKey: string;
  payload: unknown;
  startUtc: string | null;
  endUtc: string | null;
  localDate: string | null;
  tz: string | null;
}

export interface StoredSourceRecord extends SourceRecordInput {
  id: number;
}

export interface SourceBatch {
  records: SourceRecordInput[];
  progress: { label: string; done: number; total?: number };
}

export interface Decision {
  scopeKey: string;
  action: "merge" | "split" | "pick" | "confirm";
  payload: Record<string, unknown>;
}

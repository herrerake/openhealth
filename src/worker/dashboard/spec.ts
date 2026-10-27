export type TileType =
  | "week_sessions"
  | "streak"
  | "rhr_3d"
  | "hrv_3d"
  | "record_book"
  | "review_queue"
  | "heatmap_52w"
  | "recent_sessions"
  | "training_mix"
  | "stories_placeholder";

export interface TileEnvelope<V = unknown> {
  type: TileType;
  value: V | null;
  display: string;
  context: string;
  series?: unknown;
  calc: { description: string; inputs: { sourceRecordIds?: number[]; query?: string }; computedAt: string };
}

export interface DashboardSpec {
  id: "home";
  title: string;
  layout: "home";
  tiles: { type: TileType; size: "s" | "m" | "l" }[];
}

/** The first dashboard. Chat-built dashboards (v1) emit this same shape. */
export const HOME_SPEC: DashboardSpec = {
  id: "home",
  title: "Home",
  layout: "home",
  tiles: [
    { type: "week_sessions", size: "s" },
    { type: "streak", size: "s" },
    { type: "rhr_3d", size: "s" },
    { type: "hrv_3d", size: "s" },
    { type: "record_book", size: "l" },
    { type: "review_queue", size: "m" },
    { type: "heatmap_52w", size: "l" },
    { type: "recent_sessions", size: "l" },
    { type: "training_mix", size: "m" },
    { type: "stories_placeholder", size: "m" },
  ],
};

export const isTileType = (t: string): t is TileType => HOME_SPEC.tiles.some((x) => x.type === t);

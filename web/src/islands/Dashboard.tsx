import { InfoIcon, MicIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getDashboard, getMe, getProviders, isConnected, type Me, onUnauthorized, type Provider } from "@/lib/api";
import { formatLoad, formatSleep, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import Band from "./charts/Band";
import Heatmap, { type HeatDay } from "./charts/Heatmap";
import MixBar from "./charts/MixBar";
import Sparkline from "./charts/Sparkline";
import ReviewSheet, { type ReviewItem } from "./ReviewSheet";

interface Envelope {
  type: string;
  value: any;
  display: string;
  context: string;
  series?: any;
  calc: { description: string; inputs: { sourceRecordIds?: number[]; query?: string } };
}
interface DashboardData {
  asOf: string;
  spec: { tiles: { type: string; size: string }[] };
  tiles: Record<string, Envelope>;
}

const TITLES: Record<string, string> = {
  week_sessions: "This week",
  streak: "Consistency streak",
  rhr_3d: "Resting HR · 3-day",
  hrv_3d: "HRV · 3-day",
  record_book: "Record book",
  review_queue: "Needs your review",
  heatmap_52w: "Last 52 weeks",
  recent_sessions: "Recent sessions",
  training_mix: "Training mix · 8 weeks",
  stories_placeholder: "Stories",
};

// Desktop follows the spec order on a 4-column grid; phones reorder to ask → week → review → records → recent.
const LAYOUT: Record<string, string> = {
  week_sessions: "order-1",
  review_queue: "order-2 lg:col-span-1",
  record_book: "order-3 sm:col-span-2 lg:col-span-3",
  recent_sessions: "order-4 sm:col-span-2",
  streak: "order-5",
  rhr_3d: "order-6",
  hrv_3d: "order-7",
  heatmap_52w: "order-8 sm:col-span-2 lg:col-span-4",
  training_mix: "order-9",
  stories_placeholder: "order-10",
};

const SOURCE_SHORT: Record<string, string> = { mindbody: "MB", wodup: "WU", apple_health: "⌚" };

function greeting(name: string): string {
  const h = new Date().getHours();
  return `Good ${h < 12 ? "morning" : h < 18 ? "afternoon" : "evening"}, ${name.split(" ")[0]}.`;
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "not synced yet";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "synced just now";
  if (min < 60) return `synced ${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `synced ${h} h ago` : `synced ${Math.round(h / 24)} days ago`;
}

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function Tile({ t, children, className }: { t: Envelope; children: ReactNode; className?: string }) {
  const n = t.calc.inputs.sourceRecordIds?.length;
  return (
    <Card data-testid={`tile-${t.type}`} data-tile={t.type} className={cn("min-w-0 gap-2", LAYOUT[t.type], className)}>
      <CardHeader>
        <CardTitle>{TITLES[t.type] ?? t.type}</CardTitle>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="-mt-2 -mr-2 size-7 text-muted-foreground" aria-label="How this was calculated">
              <InfoIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end">
            <p className="font-medium">How this was calculated</p>
            <p className="mt-1 text-muted-foreground">{t.calc.description}</p>
            {n ? <p className="mt-2 text-xs text-muted-foreground">Based on {n} source records.</p> : null}
          </PopoverContent>
        </Popover>
      </CardHeader>
      <CardContent className="grid gap-1">
        {t.value == null ? (
          <p className="text-sm text-muted-foreground">
            No data yet ·{" "}
            <a className="underline" href="/onboarding/connect">
              connect a source
            </a>
          </p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

const Big = ({ children }: { children: ReactNode }) => <div className="text-2xl font-semibold tracking-tight">{children}</div>;
const Context = ({ children }: { children: ReactNode }) => <div className="text-xs text-muted-foreground">{children}</div>;

function TileBody({ t, onReview }: { t: Envelope; onReview: (item: ReviewItem) => void }) {
  switch (t.type) {
    case "week_sessions":
    case "streak":
      return (
        <>
          <Big>{t.display}</Big>
          <Context>{t.context}</Context>
        </>
      );
    case "rhr_3d":
    case "hrv_3d":
      return (
        <>
          <Big>{t.display}</Big>
          <Band points={(t.series ?? []).map((p: any) => p.value)} low={t.value.low} high={t.value.high} />
          <Context>
            {t.context}
            {t.value.sleepAvgMin7d ? ` · sleep avg ${formatSleep(t.value.sleepAvgMin7d)}` : ""}
          </Context>
        </>
      );
    case "record_book":
      return (
        <>
          <Context>{t.context}</Context>
          <div className="divide-y">
            {t.value.map((r: any) => {
              const fmt = (v: number) => (r.unit === "s" ? formatTime(v) : formatLoad(v));
              return (
                <div key={r.benchmark} data-testid={`record-${r.benchmark}`} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium sm:w-32 sm:flex-none">{r.label}</span>
                  <span className="shrink-0">
                    <span className="font-semibold">{fmt(r.best)}</span> <span className="text-xs text-muted-foreground">{shortDate(r.bestDate)}</span>
                  </span>
                  <span className="hidden flex-1 text-xs text-muted-foreground sm:block">
                    latest {fmt(r.latest)} · {r.attempts} attempt{r.attempts === 1 ? "" : "s"}
                  </span>
                  <Sparkline points={r.series.map((p: any) => p.value)} invert={r.unit === "s"} className="ml-auto w-14 shrink-0 sm:w-24" />
                </div>
              );
            })}
          </div>
        </>
      );
    case "review_queue":
      return (
        <div id="review" className="grid gap-1.5">
          {t.value.items.length === 0 && <p className="text-sm text-muted-foreground">All clear.</p>}
          {t.value.items.map((i: ReviewItem) => (
            <button
              key={i.sessionKey}
              type="button"
              data-testid={`review-${i.localDate}`}
              onClick={() => onReview(i)}
              className="rounded-md border border-warning/60 bg-warning/10 px-2.5 py-2 text-left text-sm hover:bg-warning/20"
            >
              <span className="font-medium">{shortDate(i.localDate)}</span> · {i.summary}
            </button>
          ))}
        </div>
      );
    case "heatmap_52w":
      return (
        <>
          <Heatmap days={t.value as HeatDay[]} />
          <Context>{t.context} · outlined days have no data from any source</Context>
        </>
      );
    case "recent_sessions":
      return (
        <div className="divide-y">
          {t.value.map((s: any) => (
            <div key={s.sessionKey} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="w-full text-muted-foreground sm:w-40 sm:shrink-0 sm:text-foreground">
                {shortDate(s.localDate)} · {s.title}
              </span>
              <span className="flex-1 font-medium">{s.primary}</span>
              <span className="text-xs text-muted-foreground">
                {s.hrAvg != null ? `HR ${Math.round(s.hrAvg)}` : ""}
                {s.kcal != null ? ` · ${Math.round(s.kcal)} kcal` : ""}
              </span>
              <span className="flex gap-1">
                {s.sources.map((src: string) => (
                  <Badge key={src} variant="outline" className="px-1.5 text-[10px]">
                    {SOURCE_SHORT[src] ?? src}
                  </Badge>
                ))}
              </span>
            </div>
          ))}
        </div>
      );
    case "training_mix":
      return <MixBar shares={t.value} />;
    default:
      return (
        <>
          <p className="text-sm">{t.display}</p>
          <Context>{t.context}</Context>
        </>
      );
  }
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [reviewing, setReviewing] = useState<ReviewItem | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(() => {
    Promise.all([getDashboard<DashboardData>(), getMe(), getProviders()])
      .then(([d, m, p]) => {
        setData(d);
        setMe(m);
        setProviders(p);
      })
      .catch((e) => !onUnauthorized(e) && setLoadFailed(true));
  }, []);
  useEffect(load, [load]);

  if (loadFailed)
    return (
      <div className="grid justify-items-start gap-3">
        <p role="alert" className="text-sm text-destructive">
          Couldn't load your dashboard. Check your connection.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            setLoadFailed(false);
            load();
          }}
        >
          Try again
        </Button>
      </div>
    );
  if (!data || !me) return <p className="text-sm text-muted-foreground">Loading your dashboard…</p>;
  const connected = providers.filter(isConnected);
  const lastSync = connected.map((p) => p.connection?.lastSyncAt).filter(Boolean).sort().at(-1);
  const reviewCount = data.tiles.review_queue?.value?.count ?? 0;

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting(me.name)}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            As of {shortDate(data.asOf)} · {ago(lastSync)}
            {connected.map((p) => (
              <Badge key={p.id} variant="outline" className="text-[10px]">
                {p.displayName}
              </Badge>
            ))}
          </p>
        </div>
        <nav className="flex gap-4 text-sm">
          <a href="/dashboard" className="font-medium">
            Dashboard
          </a>
          <a href="#review" className="text-muted-foreground hover:text-foreground">
            Review ({reviewCount})
          </a>
          <a href="/onboarding/connect" className="text-muted-foreground hover:text-foreground">
            Sources
          </a>
        </nav>
      </header>
      <div className="flex items-center justify-between rounded-full border px-4 py-2 text-sm text-muted-foreground" aria-disabled="true">
        <span>Ask anything, or “build me a dashboard for…” (coming soon)</span>
        <MicIcon className="size-4" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:[&>*]:order-none">
        {data.spec.tiles.map(({ type }) => {
          const t = data.tiles[type];
          return t ? (
            <Tile key={type} t={t}>
              <TileBody t={t} onReview={setReviewing} />
            </Tile>
          ) : null;
        })}
      </div>
      <ReviewSheet item={reviewing} onClose={() => setReviewing(null)} onResolved={load} />
    </div>
  );
}

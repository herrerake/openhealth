import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTimeline, onUnauthorized, type Timeline, type TimelineBlock } from "@/lib/api";
import { useWidth } from "@/lib/useWidth";
import { cn } from "@/lib/utils";

// Layout A (D-038): the whole session as one heart-rate line, each block shaded over its stretch,
// with a table of the same blocks underneath. Hovering either highlights both.

const METHOD_LABEL: Record<Timeline["method"], string> = {
  hyrox_splits: "Official HYROX splits",
  watch_segments: "Watch segments",
  ai_match: "Blocks estimated by AI · not exact",
  duration_match: "Blocks estimated · not exact",
  whole_workout: "Whole workout · not split into blocks",
  none: "No heart rate recorded",
};

// Repeated work (runs, reps) shares one color; every other block takes the next of the rest.
const REPEAT = /^(Running|Rep|Tempo) \d+$/;
const OTHER_COLORS = ["var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const QUIET = /^(Warm Up|Cool Down|Recovery)$/;

const TOP = 26;
const BOTTOM = 22;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function clockAt(startUtc: string, offsetS: number, tz: string): string {
  return new Date(Date.parse(startUtc) + offsetS * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
}

function bandColors(blocks: TimelineBlock[]): string[] {
  let k = 0;
  return blocks.map((b) =>
    QUIET.test(b.label) ? "var(--muted-foreground)" : REPEAT.test(b.label) ? "var(--chart-1)" : OTHER_COLORS[k++ % OTHER_COLORS.length],
  );
}

function Chart({ t, colors, active, onActive }: { t: Timeline; colors: string[]; active: number | null; onActive: (i: number | null) => void }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const H = W < 640 ? 200 : 240;
  const points = t.hr?.points ?? [];
  const totalS = Math.max(t.summary?.minutes ? t.summary.minutes * 60 : 0, ...t.blocks.map((b) => b.endS ?? 0), ...points.map(([s]) => s));
  const bpms = points.map(([, v]) => v);
  const lo = Math.floor((Math.min(...bpms) - 5) / 10) * 10;
  const hi = Math.ceil((Math.max(...bpms) + 5) / 10) * 10;
  const x = (s: number) => (s / totalS) * W;
  const y = (bpm: number) => TOP + (1 - (bpm - lo) / (hi - lo)) * (H - TOP - BOTTOM);

  // Break the line where the watch recorded nothing for over a minute: a gap, not a zero.
  const paths: string[] = [];
  let d = "";
  points.forEach(([s, bpm], i) => {
    const gap = i > 0 && s - points[i - 1][0] > 60;
    if (gap && d) {
      paths.push(d);
      d = "";
    }
    d += `${d ? "L" : "M"}${x(s).toFixed(1)},${y(bpm).toFixed(1)}`;
  });
  if (d) paths.push(d);

  const tickCount = W < 640 ? 3 : 5;
  const ticks = Array.from({ length: tickCount }, (_, i) => (totalS * i) / (tickCount - 1));
  return (
    <div ref={ref} className="w-full">
      {W > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block"
          role="img"
          aria-label={`Heart rate over the session, ${t.blocks.length} blocks`}
        >
          {t.blocks.map((b, i) =>
            b.startS == null || b.endS == null ? null : (
              <g key={`${b.label}-${i}`} onMouseEnter={() => onActive(i)} onMouseLeave={() => onActive(null)}>
                <rect
                  x={x(b.startS)}
                  y={TOP}
                  width={Math.max(1, x(b.endS) - x(b.startS))}
                  height={H - TOP - BOTTOM}
                  fill={colors[i]}
                  opacity={active === i ? 0.3 : QUIET.test(b.label) ? 0.07 : 0.14}
                />
                {x(b.endS) - x(b.startS) > b.label.length * 7 + 8 && (
                  <text x={x(b.startS) + 4} y={TOP - 8} className="fill-muted-foreground text-[12px]">
                    {b.label}
                  </text>
                )}
                <line
                  x1={x(b.startS)}
                  x2={x(b.startS)}
                  y1={TOP}
                  y2={H - BOTTOM}
                  stroke="currentColor"
                  strokeOpacity={0.15}
                  strokeDasharray={b.source === "estimated" ? "4 4" : undefined}
                />
              </g>
            ),
          )}
          {[lo, Math.round((lo + hi) / 2), hi].map((v) => (
            <text key={v} x={W - 4} y={y(v) - 3} textAnchor="end" className="fill-muted-foreground text-[12px]">
              {v}
            </text>
          ))}
          {paths.map((p) => (
            <path
              key={p.slice(0, 24)}
              d={p}
              fill="none"
              stroke="var(--chart-5)"
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {ticks.map((s, i) => (
            <text
              key={s}
              x={x(s)}
              y={H - 4}
              textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
              className="fill-muted-foreground text-[12px]"
            >
              {clockAt(t.startUtc, s, t.tz)}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

export default function SessionTimeline() {
  const [t, setT] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const key = useMemo(() => new URLSearchParams(location.search).get("key"), []);

  useEffect(() => {
    if (!key) {
      setError("No session selected.");
      return;
    }
    getTimeline(key)
      .then(setT)
      .catch((e) => {
        if (!onUnauthorized(e)) setError("This session couldn't be loaded.");
      });
  }, [key]);

  if (error) return <p className="text-sm text-muted-foreground">{error}</p>;
  if (!t) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const colors = bandColors(t.blocks);
  const date = new Date(`${t.localDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const timed = t.blocks.some((b) => b.startS != null);
  return (
    <div className="grid gap-4">
      <a href="/dashboard" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Dashboard
      </a>
      <header className="grid gap-1">
        <p className="text-sm text-muted-foreground">
          {date}
          {timed ? ` · ${clockAt(t.startUtc, 0, t.tz)}` : ""}
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl" data-testid="session-title">
          {t.title}
        </h1>
        {t.summary && (
          <p className="text-sm">
            {t.summary.minutes} min
            {t.summary.avgHr != null ? ` · avg ${t.summary.avgHr} bpm · peak ${t.summary.maxHr}` : ""}
          </p>
        )}
      </header>

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>Heart rate by block</CardTitle>
          <Badge variant={t.method === "duration_match" || t.method === "ai_match" ? "secondary" : "outline"} data-testid="timeline-method">
            {METHOD_LABEL[t.method]}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-3">
          {t.hr ? (
            <Chart t={t} colors={colors} active={active} onActive={setActive} />
          ) : (
            <p className="text-sm text-muted-foreground">The watch recorded no heart rate for this session.</p>
          )}
          <p className="text-sm text-muted-foreground" data-testid="timeline-spoken">
            {t.spoken}
          </p>
        </CardContent>
      </Card>

      <Card className="gap-1">
        <CardHeader>
          <CardTitle>Blocks</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm" data-testid="timeline-blocks">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1.5 font-normal">Block</th>
                <th className="py-1.5 font-normal">Time</th>
                <th className="py-1.5 text-right font-normal">Avg</th>
                <th className="py-1.5 text-right font-normal">Peak</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {t.blocks.map((b, i) => (
                <tr
                  key={`${b.label}-${i}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  className={cn("align-top", active === i && "bg-muted/60")}
                >
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2 font-medium">
                      <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: colors[i] }} />
                      {b.label}
                    </span>
                    {b.prescription && (
                      <span className="mt-0.5 block whitespace-pre-line text-xs text-muted-foreground line-clamp-3">{b.prescription}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">
                    {b.startS != null && b.endS != null ? `${clockAt(t.startUtc, b.startS, t.tz)} · ${mmss(b.endS - b.startS)}` : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">{b.avgHr ?? "—"}</td>
                  <td className="py-2 text-right tabular-nums">{b.maxHr ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(t.method === "duration_match" || t.method === "ai_match") && (
            <p className="mt-3 text-xs text-muted-foreground">
              Block times are matched to changes in your heart rate, so they're close, not exact. Heart-rate numbers are computed from your watch.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

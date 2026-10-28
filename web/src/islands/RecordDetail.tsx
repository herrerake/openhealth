import { ArrowLeftIcon, ChevronRightIcon, InfoIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getRecord, onUnauthorized, type RecordAttempt, type RecordDetail as Detail } from "@/lib/api";
import { formatBenchmark } from "@/lib/format";
import { useWidth } from "@/lib/useWidth";
import { cn } from "@/lib/utils";

// One benchmark's full record: every attempt as a dot, the best-so-far as a step line, and the
// same attempts in a table underneath. Hovering either highlights both.

const TOP = 16;
const BOTTOM = 22;
const LEFT = 56;
const RIGHT = 12;
const TABLE_STEP = 20;

const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const sessionHref = (key: string) => `/session/?key=${encodeURIComponent(key)}`;

function Chart({ r, active, onActive }: { r: Detail; active: number | null; onActive: (i: number | null) => void }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const H = W < 640 ? 200 : 260;
  const fmt = (v: number) => formatBenchmark(r.unit, v);
  const a = r.attempts;
  const t0 = dayMs(a[0].date);
  const t1 = Math.max(dayMs(a.at(-1)!.date), t0 + 86_400_000);
  const values = a.map((x) => x.value);
  const pad = (Math.max(...values) - Math.min(...values)) * 0.12 || Math.max(...values) * 0.05 || 1;
  const lo = Math.min(...values) - pad;
  const hi = Math.max(...values) + pad;
  // Better is always up: for times, faster sits higher.
  const up = r.better === "lower";
  const x = (d: string) => LEFT + ((dayMs(d) - t0) / (t1 - t0)) * (W - LEFT - RIGHT);
  const y = (v: number) => TOP + (up ? (v - lo) / (hi - lo) : 1 - (v - lo) / (hi - lo)) * (H - TOP - BOTTOM);

  // The best so far only moves on a PR, so it's drawn as steps: flat, then a jump on the PR day.
  let step = `M${x(a[0].date).toFixed(1)},${y(a[0].bestSoFar).toFixed(1)}`;
  for (const p of a.slice(1)) step += `H${x(p.date).toFixed(1)}V${y(p.bestSoFar).toFixed(1)}`;
  const trail = a.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join("");

  const yTicks = [lo + pad, (lo + hi) / 2, hi - pad];
  const xTickCount = W < 640 ? 3 : 5;
  const xTicks = Array.from({ length: xTickCount }, (_, i) => new Date(t0 + ((t1 - t0) * i) / (xTickCount - 1)).toISOString().slice(0, 10));
  const bestIndex = a.findIndex((p) => p.value === r.best.value && p.date === r.best.date);

  function nearest(clientX: number, rect: DOMRect) {
    const px = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < a.length; i++) if (Math.abs(x(a[i].date) - px) < Math.abs(x(a[best].date) - px)) best = i;
    return best;
  }

  const hover = active != null ? a[active] : null;
  const tipLeft = hover ? Math.min(Math.max(x(hover.date), 80), W - 80) : 0;
  return (
    <div ref={ref} className="relative w-full">
      {W > 0 && (
        <>
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            className="block touch-pan-y"
            role="img"
            aria-label={`${r.label}, ${a.length} attempts from ${shortDate(a[0].date)} to ${shortDate(a.at(-1)!.date)}. Best ${fmt(r.best.value)}.`}
            onPointerMove={(e) => onActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
            onPointerLeave={() => onActive(null)}
          >
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={LEFT} x2={W - RIGHT} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.08} />
                <text x={LEFT - 8} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-[12px] tabular-nums">
                  {fmt(v)}
                </text>
              </g>
            ))}
            {xTicks.map((d, i) => (
              <text
                key={d}
                x={x(d)}
                y={H - 4}
                textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
                className="fill-muted-foreground text-[12px]"
              >
                {new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })}
              </text>
            ))}
            {hover && <line x1={x(hover.date)} x2={x(hover.date)} y1={TOP} y2={H - BOTTOM} stroke="currentColor" strokeOpacity={0.25} />}
            <path d={trail} fill="none" stroke="var(--chart-1)" strokeOpacity={0.35} strokeWidth={1.5} strokeLinejoin="round" />
            <path d={step} fill="none" stroke="var(--foreground)" strokeWidth={2} strokeLinejoin="round" data-testid="record-progression" />
            {a.map((p, i) => (
              <circle
                key={`${p.date}-${i}`}
                cx={x(p.date)}
                cy={y(p.value)}
                r={active === i ? 6 : p.pr || i === bestIndex ? 4.5 : 3}
                fill={p.pr || i === 0 ? "var(--foreground)" : "var(--chart-1)"}
                stroke="var(--card)"
                strokeWidth={2}
              />
            ))}
            {bestIndex >= 0 && (
              <text
                x={x(a[bestIndex].date)}
                y={y(a[bestIndex].value) - 10}
                textAnchor={x(a[bestIndex].date) > W - 60 ? "end" : "middle"}
                className="fill-foreground text-[12px] font-semibold"
              >
                Best {fmt(r.best.value)}
              </text>
            )}
          </svg>
          {hover && (
            <div
              className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm"
              style={{ left: tipLeft }}
              data-testid="record-tooltip"
            >
              <div className="text-muted-foreground">{shortDate(hover.date)}</div>
              <div className="font-semibold tabular-nums">
                {fmt(hover.value)}
                {hover.pr ? " · new best" : ""}
              </div>
              {!hover.pr && hover.value !== hover.bestSoFar && <div className="text-muted-foreground">best then {fmt(hover.bestSoFar)}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="grid gap-0.5 rounded-lg border px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tracking-tight tabular-nums">{value}</span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 bg-foreground" /> Best so far
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-2 rounded-full bg-chart-1" /> Attempt
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-full bg-foreground" /> New best
      </span>
    </div>
  );
}

export default function RecordDetail() {
  const [r, setR] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const benchmark = useMemo(() => new URLSearchParams(location.search).get("benchmark"), []);

  useEffect(() => {
    if (!benchmark) {
      setError("No record selected.");
      return;
    }
    getRecord(benchmark)
      .then(setR)
      .catch((e) => {
        if (!onUnauthorized(e)) setError("This record couldn't be loaded.");
      });
  }, [benchmark]);

  if (error) return <p className="text-sm text-muted-foreground">{error}</p>;
  if (!r) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const fmt = (v: number) => formatBenchmark(r.unit, v);
  const n = r.attempts.length;
  const newestFirst = r.attempts.map((p, i) => ({ p, i })).reverse();
  const rows = showAll ? newestFirst : newestFirst.slice(0, TABLE_STEP);
  const change = r.change === 0 ? "—" : `${fmt(r.change)} ${r.unit === "s" ? "faster" : "more"}`;
  const isBest = (p: RecordAttempt) => p.value === r.best.value && p.date === r.best.date;
  return (
    <div className="grid gap-4">
      <a href="/dashboard" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Dashboard
      </a>
      <header className="grid gap-1">
        <p className="text-sm text-muted-foreground">Record book</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl" data-testid="record-title">
          {r.label}
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="record-spoken">
          {r.spoken}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Best" value={fmt(r.best.value)} note={shortDate(r.best.date)} />
        <Stat label="Latest" value={fmt(r.latest.value)} note={shortDate(r.latest.date)} />
        <Stat label="Since your first" value={change} note={`first ${fmt(r.first.value)}, ${shortDate(r.first.date)}`} />
        <Stat label="Attempts" value={String(n)} note={`${r.prCount} new best${r.prCount === 1 ? "" : "s"} after the first`} />
      </div>

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>Progression</CardTitle>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="-mt-2 -mr-2 size-7 text-muted-foreground" aria-label="How this was calculated">
                <InfoIcon />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end">
              <p className="font-medium">How this was calculated</p>
              <p className="mt-1 text-muted-foreground">{r.calc.description}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Based on {r.calc.inputs.sourceRecordIds?.length ?? n} source records, as of {shortDate(r.asOf)}.
              </p>
            </PopoverContent>
          </Popover>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Legend />
          {n > 1 ? (
            <Chart r={r} active={active} onActive={setActive} />
          ) : (
            <p className="text-sm text-muted-foreground">One attempt so far. The chart starts with your second.</p>
          )}
          <p className="text-xs text-muted-foreground">{r.unit === "s" ? "Faster is higher." : "Higher is better."}</p>
        </CardContent>
      </Card>

      <Card className="gap-1">
        <CardHeader>
          <CardTitle>Every attempt</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm" data-testid="record-attempts">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1.5 font-normal">Date</th>
                <th className="hidden py-1.5 font-normal sm:table-cell">Session</th>
                <th className="py-1.5 text-right font-normal">Result</th>
                <th className="py-1.5 text-right font-normal">
                  <span className="sr-only">Record</span>
                </th>
                <th className="py-1.5">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(({ p, i }) => (
                <tr
                  key={`${p.date}-${i}`}
                  data-testid={`attempt-${p.date}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  className={cn("relative", p.sessionKey && "hover:bg-muted/60", active === i && "bg-muted/60")}
                >
                  <td className="whitespace-nowrap py-2 pr-3">
                    {p.sessionKey ? (
                      // The link covers the whole row, so the row opens the session from anywhere.
                      <a
                        href={sessionHref(p.sessionKey)}
                        aria-label={`${shortDate(p.date)}, ${fmt(p.value)}. Open the session`}
                        className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-ring"
                      >
                        {shortDate(p.date)}
                      </a>
                    ) : (
                      shortDate(p.date)
                    )}
                  </td>
                  <td className="hidden py-2 pr-3 text-muted-foreground sm:table-cell">{p.title}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{fmt(p.value)}</td>
                  <td className="w-24 py-2 pl-3 text-right">
                    {isBest(p) ? (
                      <Badge>Best</Badge>
                    ) : p.pr ? (
                      <Badge variant="outline">New best</Badge>
                    ) : i === 0 ? (
                      <span className="text-xs text-muted-foreground">First</span>
                    ) : null}
                  </td>
                  <td className="w-6 py-2 pl-2 text-right text-muted-foreground">
                    {p.sessionKey && <ChevronRightIcon className="ml-auto size-4" aria-hidden="true" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {n > TABLE_STEP && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll((s) => !s)}>
              {showAll ? "Show fewer" : `Show all ${n} attempts`}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

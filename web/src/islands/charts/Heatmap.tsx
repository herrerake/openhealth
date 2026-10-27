export interface HeatDay {
  date: string;
  sessions: number;
  hasData: boolean;
}

/** 52 weeks × 7 days. Days with no data from any source are outlined, never shown as rest. */
export default function Heatmap({ days }: { days: HeatDay[] }) {
  const cell = 10;
  const gap = 2;
  const cols = Math.ceil(days.length / 7);
  return (
    <svg viewBox={`0 0 ${cols * (cell + gap)} ${7 * (cell + gap)}`} className="h-auto w-full" role="img" aria-label="Workouts per day, last 52 weeks">
      {days.map((d, i) => (
        <rect
          key={d.date}
          x={Math.floor(i / 7) * (cell + gap)}
          y={(i % 7) * (cell + gap)}
          width={cell}
          height={cell}
          rx="2"
          className={
            !d.hasData
              ? "fill-transparent stroke-muted-foreground/40 [stroke-dasharray:2_2]"
              : d.sessions >= 2
                ? "fill-chart-1"
                : d.sessions === 1
                  ? "fill-chart-1/55"
                  : "fill-chart-1/10"
          }
        >
          <title>{`${d.date}: ${d.hasData ? `${d.sessions} workout${d.sessions === 1 ? "" : "s"}` : "no data"}`}</title>
        </rect>
      ))}
    </svg>
  );
}

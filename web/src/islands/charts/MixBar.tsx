import { formatPercent } from "@/lib/format";

const COLORS: Record<string, string> = { strength: "bg-chart-1", metcon: "bg-chart-2", run: "bg-chart-3", row: "bg-chart-4", mixed: "bg-chart-5" };
const LABELS: Record<string, string> = { strength: "Strength", metcon: "Metcon", run: "Runs", row: "Rowing", mixed: "Mixed" };

export default function MixBar({ shares }: { shares: Record<string, number> }) {
  const entries = Object.entries(shares).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return (
    <div className="grid gap-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {entries.map(([k, v]) => (
          <div key={k} className={COLORS[k]} style={{ width: `${v * 100}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {entries.map(([k, v]) => (
          <span key={k} className="flex items-center gap-1">
            <span className={`size-2 rounded-full ${COLORS[k]}`} /> {LABELS[k] ?? k} {formatPercent(v)}
          </span>
        ))}
      </div>
    </div>
  );
}

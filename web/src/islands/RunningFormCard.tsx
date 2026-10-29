import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RunningSummary } from "@/lib/api";
import { formatPace } from "../../../src/core/running";

// The watch's running form for one run, next to the economy figures derived from it.

interface Stat {
  label: string;
  value: string | null;
  hint: string;
}

function stats(r: RunningSummary): Stat[] {
  return [
    { label: "Distance", value: r.distanceM != null ? `${(r.distanceM / 1000).toFixed(2)} km` : null, hint: "from the watch" },
    { label: "Avg pace", value: r.paceSPerKm != null ? formatPace(r.paceSPerKm) : null, hint: "whole run, stops included" },
    { label: "Meters per heartbeat", value: r.metersPerBeat != null ? r.metersPerBeat.toFixed(2) : null, hint: "distance ÷ total beats · higher is better" },
    { label: "Ground contact", value: r.groundContactMs != null ? `${r.groundContactMs} ms` : null, hint: "lower is better" },
    { label: "Stride length", value: r.strideM != null ? `${r.strideM.toFixed(2)} m` : null, hint: "average" },
    { label: "Cadence", value: r.cadenceSpm != null ? `${r.cadenceSpm} spm` : null, hint: "steps a minute · rises with pace" },
    { label: "Vertical oscillation", value: r.verticalOscillationCm != null ? `${r.verticalOscillationCm.toFixed(1)} cm` : null, hint: "lower is better" },
    { label: "Vertical ratio", value: r.verticalRatioPct != null ? `${r.verticalRatioPct.toFixed(1)}%` : null, hint: "bounce ÷ stride · lower is better" },
    { label: "Power", value: r.powerW != null ? `${r.powerW} W` : null, hint: "average" },
  ];
}

/** `trended`: this run counts toward the dashboard's running economy trend, so link to it. */
export default function RunningFormCard({ running, trended }: { running: RunningSummary; trended: boolean }) {
  const shown = stats(running).filter((s) => s.value != null);
  return (
    <Card className="gap-2" data-testid="running-form">
      <CardHeader>
        <CardTitle>Running form</CardTitle>
        {trended && (
          <a href="/dashboard#running-economy" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            See your trend
          </a>
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {shown.map((s) => (
            <div key={s.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{s.label}</dt>
              <dd className="text-lg font-semibold tabular-nums tracking-tight">{s.value}</dd>
              <dd className="text-xs text-muted-foreground">{s.hint}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          {running.wholeRace
            ? "Averaged by the watch across the whole race, stations included. Indoor GPS distance isn't reliable, so pace and meters per heartbeat are left out. Cadence is left out too: across the stations it doesn't describe your running."
            : "Averages your watch recorded for the whole run."}
        </p>
      </CardContent>
    </Card>
  );
}

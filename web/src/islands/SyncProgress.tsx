import { AgentClient } from "agents/client";
import { AlertCircleIcon, CheckIcon, LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getMe, onUnauthorized, startSync } from "@/lib/api";
import type { ProviderProgress, SyncState } from "@/lib/sync";

const NAMES: Record<string, string> = { wodup: "WodUp", mindbody: "Mindbody", garmin: "Garmin", oura: "Oura", whoop: "WHOOP", hyrox: "HYROX", race_results: "Race results" };
const secs = (ms = 0) => `${(ms / 1000).toFixed(1)} s`;

function StatusIcon({ status }: { status: ProviderProgress["status"] | "running" | "pending" }) {
  if (status === "done") return <CheckIcon className="size-4 text-chart-2" />;
  if (status === "error") return <AlertCircleIcon className="size-4 text-destructive" />;
  return <LoaderIcon className="size-4 animate-spin text-muted-foreground" />;
}

export default function SyncProgress() {
  const [state, setState] = useState<SyncState | null>(null);

  useEffect(() => {
    let client: AgentClient | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let heard = false;
    getMe()
      .then((me) => {
        client = new AgentClient({
          agent: "athlete-agent",
          name: me.id,
          host: location.host,
          onStateUpdate: (s: unknown) => {
            heard = true;
            setState(s as SyncState);
          },
        });
        // If the socket can't open (proxies, flaky networks), fall back to polling.
        setTimeout(() => {
          if (heard) return;
          poll = setInterval(async () => {
            const r = await fetch("/api/sync/state");
            if (r.ok) setState((await r.json()) as SyncState);
          }, 1000);
        }, 3000);
      })
      .catch(onUnauthorized);
    return () => {
      client?.close();
      if (poll) clearInterval(poll);
    };
  }, []);

  if (!state) return <p className="text-sm text-muted-foreground">Connecting…</p>;
  if (!state.runId)
    return (
      <p className="text-sm text-muted-foreground">
        Nothing is syncing. <a className="underline" href="/onboarding/connect">Connect an account</a> to start.
      </p>
    );

  const finished = state.status === "done" || state.status === "error";
  const t = state.summary?.timings ?? {};
  return (
    <div className="grid gap-4">
      {Object.entries(state.providers).map(([id, p]) => (
        <div key={id} className="grid gap-1.5" data-testid={`sync-${id}`}>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <StatusIcon status={p.status} /> {p.label}
            </span>
            {p.status === "error" && (
              <Button size="sm" variant="outline" onClick={() => startSync([id]).catch(onUnauthorized)}>
                Retry {NAMES[id] ?? id}
              </Button>
            )}
          </div>
          {p.status === "error" ? (
            <p className="text-xs text-destructive">{p.error}</p>
          ) : (
            <Progress value={p.status === "done" ? 100 : p.total ? Math.round((p.done / p.total) * 100) : undefined} />
          )}
        </div>
      ))}
      <div className="flex items-center gap-2 text-sm">
        <StatusIcon status={state.reconcile.status === "done" ? "done" : "running"} /> Matching workouts across sources…
      </div>
      {state.summary && (
        <Card>
          <CardContent className="grid gap-1">
            <p className="font-medium">
              {state.summary.workouts} workouts · {state.summary.duplicatesRemoved} duplicates removed · {state.summary.needsReview} need review
            </p>
            <p className="text-xs text-muted-foreground">
              {Object.entries(t)
                .filter(([k]) => k !== "total")
                .map(([k, ms]) => `${k === "reconcile" ? "matching" : (NAMES[k] ?? k)} ${secs(ms)}`)
                .join(" · ")}
              {t.total != null ? ` · total ${secs(t.total)}` : ""}
            </p>
          </CardContent>
        </Card>
      )}
      {finished && (
        <a className={buttonVariants({ size: "lg" })} href="/dashboard">
          See your dashboard
        </a>
      )}
    </div>
  );
}

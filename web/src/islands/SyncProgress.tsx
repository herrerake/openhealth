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
    let cancelled = false;
    let client: AgentClient | null = null;
    let heard = false;
    let fallback: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };
    const finished = (s: SyncState) => !!s.runId && (s.status === "done" || s.status === "error");

    getMe()
      .then((me) => {
        if (cancelled) return;
        client = new AgentClient({
          agent: "athlete-agent",
          name: me.id,
          host: location.host,
          onStateUpdate: (s: unknown) => {
            heard = true;
            stopPolling();
            setState(s as SyncState);
          },
        });
        // If the socket hasn't delivered state in 3 s (proxies, cold starts), poll until it does or the run ends.
        fallback = setTimeout(() => {
          if (heard || cancelled) return;
          poll = setInterval(async () => {
            try {
              const r = await fetch("/api/sync/state");
              if (!r.ok) return;
              const s = (await r.json()) as SyncState;
              setState(s);
              if (finished(s)) stopPolling();
            } catch {
              // transient network error: keep trying until the run ends
            }
          }, 1000);
        }, 3000);
      })
      .catch(onUnauthorized);

    return () => {
      cancelled = true;
      if (fallback) clearTimeout(fallback);
      stopPolling();
      client?.close();
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
      <div
        className="flex items-center gap-2 text-sm"
        data-testid="sync-matching"
        data-status={state.status === "error" && state.reconcile.status !== "done" ? "error" : state.reconcile.status}
      >
        <StatusIcon status={state.reconcile.status === "done" ? "done" : state.status === "error" ? "error" : "running"} /> Matching workouts across
        sources…
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          Sync failed{state.error ? `: ${state.error}` : "."} Your earlier data is unchanged.
        </p>
      )}
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

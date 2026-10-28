import { ArrowRightIcon, CheckIcon, HeartIcon, UploadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { type Provider, getProviders, isConnected, onUnauthorized, startSync } from "@/lib/api";
import { cn } from "@/lib/utils";
import AppleUpload from "./AppleUpload";

const GROUPS: [Provider["category"], string][] = [
  ["wearables", "Wearables"],
  ["gym", "Gym & training"],
  ["races", "Races"],
];

// One-line detail and a monogram tint per provider. Monograms stand in for logos we don't ship.
const META: Record<string, { detail: string; tint: string }> = {
  apple_health: { detail: "Workouts, heart rate and sleep · export file", tint: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
  garmin: { detail: "Activities, heart rate and sleep", tint: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  oura: { detail: "Sleep, readiness and HRV", tint: "bg-zinc-500/15 text-foreground" },
  whoop: { detail: "Strain, recovery and sleep", tint: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  wodup: { detail: "WODs, scores and lifts", tint: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
  mindbody: { detail: "Class bookings and attendance", tint: "bg-teal-500/15 text-teal-600 dark:text-teal-400" },
  hyrox: { detail: "Race results and splits", tint: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400" },
  race_results: { detail: "Marathons, 10Ks and other races", tint: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
};

function ProviderMark({ id, name }: { id: string; name: string }) {
  return (
    <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-xl font-display text-sm font-bold", META[id]?.tint ?? "bg-muted")}>
      {id === "apple_health" ? <HeartIcon className="size-[18px]" fill="currentColor" strokeWidth={0} /> : name.slice(0, 1)}
    </span>
  );
}

export default function ProviderGrid() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [appleOpen, setAppleOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = () =>
    getProviders()
      .then(setProviders)
      .catch((e) => !onUnauthorized(e) && setNotice("Couldn't load your accounts. Refresh to try again."));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("connected");
    const p = providers?.find((x) => x.id === id);
    if (p) setNotice(`${p.displayName} connected`);
  }, [providers]);

  if (!providers)
    return (
      <div className="grid gap-2" aria-busy="true" aria-label="Loading your accounts">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[68px] animate-pulse rounded-xl bg-muted/60" />
        ))}
      </div>
    );
  const connected = providers.filter(isConnected).length;

  const sync = async () => {
    setSyncing(true);
    try {
      await startSync();
      location.assign("/onboarding/sync");
    } catch (e) {
      setSyncing(false);
      if (!onUnauthorized(e)) setNotice("Couldn't start the sync. Try again.");
    }
  };

  return (
    <div className="grid gap-8">
      {notice && (
        <div role="status" className="animate-rise flex items-center gap-2.5 rounded-xl border bg-card px-3.5 py-2.5 text-sm font-medium shadow-xs">
          <span className="grid size-5 place-items-center rounded-full bg-brand text-brand-foreground">
            <CheckIcon className="size-3" strokeWidth={3} />
          </span>
          {notice}
        </div>
      )}
      {GROUPS.map(([category, label]) => (
        <section key={category} className="grid gap-2.5" aria-labelledby={`group-${category}`}>
          <h2 id={`group-${category}`} className="px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border bg-card shadow-xs">
            {providers
              .filter((p) => p.category === category)
              .map((p) => {
                const on = isConnected(p);
                const meta = META[p.id];
                return (
                  <li key={p.id} data-testid={`provider-${p.id}`} data-connected={String(on)} className="flex items-center gap-3.5 px-3.5 py-3">
                    <ProviderMark id={p.id} name={p.displayName} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">{p.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">{meta?.detail ?? "Read-only access"}</p>
                    </div>
                    {on ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand/15 px-2.5 py-1 text-xs font-semibold text-brand-ink">
                        <CheckIcon className="size-3.5" strokeWidth={3} /> Connected
                      </span>
                    ) : p.kind === "file" ? (
                      <Button size="sm" variant="outline" className="shrink-0 rounded-full px-3.5" aria-label="Upload Apple Health export" onClick={() => setAppleOpen(true)}>
                        <UploadIcon /> Upload
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 rounded-full px-3.5"
                        aria-label={`Connect ${p.displayName}`}
                        onClick={() => location.assign(`/api/connect/${p.id}/start`)}
                      >
                        Connect
                      </Button>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
      <div className="sticky bottom-0 -mx-4 grid gap-2 bg-gradient-to-t from-background from-70% to-transparent px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:bg-none sm:p-0">
        <Button variant="brand" size="xl" disabled={connected === 0 || syncing} onClick={sync}>
          {syncing ? "Starting…" : `Sync ${connected} account${connected === 1 ? "" : "s"}`}
          {!syncing && connected > 0 && <ArrowRightIcon />}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {connected === 0 ? "Connect at least one account to continue." : "You can add more accounts later."}
        </p>
      </div>
      <AppleUpload open={appleOpen} onOpenChange={setAppleOpen} onUploaded={load} />
    </div>
  );
}

import { CheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type Provider, getProviders, isConnected, onUnauthorized, startSync } from "@/lib/api";
import AppleUpload from "./AppleUpload";

const GROUPS: [Provider["category"], string][] = [
  ["wearables", "Wearables"],
  ["gym", "Gym & training"],
  ["races", "Races"],
];

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

  if (!providers) return <p className="text-sm text-muted-foreground">Loading your accounts…</p>;
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
    <div className="grid gap-6">
      {notice && (
        <div role="status" className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm">
          <CheckIcon className="size-4" /> {notice}
        </div>
      )}
      {GROUPS.map(([category, label]) => (
        <section key={category} className="grid gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {providers
              .filter((p) => p.category === category)
              .map((p) => {
                const on = isConnected(p);
                return (
                  <div
                    key={p.id}
                    data-testid={`provider-${p.id}`}
                    data-connected={String(on)}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 ${on ? "border-chart-2 bg-chart-2/5" : ""}`}
                  >
                    <span className="text-sm font-medium">{p.displayName}</span>
                    {on ? (
                      <Badge variant="outline" className="border-chart-2 text-chart-2">
                        <CheckIcon /> Connected
                      </Badge>
                    ) : p.kind === "file" ? (
                      <Button size="sm" variant="outline" onClick={() => setAppleOpen(true)}>
                        Upload Apple Health export
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => location.assign(`/api/connect/${p.id}/start`)}>
                        Connect {p.displayName}
                      </Button>
                    )}
                  </div>
                );
              })}
          </div>
        </section>
      ))}
      <Button size="lg" disabled={connected === 0 || syncing} onClick={sync}>
        {syncing ? "Starting…" : `Sync ${connected} account${connected === 1 ? "" : "s"}`}
      </Button>
      <AppleUpload open={appleOpen} onOpenChange={setAppleOpen} onUploaded={load} />
    </div>
  );
}

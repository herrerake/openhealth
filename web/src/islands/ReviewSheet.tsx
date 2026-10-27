import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getSession, onUnauthorized, postReview } from "@/lib/api";

export interface ReviewItem {
  sessionKey: string;
  localDate: string;
  kind: "merge_split" | "pick" | "confirm";
  summary: string;
}

interface SessionDetail {
  session: { local_date: string; kind: string; status: string };
  sources: { id: number; source: string; kind: string; role: string; summary: string }[];
  conflicts: { field: string; values: Record<string, number>; display: Record<string, string>; chosen: string; resolvedBy: string }[];
}

const SOURCE_NAME: Record<string, string> = { apple_health: "watch", wodup: "WodUp", mindbody: "Mindbody" };
const PROVIDER: Record<string, string> = { apple_health: "Apple Health", wodup: "WodUp", mindbody: "Mindbody" };

export default function ReviewSheet({ item, onClose, onResolved }: { item: ReviewItem | null; onClose: () => void; onResolved: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setLoadFailed(false);
    if (item)
      getSession<SessionDetail>(item.sessionKey)
        .then(setDetail)
        .catch((e) => !onUnauthorized(e) && setLoadFailed(true));
  }, [item]);

  const act = async (action: string, payload?: Record<string, string>) => {
    if (!item) return;
    setBusy(true);
    try {
      await postReview(item.sessionKey, { action, payload });
      onClose();
      onResolved();
    } catch (e) {
      if (!onUnauthorized(e)) setError("That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // One button per source: it settles every field that source disagrees on.
  const pickSources = detail ? [...new Set(detail.conflicts.flatMap((c) => Object.keys(c.values)))] : [];

  return (
    <Sheet open={!!item} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{item?.summary}</SheetTitle>
          <SheetDescription>
            {item && new Date(`${item.localDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}
          </SheetDescription>
        </SheetHeader>
        {loadFailed ? (
          <p role="alert" className="text-sm text-destructive">
            Couldn't load this workout. Close and try again.
          </p>
        ) : !detail ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <section className="grid gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">What each source recorded</h3>
              {detail.sources.map((s) => (
                <div key={s.id} className="grid gap-1 rounded-md border px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {PROVIDER[s.source] ?? s.source}
                    </Badge>
                    {s.role === "duplicate" && <span className="text-xs text-muted-foreground">duplicate</span>}
                  </span>
                  <span>{s.summary}</span>
                </div>
              ))}
            </section>
            <section className="mt-2 grid gap-2">
              {item?.kind === "merge_split" && (
                <>
                  <p className="text-sm text-muted-foreground">Your watch recorded two workouts during this class. Were they one session?</p>
                  <Button disabled={busy} onClick={() => act("merge")}>
                    Merge into one workout
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => act("split")}>
                    Keep separate
                  </Button>
                </>
              )}
              {item?.kind === "pick" && (
                <>
                  <p className="text-sm text-muted-foreground">Your sources disagree. Which numbers should OpenHealth use? Nothing is averaged.</p>
                  {pickSources.map((src) => (
                    <Button key={src} variant={src === "apple_health" ? "default" : "outline"} disabled={busy} onClick={() => act("pick", { source: src })}>
                      Use {SOURCE_NAME[src] ?? src}: {detail.conflicts.map((c) => c.display[src]).filter(Boolean).join(" · ")}
                    </Button>
                  ))}
                </>
              )}
              {item?.kind === "confirm" && (
                <>
                  <p className="text-sm text-muted-foreground">This result was logged hours after the class. Is it from this class?</p>
                  <Button disabled={busy} onClick={() => act("confirm")}>
                    Confirm
                  </Button>
                </>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

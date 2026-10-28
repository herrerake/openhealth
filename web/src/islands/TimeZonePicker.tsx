import { CheckIcon, ChevronsUpDownIcon, GlobeIcon, SearchIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { REGIONS, type Zone, localTime, offsetLabel, offsetMinutes, zoneFromId, zoneName } from "@/lib/timezones";

const FALLBACK = "America/New_York";

/** Searchable, region-grouped time zone combobox. Submits its value as a hidden `name` input inside the parent form. */
export default function TimeZonePicker({ id, name }: { id: string; name: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  // Detect on the client only: the static build can't know the visitor's zone.
  useEffect(() => {
    let detected = FALLBACK;
    try {
      detected = Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK;
    } catch {}
    setValue(detected);
  }, []);

  const groups = useMemo(() => {
    const detected = value ? zoneFromId(value) : null;
    const base: [string, Zone[]][] = REGIONS.some(([, zs]) => zs.some((z) => z.id === detected?.id))
      ? REGIONS
      : detected
        ? [["Your device", [detected]], ...REGIONS]
        : REGIONS;
    const q = query.trim().toLowerCase();
    return base
      .map(([region, zones]) => {
        const hits = q
          ? zones.filter((z) => [z.city, z.country, z.id, zoneName(z.id, now), offsetLabel(z.id, now)].some((s) => s.toLowerCase().includes(q)))
          : zones;
        return [region, [...hits].sort((a, b) => offsetMinutes(a.id, now) - offsetMinutes(b.id, now))] as [string, Zone[]];
      })
      .filter(([, zones]) => zones.length > 0);
    // value only matters for the "Your device" group; re-sorting on every pick is fine at this size.
  }, [query, now, value]);
  const flat = useMemo(() => groups.flatMap(([, zones]) => zones), [groups]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    setQuery("");
    if (!next) return;
    setNow(new Date());
    // Start on the selected zone so the list opens where the user is.
    requestAnimationFrame(() => {
      const i = flat.findIndex((z) => z.id === value);
      if (i >= 0) setActive(i);
      listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "center" });
    });
  };

  const pick = (z: Zone) => {
    setValue(z.id);
    onOpenChange(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, flat.length - 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(flat.length - 1);
    else if (e.key === "Enter" && flat[active]) pick(flat[active]);
    else return;
    e.preventDefault();
  };

  const selected = value ? zoneFromId(value) : null;
  let index = -1;

  return (
    <>
      <input type="hidden" name={name} value={value ?? ""} readOnly />
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            className="group flex h-12 w-full items-center gap-3 rounded-xl border border-input bg-card px-3.5 text-left text-[15px] shadow-xs outline-none transition-[border-color,box-shadow] hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=open]:border-ring data-[state=open]:ring-[3px] data-[state=open]:ring-ring/40"
          >
            <GlobeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {selected ? (
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="truncate font-medium">{selected.city}</span>
                <span className="hidden truncate text-sm text-muted-foreground sm:inline">{zoneName(selected.id, now)}</span>
              </span>
            ) : (
              <span className="flex-1 text-muted-foreground">Detecting…</span>
            )}
            {selected && <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{offsetLabel(selected.id, now)}</span>}
            <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-xl p-0 shadow-2xl shadow-black/20"
        >
          <div className="flex items-center gap-2 border-b px-3.5">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              role="combobox"
              aria-label="Search time zones"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
              autoComplete="off"
              spellCheck={false}
              placeholder="Search city, country or zone"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              className="h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground md:text-sm"
            />
          </div>
          <div ref={listRef} id={listId} role="listbox" aria-label="Time zones" className="max-h-[min(22rem,50dvh)] overflow-y-auto overscroll-contain px-1.5 pb-1.5">
            {flat.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No time zones match “{query}”.</p>}
            {groups.map(([region, zones]) => (
              <div key={region} role="group" aria-label={region}>
                <p className="sticky top-0 z-10 bg-popover px-2.5 pt-2.5 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {region}
                </p>
                {zones.map((z) => {
                  index += 1;
                  const i = index;
                  const isSelected = z.id === value;
                  return (
                    <div
                      key={z.id}
                      id={`${listId}-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={isSelected}
                      onMouseMove={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(z)}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm",
                        i === active && "bg-accent text-accent-foreground",
                      )}
                    >
                      <span className="grid size-4 shrink-0 place-items-center">{isSelected && <CheckIcon className="size-4 text-brand-ink" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{z.city}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[z.country, zoneName(z.id, now)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums">
                        <span className="block text-sm">{localTime(z.id, now)}</span>
                        <span className="block text-xs text-muted-foreground">{offsetLabel(z.id, now)}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { searchStations, getStation, type Station } from "@/lib/stations";
import { cn } from "@/lib/utils";

export function StationPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (icao: string) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => searchStations(query).slice(0, 12), [query]);
  const current = getStation(value);

  function choose(station: Station) {
    onChange(station.icao);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className={cn("relative w-full max-w-sm", className)}>
      <label className="mb-1 block text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
        Aerodrome
      </label>
      <Input
        value={open ? query : query || value}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const typed = query.trim().toUpperCase();
            const exact = matches.find((s) => s.icao === typed) ?? matches[0];
            if (exact) {
              e.preventDefault();
              choose(exact);
            }
          }
          if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
        placeholder="SCEL · Santiago"
        aria-label="Search ICAO station"
        autoComplete="off"
      />
      {current && !open ? (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {current.city} · {current.name}
        </p>
      ) : null}
      {open ? (
        <ul className="absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-lg bg-popover p-1 shadow-lg ring-1 ring-foreground/10">
          {matches.length === 0 ? (
            <li className="px-2 py-3 text-sm text-muted-foreground">
              No station matches that search. Try SCEL, SCFA, or SCTE.
            </li>
          ) : (
            matches.map((station) => (
              <li key={station.icao}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                    station.icao === value && "bg-muted"
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(station)}
                >
                  <span className="font-mono text-primary">{station.icao}</span>
                  <span className="truncate text-muted-foreground">
                    {station.city}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

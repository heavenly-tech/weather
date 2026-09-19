"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CloudSun,
  Layers3,
  Map,
  Menu,
  Mountain,
  Plane,
  Route,
  Wind,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StationPicker } from "@/components/station-picker";
import { DEFAULT_ICAO, getStation } from "@/lib/stations";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Briefing", icon: CloudSun },
  { href: "/metar-taf", label: "METAR / TAF", icon: Plane },
  { href: "/gramet", label: "GRAMET", icon: Route },
  { href: "/gamet", label: "GAMET", icon: Wind },
  { href: "/forecast", label: "WRF point", icon: Mountain },
  { href: "/synoptic", label: "Synoptic", icon: Map },
  { href: "/viz", label: "3D field", icon: Layers3 },
];

function formatZulu(d: Date) {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${dd}${hh}${mm}${ss}Z`;
}

function useUtcClock() {
  const [now, setNow] = useState(() => formatZulu(new Date()));
  useEffect(() => {
    const tick = () => setNow(formatZulu(new Date()));
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const icao = (search.get("icao") ?? DEFAULT_ICAO).toUpperCase();
  const station = getStation(icao);
  const zulu = useUtcClock();
  const [navOpen, setNavOpen] = useState(false);

  function setIcao(next: string) {
    const params = new URLSearchParams(search.toString());
    params.set("icao", next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  function hrefFor(href: string) {
    const params = new URLSearchParams();
    params.set("icao", icao);
    if (href === "/gramet") {
      params.set("from", search.get("from") ?? icao);
      params.set("to", search.get("to") ?? "SCTE");
    }
    if (href === "/gamet") {
      params.set("fir", search.get("fir") ?? (station?.fir === "INTL" ? "SANTIAGO" : station?.fir ?? "SANTIAGO"));
    }
    return `${href}?${params.toString()}`;
  }

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={hrefFor(item.href)}
            className={cn(
              buttonVariants({ variant: active ? "secondary" : "ghost" }),
              "justify-start gap-2"
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-full">
      <div className="mx-auto flex min-h-full w-full max-w-7xl">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border/70 bg-sidebar/80 p-4 backdrop-blur md:flex">
          <Link href={hrefFor("/")} className="mb-6 block">
            <p className="text-[11px] tracking-[0.28em] text-primary uppercase">Heavenly Weather</p>
            <p className="mt-1 font-heading text-lg leading-tight">Chile aviation desk</p>
          </Link>
          {nav}
          <p className="mt-auto pt-6 font-mono text-xs text-muted-foreground">
            No login. Public OPMET and model products only.
          </p>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border/70 bg-background/80 px-4 py-3 backdrop-blur md:px-6">
            <Sheet open={navOpen} onOpenChange={setNavOpen}>
              <Button
                variant="outline"
                size="icon"
                className="md:hidden"
                aria-label="Open navigation"
                onClick={() => setNavOpen(true)}
              >
                <Menu className="size-4" />
              </Button>
              <SheetContent side="left" className="w-72">
                <SheetHeader>
                  <SheetTitle>Heavenly Weather</SheetTitle>
                </SheetHeader>
                <div className="px-4 pb-4" onClick={() => setNavOpen(false)}>
                  {nav}
                </div>
              </SheetContent>
            </Sheet>
            <div className="min-w-0 flex-1">
              <StationPicker value={icao} onChange={setIcao} />
            </div>
            <div className="hidden text-right sm:block">
              <p className="font-mono text-sm text-primary" suppressHydrationWarning>
                {zulu}
              </p>
              <p className="text-[11px] tracking-widest text-muted-foreground uppercase">UTC</p>
            </div>
          </header>
          <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

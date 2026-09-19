"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { GrametChart } from "@/components/gramet-chart";
import { ProductEmpty, ProductError, ProductLoading } from "@/components/product-state";
import { SourceBadge } from "@/components/source-badge";
import { StationPicker } from "@/components/station-picker";
import { useProduct } from "@/hooks/use-product";
import { DEFAULT_ICAO } from "@/lib/stations";
import type { GrametProduct } from "@/lib/types";

const PRESETS = [
  { from: "SCEL", to: "SCTE", label: "Santiago → Puerto Montt" },
  { from: "SCEL", to: "SCFA", label: "Santiago → Antofagasta" },
  { from: "SCTE", to: "SCCI", label: "Puerto Montt → Punta Arenas" },
  { from: "SCEL", to: "SAEZ", label: "Santiago → Ezeiza" },
];

export default function GrametPage() {
  const search = useSearchParams();
  const router = useRouter();
  const icao = (search.get("icao") ?? DEFAULT_ICAO).toUpperCase();
  const from = (search.get("from") ?? icao).toUpperCase();
  const to = (search.get("to") ?? "SCTE").toUpperCase();
  const product = useProduct<GrametProduct>(`/api/gramet?from=${from}&to=${to}`);

  function setRoute(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams(search.toString());
    params.set("from", nextFrom);
    params.set("to", nextTo);
    params.set("icao", nextFrom);
    router.replace(`/gramet?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] tracking-[0.28em] text-primary uppercase">Route sounding</p>
        <h1 className="mt-1 font-heading text-3xl">GRAMET</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          A graphical route METAR: GFS pressure-level winds, temperatures, and cloud along the great-circle from
          departure to arrival. Official GRAMET images are not published on a public Chilean HTTP feed, so this
          desk builds the same briefing from Open-Meteo.
        </p>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <StationPicker value={from} onChange={(v) => setRoute(v, to)} />
        <StationPicker value={to} onChange={(v) => setRoute(from, v)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button key={p.label} variant="outline" size="sm" onClick={() => setRoute(p.from, p.to)}>
            {p.label}
          </Button>
        ))}
      </div>

      {product.status === "loading" ? <ProductLoading rows={2} /> : null}
      {product.status === "empty" ? (
        <ProductEmpty title="Choose a route" body="Set departure and arrival ICAO identifiers." />
      ) : null}
      {product.status === "error" ? <ProductError title="GRAMET failed" body={product.message} /> : null}
      {product.status === "ready" ? (
        <div className="space-y-3">
          <SourceBadge source={product.envelope.source} label={product.envelope.sourceLabel} />
          {product.envelope.warning ? <p className="text-xs text-amber-200">{product.envelope.warning}</p> : null}
          <GrametChart product={product.envelope.data} />
        </div>
      ) : null}
    </div>
  );
}

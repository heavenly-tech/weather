"use client";

import { useState } from "react";
import { ProductMeta } from "@/components/product-meta";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProductEnvelope, SynopticProduct } from "@/lib/types";

export function SynopticDesk({ envelope }: { envelope: ProductEnvelope<SynopticProduct[]> }) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] tracking-[0.28em] text-primary uppercase">Continental analysis</p>
        <h1 className="mt-1 font-heading text-3xl">Synoptic charts</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          NOAA Weather Prediction Center International Desk surface analyses and day-1/2 forecasts for South
          America. Charts are proxied so a reverse proxy at weather.heavenly.cl can serve them without mixing
          origins. These are analysis products, not Chilean SIGWX charts.
        </p>
      </div>

      <div className="space-y-4">
        <ProductMeta envelope={envelope} />
        <div className="grid gap-4 lg:grid-cols-2">
          {envelope.data.map((chart) => (
            <Card key={chart.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3">
                  <span>{chart.title}</span>
                  <span className="font-mono text-xs text-primary">{chart.cycle}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{chart.description}</p>
                {failed[chart.id] ? (
                  <div className="rounded-lg bg-muted/40 p-4 text-sm">
                    <p>The {chart.cycle} chart did not load from WPC.</p>
                    <Button
                      className="mt-2"
                      variant="outline"
                      size="sm"
                      render={<a href={chart.origin} target="_blank" rel="noreferrer" />}
                    >
                      Open at NOAA
                    </Button>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={chart.imagePath}
                    alt={chart.title}
                    className="w-full rounded-md bg-white"
                    onError={() => setFailed((prev) => ({ ...prev, [chart.id]: true }))}
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

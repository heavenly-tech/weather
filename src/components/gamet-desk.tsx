"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductEmpty } from "@/components/product-state";
import { ProductMeta } from "@/components/product-meta";
import { DEFAULT_ICAO, FIRS } from "@/lib/stations";
import type { ChileFirId, GametBulletin, ProductEnvelope } from "@/lib/types";
import { formatUtc } from "@/lib/format";

export function GametDesk({
  fir,
  envelope,
}: {
  fir: ChileFirId;
  envelope: ProductEnvelope<GametBulletin>;
}) {
  const search = useSearchParams();
  const icao = (search.get("icao") ?? DEFAULT_ICAO).toUpperCase();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] tracking-[0.28em] text-primary uppercase">Low-level area forecast</p>
        <h1 className="mt-1 font-heading text-3xl">GAMET</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          DGAC issues official GAMET on the OPMET/AFTN circuit, not a public JSON API. This page builds a
          GAMET-style bulletin from GFS and any international SIGMETs that intersect Chile, then labels it
          derived so it is never confused with the signed DMC product.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FIRS.map((item) => (
          <Button
            key={item.id}
            variant={item.id === fir ? "default" : "outline"}
            size="sm"
            render={<Link href={`/gamet?icao=${icao}&fir=${item.id}`} scroll={false} />}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {envelope.data ? (
        <div className="space-y-3">
          <ProductMeta envelope={envelope} />
          <p className="text-sm text-muted-foreground">
            Valid {formatUtc(envelope.data.validFrom)} → {formatUtc(envelope.data.validTo)}
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {envelope.data.sections.map((section) => (
              <Card key={section.title}>
                <CardHeader>
                  <CardTitle>{section.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {section.lines.map((line) => (
                      <li key={line} className="wx-raw">
                        {line}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Raw bulletin</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="wx-raw whitespace-pre-wrap">{envelope.data.raw}</pre>
            </CardContent>
          </Card>
        </div>
      ) : (
        <ProductEmpty title="No GAMET" body="Select a Chilean FIR." />
      )}
    </div>
  );
}

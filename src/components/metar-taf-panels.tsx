import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FlightCategoryBadge } from "@/components/flight-category-badge";
import { formatTemp, formatUtc, formatWind } from "@/lib/format";
import { formatVisM } from "@/lib/visibility";
import type { MetarObservation, TafForecast } from "@/lib/types";

export function MetarPanel({ metar }: { metar: MetarObservation }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-primary">{metar.icao}</span>
          <span>{metar.name}</span>
          <FlightCategoryBadge category={metar.flightCategory} icao={metar.icao} size="lg" />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Observed</dt>
            <dd>{formatUtc(metar.observedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Wind</dt>
            <dd>{formatWind(metar.windDirDeg, metar.windKt, metar.gustKt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Visibility</dt>
            <dd>{formatVisM(metar.visM)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Temp / dewpoint</dt>
            <dd>
              {formatTemp(metar.tempC)} / {formatTemp(metar.dewpointC)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">QNH</dt>
            <dd>{metar.altimeterHpa ? `${metar.altimeterHpa} hPa` : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Ceiling</dt>
            <dd>
              {metar.clouds.length
                ? metar.clouds.map((c) => `${c.cover}${c.baseFt ?? ""}`).join(" ")
                : metar.cover ?? "—"}
            </dd>
          </div>
        </dl>
        <pre className="wx-raw rounded-lg bg-background/60 p-3 ring-1 ring-foreground/10">{metar.raw || "No raw METAR."}</pre>
      </CardContent>
    </Card>
  );
}

export function TafPanel({ taf }: { taf: TafForecast }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-primary">{taf.icao}</span>
          <span>TAF</span>
          <span className="text-sm font-normal text-muted-foreground">
            {formatUtc(taf.validFrom)} → {formatUtc(taf.validTo)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <pre className="wx-raw rounded-lg bg-background/60 p-3 ring-1 ring-foreground/10">{taf.raw || "No raw TAF."}</pre>
        <div className="grid gap-2">
          {taf.periods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decoded periods on this bulletin.</p>
          ) : (
            taf.periods.map((p, i) => (
              <div
                key={`${p.from}-${i}`}
                className="grid gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm md:grid-cols-[7rem_auto_1fr] md:items-center"
              >
                <div className="font-mono text-xs text-primary">
                  {p.change ?? "BASE"}
                  {p.probability ? ` ${p.probability}%` : ""}
                </div>
                <FlightCategoryBadge category={p.flightCategory} icao={taf.icao} size="sm" />
                <div className="text-muted-foreground">
                  {formatUtc(p.from)} · {formatWind(p.windDirDeg, p.windKt)} · vis {formatVisM(p.visM)}
                  {p.wx ? ` · ${p.wx}` : ""} ·{" "}
                  {p.clouds.map((c) => `${c.cover}${c.baseFt ?? ""}`).join(" ") || "NSC"}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

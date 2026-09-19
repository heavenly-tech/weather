import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FlightCategoryBadge } from "@/components/flight-category-badge";
import { ProductMeta } from "@/components/product-meta";
import { DEFAULT_ICAO, getStation } from "@/lib/stations";
import { formatVisM, ceilingFtFromClouds } from "@/lib/visibility";
import {
  CHILE_CLASS_G_AIRPLANE_VIS_M,
  CHILE_CLASS_G_HELI_VIS_M,
  CHILE_CTR_VFR_CEIL_FT,
  CHILE_CTR_VFR_CEIL_M,
  CHILE_CTR_VFR_VIS_M,
  CHILE_SVFR_AIRPLANE_CEIL_FT,
  CHILE_SVFR_AIRPLANE_CEIL_M,
  CHILE_SVFR_AIRPLANE_VIS_M,
  CHILE_SVFR_HELI_VIS_M,
  metarChileFit,
} from "@/lib/chile-vfr";
import { loadMetar, normalizeIcao } from "@/lib/products";
import { formatUtc } from "@/lib/format";

export const dynamic = "force-dynamic";

const FIT_COPY = {
  "ctr-vfr":
    "This observation is at or above the published Chile CTR VFR takeoff/landing figures (5 km and 450 m / 1 500 ft ceiling). That is a weather check only — ATC, airspace class, and your ops specs still apply.",
  "svfr-window":
    "Vis or ceiling is below Chile CTR VFR, but still at or above the published airplane Special VFR figures (2 000 m and 350 m / 1 150 ft). SVFR is an ATC authorization in a CTR, daytime, approach category A or B — not an automatic clearance.",
  "below-svfr":
    "This observation is below the published airplane Special VFR visibility or ceiling. Do not treat SVFR as available from the METAR alone.",
  unknown: "Visibility is missing on this bulletin, so the Chile margin check cannot run.",
} as const;

export default async function VfrSvfrPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const icao = normalizeIcao(params.icao, DEFAULT_ICAO);
  const station = getStation(icao);
  const metar = await loadMetar(icao);
  const fit = metar.data ? metarChileFit(metar.data) : "unknown";
  const ceiling = metar.data ? ceilingFtFromClouds(metar.data.clouds) : null;

  return (
    <div className="space-y-6">
      <div className="max-w-3xl space-y-2">
        <p className="text-[11px] tracking-[0.28em] text-primary uppercase">Chile visual margins</p>
        <h1 className="font-heading text-3xl tracking-tight md:text-4xl">
          VFR and Special VFR weather margins in Chile
        </h1>
        <p className="text-muted-foreground">
          Ceiling and visibility figures used for VFR and Special VFR (VFR Especial / SVFR) under Chilean
          rules. This page is a briefing aid for the desk. It is not a certified source and it does not
          replace the current AIP Chile, DAN 91, or ATC.
        </p>
      </div>

      <Card className="ring-amber-400/35">
        <CardHeader>
          <CardTitle>Not a certified briefing source</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Pilots must check the current{" "}
            <a className="text-primary underline-offset-4 hover:underline" href="https://aipchile.dgac.gob.cl">
              AIP Chile
            </a>{" "}
            (ENR 1.2) and{" "}
            <a className="text-primary underline-offset-4 hover:underline" href="https://www.dgac.gob.cl">
              DGAC DAN 91
            </a>{" "}
            before flying. ATS may publish higher aerodrome minima. Operator manuals can be tighter. Night
            VFR is a separate DAN 91.205 regime.
          </p>
          <p>
            Numbers below follow AIP Chile ENR 1.2 (AMDT 67, 06 AUG 2026) and DAN 91 §§91.201 / 91.203
            (VFR diurno / VFR Especial). If a figure is not clearly published, it is marked.
          </p>
        </CardContent>
      </Card>

      {metar.data ? (
        <div className="space-y-3">
          <ProductMeta envelope={metar} />
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-primary">{metar.data.icao}</span>
                <span>{station?.city ?? metar.data.name}</span>
                <FlightCategoryBadge category={metar.data.flightCategory} icao={icao} size="lg" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <dl className="grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Observed</dt>
                  <dd>{formatUtc(metar.data.observedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Visibility</dt>
                  <dd>{formatVisM(metar.data.visM)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Ceiling (BKN/OVC/VV)</dt>
                  <dd>{ceiling != null ? `${ceiling} ft` : "No ceiling in the METAR"}</dd>
                </div>
              </dl>
              <p>{FIT_COPY[fit]}</p>
              <p className="text-xs text-muted-foreground">
                The VFR / MVFR / IFR / LIFR tag is the NOAA/FAA flight-category mark from ceiling and
                visibility. It is not a Chilean legal category. Tap it from any METAR or TAF period to
                return here.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Chile VFR takeoff and landing</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/70">
                <th className="py-2 pr-3 font-medium">Situation</th>
                <th className="py-2 pr-3 font-medium">Ceiling</th>
                <th className="py-2 pr-3 font-medium">Visibility</th>
                <th className="py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-b border-border/40">
                <td className="py-3 pr-3">
                  Controlled aerodrome inside a CTR (no SVFR authorization)
                </td>
                <td className="py-3 pr-3 font-mono">
                  ≥ {CHILE_CTR_VFR_CEIL_M} m / {CHILE_CTR_VFR_CEIL_FT} ft
                </td>
                <td className="py-3 pr-3 font-mono">≥ {CHILE_CTR_VFR_VIS_M} m (5 km)</td>
                <td className="py-3 text-muted-foreground">DAN 91.201(b) · AIP ENR 1.2 §2</td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-3 pr-3">Controlled aerodrome outside a CTR</td>
                <td className="py-3 pr-3 text-muted-foreground">ATS-prescribed</td>
                <td className="py-3 pr-3 font-mono">
                  ≥ {CHILE_CLASS_G_AIRPLANE_VIS_M} m (floor; ATS may require more)
                </td>
                <td className="py-3 text-muted-foreground">DAN 91.201(c)</td>
              </tr>
              <tr>
                <td className="py-3 pr-3">Uncontrolled aerodrome in Class G</td>
                <td className="py-3 pr-3 text-muted-foreground">
                  Not a separate published T/O–landing ceiling; remain in sight of surface
                </td>
                <td className="py-3 pr-3 font-mono">
                  ≥ {CHILE_CLASS_G_AIRPLANE_VIS_M} m airplanes · ≥ {CHILE_CLASS_G_HELI_VIS_M} m
                  helicopters
                </td>
                <td className="py-3 text-muted-foreground">DAN 91.201(d)</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Special VFR (VFR Especial)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            SVFR is an ATC authorization that lets you enter or leave a CTR to land or take off at a
            controlled aerodrome inside it when weather is below the CTR VFR figures. It is not a
            clearance to cruise across the CTR for some other purpose.
          </p>
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/70">
                <th className="py-2 pr-3 font-medium">Item</th>
                <th className="py-2 font-medium">Published Chile figure</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-b border-border/40">
                <td className="py-3 pr-3">Airplane visibility</td>
                <td className="py-3 font-mono">≥ {CHILE_SVFR_AIRPLANE_VIS_M} m</td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-3 pr-3">Helicopter visibility</td>
                <td className="py-3 font-mono">≥ {CHILE_SVFR_HELI_VIS_M} m</td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-3 pr-3">Airplane ceiling</td>
                <td className="py-3 font-mono">
                  ≥ {CHILE_SVFR_AIRPLANE_CEIL_M} m / {CHILE_SVFR_AIRPLANE_CEIL_FT} ft
                </td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-3 pr-3">Helicopter ceiling</td>
                <td className="py-3 text-muted-foreground">
                  Not stated as a separate number in AIP ENR 1.2 §9.1 (the 350 m / 1 150 ft figure is
                  written for airplane operations). Confirm with the current AIP and ATC.
                </td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-3 pr-3">When</td>
                <td className="py-3">Day only: CCCM to FCCV (morning to evening civil twilight)</td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-3 pr-3">Where</td>
                <td className="py-3">Enter or leave a CTR to land or take off inside it</td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-3 pr-3">Aircraft</td>
                <td className="py-3">Approach category A or B only</td>
              </tr>
              <tr>
                <td className="py-3 pr-3">In flight</td>
                <td className="py-3">
                  Free of cloud, in sight of land or water, two-way ATC. Separation is provided versus
                  IFR.
                </td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">DAN 91.203 · AIP ENR 1.2 §9.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>En-route VMC (AIP Table 1) — short form</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/70">
                <th className="py-2 pr-3 font-medium">Airspace / band</th>
                <th className="py-2 pr-3 font-medium">Flight visibility</th>
                <th className="py-2 font-medium">Distance from cloud</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-b border-border/40">
                <td className="py-3 pr-3">B, C, D, E, G at or above FL 100</td>
                <td className="py-3 pr-3 font-mono">8 km</td>
                <td className="py-3">
                  Class B: clear of cloud. C–D–E–G: 1 500 m horizontal, 300 m vertical
                </td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-3 pr-3">B, C, D, E, G below FL 100</td>
                <td className="py-3 pr-3 font-mono">5 km</td>
                <td className="py-3">Same cloud distances as the band above</td>
              </tr>
              <tr>
                <td className="py-3 pr-3">Class G at or below 600 m / 2 000 ft AGL</td>
                <td className="py-3 pr-3 font-mono">2 000 m airplanes · 500 m helicopters</td>
                <td className="py-3">Clear of cloud and in sight of land or water</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">
            VFR is not permitted in Class A. VFR is not planned above FL 195 (FL 245 in the Easter
            Island FIR) unless ATS authorizes it. Full table: AIP Chile ENR 1.2 Table 1.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How the VFR / MVFR / IFR / LIFR tags relate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Those marks are the NOAA Aviation Weather Center / FAA flight-category bins (statute-mile
            and foot thresholds). This desk keeps the tag and converts the METAR visibility back to
            metres so it matches the Chilean raw report (9999, 5000, 3000…).
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="text-foreground">VFR tag</span> — usually above Chile CTR VFR (5 km /
              1 500 ft). Still confirm the actual metres and ceiling.
            </li>
            <li>
              <span className="text-foreground">MVFR tag</span> — FAA bin for 3–5 SM or a 1 000–3 000
              ft ceiling. Chile CTR VFR is 5 km, not 5 SM (5 SM is about 8 km), so an MVFR mark can
              still be legal Chile VFR if visibility is ≥ 5 000 m and the ceiling is ≥ 1 500 ft. If
              visibility is 3 000–4 999 m at a CTR, you are below VFR and in the SVFR window only if
              visibility stays ≥ 2 000 m and the ceiling stays ≥ 1 150 ft.
            </li>
            <li>
              <span className="text-foreground">IFR tag</span> — often inside or below the SVFR
              window. Compare the decoded metres and ceiling to 2 000 m / 1 150 ft; do not assume
              SVFR from the tag.
            </li>
            <li>
              <span className="text-foreground">LIFR tag</span> — typically below airplane SVFR
              (vis &lt; 1 SM ≈ 1 600 m, or ceiling &lt; 500 ft).
            </li>
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link className={buttonVariants()} href={`/?icao=${icao}`}>
          Back to {icao} briefing
        </Link>
        <Link className={buttonVariants({ variant: "outline" })} href={`/metar-taf?icao=${icao}`}>
          Full METAR / TAF
        </Link>
      </div>
    </div>
  );
}

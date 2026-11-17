/**
 * Fetch AWC METARs + Open-Meteo past_days model hours for SCEL, run ceiling algorithm, emit fixtures + PNG.
 * Usage: npx tsx scripts/validate-ceilings.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseAwcMetar } from "../src/lib/awc";
import { ceilingCategoryFromFtAgl, ceilingFromHourly } from "../src/lib/andes/ceiling";
import { ANDES_MODELS, hourlyVariablesForModel, modelById } from "../src/lib/andes/models";
import type { AndesModelId } from "../src/lib/andes/models";
import { ceilingFtFromClouds } from "../src/lib/visibility";
import type { FlightCategory } from "../src/lib/types";

const SCEL = { lat: -33.393, lon: -70.786, elevM: 474, icao: "SCEL" };
const PAST_DAYS = 3;
const OUT_DIR = path.join(
  process.cwd(),
  "docs",
  "validation",
  `scel-${new Date().toISOString().slice(0, 10)}`
);

type Hourly = Record<string, Array<number | null> | string[]>;

/** Align to Open-Meteo hourly key format */
function metarHourKey(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `${y}-${mo}-${dd}T${hh}:00`;
}

function hourIndex(times: string[], key: string): number {
  return times.findIndex((t) => t === key);
}

async function fetchMetars(icao: string, hours: number) {
  const url = `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=${hours}`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "heavenly-weather-validate/1.0" },
  });
  if (!res.ok) throw new Error(`AWC METAR HTTP ${res.status}`);
  return (await res.json()) as unknown[];
}

async function fetchModelPast(model: AndesModelId) {
  const meta = modelById(model)!;
  const params = new URLSearchParams({
    latitude: String(SCEL.lat),
    longitude: String(SCEL.lon),
    hourly: hourlyVariablesForModel(meta),
    models: meta.query,
    timezone: "UTC",
    past_days: String(PAST_DAYS),
    forecast_days: "0",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const res = await fetch(url, {
    headers: { "user-agent": "heavenly-weather-validate/1.0 (open-meteo terms)" },
  });
  if (!res.ok) throw new Error(`Open-Meteo ${model}: HTTP ${res.status}`);
  return (await res.json()) as {
    elevation?: number;
    hourly: Hourly;
  };
}

function categoryFromMetar(ceil: number | null, flt: FlightCategory): FlightCategory {
  if (ceil == null) return flt === "UNK" ? "VFR" : flt;
  return ceilingCategoryFromFtAgl(ceil);
}

function writeSvgChart(
  rows: {
    time: string;
    metarFt: number | null;
    gfs: number | null;
    ecmwf: number | null;
    icon: number | null;
    gem: number | null;
  }[]
): string {
  const W = 900;
  const H = 320;
  const pad = 40;
  const maxY = 8000;
  const minT = new Date(rows[0]!.time).getTime();
  const maxT = new Date(rows[rows.length - 1]!.time).getTime() || minT + 1;
  const sx = (t: string) => pad + ((new Date(t).getTime() - minT) / (maxT - minT)) * (W - 2 * pad);
  const sy = (ft: number | null) => (ft == null ? H - pad : H - pad - (Math.min(maxY, ft) / maxY) * (H - 2 * pad));

  const series: { key: keyof (typeof rows)[0]; color: string }[] = [
    { key: "gfs", color: "#38bdf8" },
    { key: "ecmwf", color: "#a78bfa" },
    { key: "icon", color: "#34d399" },
    { key: "gem", color: "#f472b6" },
  ];

  function poly(key: keyof (typeof rows)[0]) {
    return rows
      .filter((r) => r[key] != null)
      .map((r, i) => `${i === 0 ? "M" : "L"} ${sx(r.time)} ${sy(r[key] as number | null)}`)
      .join(" ");
  }

  const dots = rows
    .filter((r) => r.metarFt != null)
    .map((r) => `<circle cx="${sx(r.time)}" cy="${sy(r.metarFt)}" r="3" fill="#fbbf24"/>`)
    .join("");

  const lines = series
    .map((s) => `<path d="${poly(s.key)}" fill="none" stroke="${s.color}" stroke-width="1.5"/>`)
    .join("\n");

  return `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="100%" height="100%" fill="#0f172a"/>
  <text x="${pad}" y="24" fill="#e2e8f0" font-size="14">SCEL ceiling (ft): METAR (dots) vs models — ${rows[0]?.time.slice(0, 10)} validation run</text>
  <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#475569"/>
  <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" stroke="#475569"/>
  ${lines}
  ${dots}
</svg>`;
}

async function svgToPng(svgPath: string, pngPath: string) {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 920, height: 340 } });
    await page.goto(pathToFileURL(svgPath).href);
    await page.screenshot({ path: pngPath, type: "png" });
    await browser.close();
  } catch (err) {
    console.warn("PNG render skipped (playwright):", err);
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const metarRows = await fetchMetars(SCEL.icao, 72);
  await fs.writeFile(path.join(OUT_DIR, "awc-metars-scel.json"), JSON.stringify(metarRows, null, 2));
  const scvmRows = await fetchMetars("SCVM", 72);
  await fs.writeFile(path.join(OUT_DIR, "awc-metars-scvm.json"), JSON.stringify(scvmRows, null, 2));
  const scpdRows = await fetchMetars("SCPD", 72);
  await fs.writeFile(path.join(OUT_DIR, "awc-metars-scpd.json"), JSON.stringify(scpdRows, null, 2));

  const metars = metarRows.map((r) => parseAwcMetar(r as Parameters<typeof parseAwcMetar>[0]));
  const byHour = new Map<string, (typeof metars)[0]>();
  for (const m of metars) {
    const key = metarHourKey(m.observedAt);
    if (key) byHour.set(key, m);
  }

  const modelHourly: Record<AndesModelId, Hourly> = {} as Record<AndesModelId, Hourly>;
  const elevByModel: Record<string, number> = {};

  for (const meta of ANDES_MODELS) {
    const data = await fetchModelPast(meta.id);
    modelHourly[meta.id] = data.hourly;
    elevByModel[meta.id] = data.elevation ?? SCEL.elevM;
    await fs.writeFile(
      path.join(OUT_DIR, `open-meteo-${meta.id}-scel.json`),
      JSON.stringify(data, null, 2)
    );
    await new Promise((r) => setTimeout(r, 300));
  }

  const refTimes = (modelHourly.gfs_seamless.time ?? []) as string[];
  const sampleEvery = 3;
  const comparison: {
    time: string;
    metarRaw: string | null;
    metarCeilFt: number | null;
    metarCat: FlightCategory;
    models: Record<AndesModelId, { ceilFt: number | null; cat: FlightCategory }>;
  }[] = [];

  for (let i = 0; i < refTimes.length; i += sampleEvery) {
    const time = refTimes[i]!;
    const metar = byHour.get(time);
    const metarCeil = metar ? ceilingFtFromClouds(metar.clouds) : null;
    const metarCat = metar ? categoryFromMetar(metarCeil, metar.flightCategory) : "UNK";

    const models = {} as Record<AndesModelId, { ceilFt: number | null; cat: FlightCategory }>;
    for (const meta of ANDES_MODELS) {
      const hourly = modelHourly[meta.id];
      const times = (hourly.time ?? []) as string[];
      const idx = hourIndex(times, time);
      if (idx < 0) {
        models[meta.id] = { ceilFt: null, cat: "UNK" };
        continue;
      }
      const sample = ceilingFromHourly(hourly, idx, elevByModel[meta.id] ?? SCEL.elevM, meta.cloudBaseField);
      models[meta.id] = {
        ceilFt: sample.ceilingFtAgl,
        cat: sample.ceilingCategory,
      };
    }

    if (!metar && Object.values(models).every((m) => m.ceilFt == null)) continue;

    comparison.push({
      time,
      metarRaw: metar?.raw ?? null,
      metarCeilFt: metarCeil,
      metarCat,
      models,
    });
  }

  const stats: Record<
    AndesModelId,
    { categoryHit: number; categoryTotal: number; maeFt: number | null; maeCount: number }
  > = {} as Record<
    AndesModelId,
    { categoryHit: number; categoryTotal: number; maeFt: number | null; maeCount: number }
  >;

  for (const meta of ANDES_MODELS) {
    let hits = 0;
    let total = 0;
    let errSum = 0;
    let errN = 0;
    for (const row of comparison) {
      if (row.metarCeilFt == null) continue;
      const mod = row.models[meta.id];
      if (mod.ceilFt == null) continue;
      total++;
      if (mod.cat === row.metarCat) hits++;
      if (row.metarCeilFt < 10_000 && mod.ceilFt < 10_000) {
        errSum += Math.abs(mod.ceilFt - row.metarCeilFt);
        errN++;
      }
    }
    stats[meta.id] = {
      categoryHit: hits,
      categoryTotal: total,
      maeFt: errN ? errSum / errN : null,
      maeCount: errN,
    };
  }

  const chartRows = comparison.map((r) => ({
    time: r.time,
    metarFt: r.metarCeilFt,
    gfs: r.models.gfs_seamless.ceilFt,
    ecmwf: r.models.ecmwf_ifs025.ceilFt,
    icon: r.models.icon_seamless.ceilFt,
    gem: r.models.gem_seamless.ceilFt,
  }));

  const svg = writeSvgChart(chartRows);
  const svgPath = path.join(OUT_DIR, "ceiling-comparison.svg");
  const pngPath = path.join(OUT_DIR, "ceiling-comparison.png");
  await fs.writeFile(svgPath, svg);
  await svgToPng(svgPath, pngPath);

  const summary = {
    generatedAt: new Date().toISOString(),
    station: SCEL.icao,
    pastDays: PAST_DAYS,
    metarCount: metars.length,
    comparisonRows: comparison.length,
    stats,
    notes:
      "Open-Meteo past_days provides archived hourly model states at SCEL coordinates; METAR from AWC. Category hits require both sides to have a ceiling or matching unlimited.",
    comparison,
  };

  await fs.writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  await fs.writeFile(
    path.join(OUT_DIR, "stats-table.md"),
    [
      "| Model | Category hit rate | Mean |ceil err| (ft), both <10k ft | N |",
      "| --- | ---: | ---: | ---: |",
      ...ANDES_MODELS.map((m) => {
        const s = stats[m.id];
        const rate = s.categoryTotal ? `${((100 * s.categoryHit) / s.categoryTotal).toFixed(1)}%` : "—";
        const mae = s.maeFt != null ? s.maeFt.toFixed(0) : "—";
        return `| ${m.label} | ${rate} (${s.categoryHit}/${s.categoryTotal}) | ${mae} | ${s.maeCount} |`;
      }),
    ].join("\n")
  );

  console.log("Wrote", OUT_DIR);
  console.log(await fs.readFile(path.join(OUT_DIR, "stats-table.md"), "utf8"));
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
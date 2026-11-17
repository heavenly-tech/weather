import { NextResponse } from "next/server";
import { andesAirfield } from "@/lib/andes/airfields";
import { coherenceView } from "@/lib/andes/coherence";
import { fetchPointHourly } from "@/lib/andes/fetch-field";
import type { AndesModelId } from "@/lib/andes/models";
import { loadMetar, loadTaf } from "@/lib/products";
import { pickHourIndex } from "@/lib/open-meteo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const icao = (searchParams.get("icao") ?? "SCEL").toUpperCase();
  const model = (searchParams.get("model") ?? "gfs_seamless") as AndesModelId;
  const field = andesAirfield(icao);
  if (!field) return NextResponse.json({ error: "unknown field" }, { status: 400 });

  const [metarEnv, tafEnv, fetched] = await Promise.all([
    loadMetar(icao),
    loadTaf(icao),
    fetchPointHourly(model, field.lat, field.lon, 1),
  ]);

  if (!fetched.ok || !fetched.meta) {
    return NextResponse.json({ error: fetched.error ?? "model down" }, { status: 502 });
  }

  const times = fetched.runTimes;
  const index = pickHourIndex(times);
  const runTime = new Date().toISOString();
  const view = coherenceView(
    fetched.hourly,
    index,
    field.elevM,
    fetched.meta.cloudBaseField,
    metarEnv.data,
    tafEnv.data,
    model,
    runTime
  );

  return NextResponse.json({
    views: {
      modelVsMetar: view,
      modelTafVsOfficial: { model: view.modelTafRaw, official: view.officialTafRaw },
      officialTafVsMetar: {
        taf: view.officialTafRaw,
        metar: metarEnv.data.raw,
      },
    },
  });
}
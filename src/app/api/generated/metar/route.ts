import { NextResponse } from "next/server";
import { andesAirfield } from "@/lib/andes/airfields";
import { fetchPointHourly } from "@/lib/andes/fetch-field";
import { generateModelMetar } from "@/lib/andes/generated-metar";
import { parseAndesModelId } from "@/lib/andes/models";
import { newLogId, productLogStore } from "@/lib/andes/product-log";
import { pickHourIndex } from "@/lib/open-meteo";
import { requireStation } from "@/lib/stations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const icao = (searchParams.get("icao") ?? "SCTB").toUpperCase();
  const model = parseAndesModelId(searchParams.get("model"));
  if (!model) return NextResponse.json({ error: "Invalid model" }, { status: 400 });
  const custom = andesAirfield(icao);
  const station = custom ?? requireStation(icao);
  const lat = station.lat;
  const lon = station.lon;
  const elevM = station.elevM;

  const fetched = await fetchPointHourly(model, lat, lon, { forecastHours: 48, pastHours: 0 });
  if (!fetched.ok || !fetched.meta) {
    return NextResponse.json({ error: fetched.error ?? "model unavailable" }, { status: 502 });
  }

  const times = fetched.runTimes;
  const index = pickHourIndex(times);
  const runTime = new Date().toISOString();
  const validTime = times[index] ?? runTime;
  const generated = generateModelMetar({
    icao,
    elevM,
    model,
    runTime,
    validTime,
    hourly: fetched.hourly,
    hourIndex: index,
  });

  const entry = {
    id: newLogId(),
    kind: "METAR" as const,
    model,
    runTime,
    validTime,
    point: { lat, lon, icao },
    raw: generated.raw,
    createdAt: runTime,
  };
  await productLogStore().append(entry);

  return NextResponse.json({ ...generated, logId: entry.id, stamp: generated.stamp });
}
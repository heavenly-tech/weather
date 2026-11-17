import { NextResponse } from "next/server";
import { andesAirfield } from "@/lib/andes/airfields";
import { fetchPointHourly } from "@/lib/andes/fetch-field";
import { generateModelTaf } from "@/lib/andes/generated-taf";
import { parseAndesModelId } from "@/lib/andes/models";
import { newLogId, productLogStore } from "@/lib/andes/product-log";
import { requireStation } from "@/lib/stations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const icao = (searchParams.get("icao") ?? "SCTB").toUpperCase();
  const model = parseAndesModelId(searchParams.get("model"));
  if (!model) return NextResponse.json({ error: "Invalid model" }, { status: 400 });
  const field = andesAirfield(icao) ?? requireStation(icao);
  const lat = field.lat;
  const lon = field.lon;
  const elevM = field.elevM;

  const fetched = await fetchPointHourly(model, lat, lon, 1);
  if (!fetched.ok || !fetched.meta) {
    return NextResponse.json({ error: fetched.error ?? "model unavailable" }, { status: 502 });
  }

  const runTime = new Date().toISOString();
  const generated = generateModelTaf({
    icao,
    elevM,
    model,
    runTime,
    hourly: fetched.hourly,
  });
  if ("error" in generated) {
    return NextResponse.json({ error: generated.error }, { status: 400 });
  }

  const times = (fetched.hourly.time ?? []) as string[];
  const entry = {
    id: newLogId(),
    kind: "TAF" as const,
    model,
    runTime,
    validTime: times[0] ?? runTime,
    point: { lat, lon, icao },
    raw: generated.raw,
    createdAt: runTime,
  };
  await productLogStore().append(entry);

  return NextResponse.json({ ...generated, logId: entry.id, stamp: generated.stamp });
}
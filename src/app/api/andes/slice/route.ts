import { NextResponse } from "next/server";
import { fetchPointHourly, sliceAtPressure } from "@/lib/andes/fetch-field";
import { parseAndesModelId } from "@/lib/andes/models";
import { defaultGridShape, domainGrid } from "@/lib/andes/domain";
import { fetchMultiBatched } from "@/lib/andes/batch-fetch";
import { pickHourIndex } from "@/lib/open-meteo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const model = parseAndesModelId(searchParams.get("model"));
  if (!model) return NextResponse.json({ error: "Invalid model" }, { status: 400 });
  const hpa = Number(searchParams.get("hpa") ?? "850");
  const validTime = searchParams.get("validTime");

  const grid = domainGrid();
  const batched = await fetchMultiBatched(grid, model, 1);
  if (!batched.ok) {
    return NextResponse.json({ unavailable: batched.error, values: [], gridShape: defaultGridShape() });
  }

  const list = batched.list;
  const values = list.map((point) => {
    const hourly = point.hourly ?? {};
    const times = (hourly.time ?? []) as string[];
    const index = validTime ? pickHourIndex(times, new Date(validTime)) : pickHourIndex(times);
    const slice = sliceAtPressure(hourly, index, hpa);
    return { lat: point.latitude, lon: point.longitude, ...slice };
  });

  const center = await fetchPointHourly(model, -33.456, -70.546, 1);
  let sliceHeightM: number | null = null;
  if (center.ok) {
    const hourly = center.hourly;
    const times = center.runTimes;
    const idx = validTime ? pickHourIndex(times, new Date(validTime)) : pickHourIndex(times);
    const gh = hourly[`geopotential_height_${hpa}hPa`]?.[idx];
    sliceHeightM = typeof gh === "number" ? gh : null;
  }
  return NextResponse.json({
    pressureHpa: hpa,
    values,
    gridShape: defaultGridShape(),
    sliceHeightM,
    validTime: validTime ?? (center.ok ? center.runTimes[0] : null),
  });
}
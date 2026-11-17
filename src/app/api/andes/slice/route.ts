import { NextResponse } from "next/server";
import { fetchPointHourly, sliceAtPressure } from "@/lib/andes/fetch-field";
import type { AndesModelId } from "@/lib/andes/models";
import { domainGrid } from "@/lib/andes/domain";
import { asList, fetchOpenMeteo, pickHourIndex } from "@/lib/open-meteo";
import { openMeteoMultiUrl } from "@/lib/andes/models";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const model = (searchParams.get("model") ?? "gfs_seamless") as AndesModelId;
  const hpa = Number(searchParams.get("hpa") ?? "850");
  const validTime = searchParams.get("validTime");

  const grid = domainGrid(8, 9);
  const url = openMeteoMultiUrl(grid, model, 1);
  const res = await fetchOpenMeteo(url);
  if (!res.ok) {
    return NextResponse.json({ unavailable: res.error, values: [] });
  }

  const list = asList(res.data);
  const values = list.map((point) => {
    const hourly = point.hourly ?? {};
    const times = (hourly.time ?? []) as string[];
    const index = validTime ? pickHourIndex(times, new Date(validTime)) : pickHourIndex(times);
    const slice = sliceAtPressure(hourly, index, hpa);
    return { lat: point.latitude, lon: point.longitude, ...slice };
  });

  const center = await fetchPointHourly(model, -33.456, -70.546, 1);
  return NextResponse.json({
    pressureHpa: hpa,
    values,
    validTime: validTime ?? (center.ok ? center.runTimes[0] : null),
  });
}
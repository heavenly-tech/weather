import { NextResponse } from "next/server";
import type { AndesModelId } from "@/lib/andes/models";
import { fetchPointHourly } from "@/lib/andes/fetch-field";
import { SCTB_FOCUS } from "@/lib/andes/domain";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const model = (searchParams.get("model") ?? "gfs_seamless") as AndesModelId;
  const fetched = await fetchPointHourly(model, SCTB_FOCUS.lat, SCTB_FOCUS.lon, {
    forecastHours: 48,
    pastHours: 0,
  });
  if (!fetched.ok) {
    return NextResponse.json({ times: [], error: fetched.error });
  }
  return NextResponse.json({ times: fetched.runTimes });
}
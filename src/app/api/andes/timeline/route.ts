import { NextResponse } from "next/server";
import { buildAirfieldTimelines } from "@/lib/andes/timeline";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const icao = (searchParams.get("icao") ?? "SCEL").toUpperCase();
  try {
    const payload = await buildAirfieldTimelines(icao);
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "timeline failed" },
      { status: 400 }
    );
  }
}
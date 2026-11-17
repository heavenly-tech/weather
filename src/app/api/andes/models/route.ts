import { NextResponse } from "next/server";
import { SCTB_FOCUS } from "@/lib/andes/domain";
import { probeModels } from "@/lib/andes/fetch-field";

export const dynamic = "force-dynamic";

export async function GET() {
  const models = await probeModels(SCTB_FOCUS.lat, SCTB_FOCUS.lon);
  return NextResponse.json({ models, fetchedAt: new Date().toISOString() });
}
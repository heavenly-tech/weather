import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const cesiumIonToken =
    process.env.CESIUM_ION_TOKEN ?? process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? "";
  return NextResponse.json({
    cesiumIonToken: cesiumIonToken || null,
  });
}
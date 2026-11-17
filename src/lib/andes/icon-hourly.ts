import { cachedFetchUrl } from "@/lib/andes/open-meteo-cache";

type Hourly = Record<string, Array<number | null> | string[]>;

export async function mergeIconConvectiveHourly(
  lat: number,
  lon: number,
  hourly: Hourly
): Promise<Hourly> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "convective_cloud_base,convective_cloud_cover",
    models: "icon_seamless",
    forecast_hours: "48",
    past_hours: "24",
    timezone: "UTC",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const res = await cachedFetchUrl(url, "icon_seamless");
  if (!res.ok) return hourly;
  const body = (await res.json()) as { hourly?: Hourly };
  const extra = body.hourly;
  if (!extra) return hourly;
  return {
    ...hourly,
    convective_cloud_base: extra.convective_cloud_base ?? hourly.convective_cloud_base,
    convective_cloud_cover: extra.convective_cloud_cover ?? hourly.convective_cloud_cover,
  };
}
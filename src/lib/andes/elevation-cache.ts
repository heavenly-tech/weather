import { cachedFetchUrl } from "@/lib/andes/open-meteo-cache";

const elevationMem = new Map<string, number>();

function key(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

export async function elevationsForPoints(
  points: { lat: number; lon: number }[]
): Promise<number[]> {
  const missing: { lat: number; lon: number; idx: number }[] = [];
  const out: number[] = new Array(points.length);

  points.forEach((p, idx) => {
    const k = key(p.lat, p.lon);
    if (elevationMem.has(k)) {
      out[idx] = elevationMem.get(k)!;
    } else {
      missing.push({ ...p, idx });
    }
  });

  const BATCH = 80;
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    const params = new URLSearchParams({
      latitude: chunk.map((p) => p.lat.toFixed(4)).join(","),
      longitude: chunk.map((p) => p.lon.toFixed(4)).join(","),
    });
    const url = `https://api.open-meteo.com/v1/elevation?${params}`;
    const res = await cachedFetchUrl(url, "elevation");
    if (!res.ok) {
      chunk.forEach((p) => {
        out[p.idx] = 0;
      });
      continue;
    }
    const body = (await res.json()) as { elevation?: number[] };
    chunk.forEach((p, j) => {
      const elev = body.elevation?.[j] ?? 0;
      elevationMem.set(key(p.lat, p.lon), elev);
      out[p.idx] = elev;
    });
  }

  return out;
}
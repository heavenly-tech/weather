import {
  OPEN_METEO_BATCH_DELAY_MS,
  OPEN_METEO_BATCH_SIZE,
  cachedFetchUrl,
  sleep,
} from "@/lib/andes/open-meteo-cache";
import { openMeteoMultiUrl } from "@/lib/andes/models";
import type { AndesModelId } from "@/lib/andes/models";
import { asList } from "@/lib/open-meteo";
import type { OpenMeteoResponse } from "@/lib/open-meteo";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function fetchMultiBatched(
  points: { lat: number; lon: number }[],
  model: AndesModelId
): Promise<{ ok: true; list: OpenMeteoResponse[] } | { ok: false; error: string }> {
  const batches = chunk(points, OPEN_METEO_BATCH_SIZE);
  const list: OpenMeteoResponse[] = [];

  for (let i = 0; i < batches.length; i++) {
    const url = openMeteoMultiUrl(batches[i]!, model);
    let res = await cachedFetchUrl(url, model);
    if (res.status === 429) {
      await sleep(OPEN_METEO_BATCH_DELAY_MS * 4);
      res = await cachedFetchUrl(url, model);
    }
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: err.slice(0, 200) || `HTTP ${res.status}` };
    }
    const data = (await res.json()) as OpenMeteoResponse | OpenMeteoResponse[];
    list.push(...asList(data));
    if (i < batches.length - 1) await sleep(OPEN_METEO_BATCH_DELAY_MS);
  }

  return { ok: true, list };
}
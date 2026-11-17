import type { MetarObservation, TafForecast } from "@/lib/types";
import { ceilingFtFromClouds } from "@/lib/visibility";
import { ceilingFromHourly } from "@/lib/andes/ceiling";
import type { AndesModelId } from "@/lib/andes/models";
import { generateModelTaf } from "@/lib/andes/generated-taf";

type Hourly = Record<string, Array<number | null> | string[]>;

export type CoherenceSnapshot = {
  modelCeilingFt: number | null;
  metarCeilingFt: number | null;
  tafCeilingFt: number | null;
  modelVsMetar: "better" | "worse" | "match" | "unknown";
  modelTafRaw: string;
  officialTafRaw: string;
};

function lowestTafCeiling(taf: TafForecast): number | null {
  const bases = taf.periods
    .flatMap((p) => p.clouds)
    .filter((c) => /^(BKN|OVC|VV)/i.test(c.cover))
    .map((c) => c.baseFt)
    .filter((b): b is number => b != null);
  if (!bases.length) return null;
  return Math.min(...bases);
}

export function coherenceView(
  hourly: Hourly,
  hourIndex: number,
  elevM: number,
  cloudBaseKey: string | null,
  metar: MetarObservation | null,
  taf: TafForecast | null,
  model: AndesModelId,
  runTime: string
): CoherenceSnapshot {
  const modelSample = ceilingFromHourly(hourly, hourIndex, elevM, cloudBaseKey);
  const metarCeilingFt = metar ? ceilingFtFromClouds(metar.clouds) : null;
  const tafCeilingFt = taf ? lowestTafCeiling(taf) : null;

  let modelVsMetar: CoherenceSnapshot["modelVsMetar"] = "unknown";
  if (modelSample.ceilingFtAgl != null && metarCeilingFt != null) {
    const delta = Math.abs(modelSample.ceilingFtAgl - metarCeilingFt);
    modelVsMetar = delta < 500 ? "match" : modelSample.ceilingFtAgl < metarCeilingFt ? "worse" : "better";
  }

  const modelTaf = generateModelTaf({
    icao: metar?.icao ?? "SCTB",
    elevM,
    model,
    runTime,
    hourly,
    cloudBaseKey,
  });

  return {
    modelCeilingFt: modelSample.ceilingFtAgl,
    metarCeilingFt,
    tafCeilingFt,
    modelVsMetar,
    modelTafRaw: modelTaf.raw,
    officialTafRaw: taf?.raw ?? "(no TAF)",
  };
}
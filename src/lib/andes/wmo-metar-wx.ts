import type { CeilingSample } from "@/lib/andes/ceiling";
import { BKN_CLOUD_COVER_PCT } from "@/lib/andes/ceiling";

type Hourly = Record<string, Array<number | null> | string[]>;

function numAt(hourly: Hourly, key: string, index: number): number | null {
  const series = hourly[key];
  if (!series) return null;
  const value = series[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function lclHeightM(tempC: number | null, dewC: number | null): number | null {
  if (tempC == null || dewC == null) return null;
  const spread = tempC - dewC;
  if (spread <= 0) return 0;
  return 125 * spread;
}

export type MetarProductContext = {
  clouds: string;
  weather: string;
  rmkExtra: string[];
  /** After LCL estimate for METAR display */
  effectiveCeilFt: number | null;
  lowCloudUnresolved: boolean;
};

export function deriveMetarWxAndCloud(
  hourly: Hourly,
  index: number,
  elevM: number,
  ceil: CeilingSample,
  visRoundM: number | null,
  forTaf = false
): MetarProductContext {
  const temp = numAt(hourly, "temperature_2m", index);
  const dew = numAt(hourly, "dew_point_2m", index);
  const rh = numAt(hourly, "relative_humidity_2m", index);
  const spread = temp != null && dew != null ? temp - dew : null;
  const precip = numAt(hourly, "precipitation", index) ?? 0;
  const rain = numAt(hourly, "rain", index) ?? 0;
  const showers = numAt(hourly, "showers", index) ?? 0;
  const snow = numAt(hourly, "snowfall", index) ?? 0;
  const coverLow = numAt(hourly, "cloud_cover_low", index);
  const cape = numAt(hourly, "cape", index);
  const convBase = numAt(hourly, "convective_cloud_base", index);

  const prevPrecip = index > 0 ? (numAt(hourly, "precipitation", index - 1) ?? 0) : 0;
  const nextPrecip = index + 1 < (hourly.time?.length ?? 0) ? (numAt(hourly, "precipitation", index + 1) ?? 0) : 0;
  const hourlyRate = precip;
  const hasAdjacent = prevPrecip > 0 || nextPrecip > 0;

  let effectiveCeilFt = ceil.ceilingFtAgl;
  const rmkExtra: string[] = [];
  let lowUnresolved = ceil.lowCloudUnresolved;

  const weather: string[] = [];
  if (visRoundM != null) {
    if (visRoundM < 1000) {
      if (visRoundM < 9990) weather.push("FG");
    } else if (visRoundM < 5000 && rh != null && rh >= 95) {
      weather.push("BR");
    } else if (visRoundM < 5000 && spread != null && spread > 3) {
      weather.push("HZ");
    }
  }

  const dryAir = spread != null && spread > 5;
  const stratCeil = effectiveCeilFt != null && effectiveCeilFt <= 3000;

  if (!dryAir && hourlyRate >= 0.1 && (hasAdjacent || hourlyRate >= 0.25)) {
    if (showers >= 0.1 && (convBase != null && convBase > 0 || (cape != null && cape >= 100) || (coverLow != null && coverLow >= 62.5))) {
      const p = showers < 2.5 ? "-" : showers <= 7.6 ? "" : "+";
      weather.push(`${p}SHRA`);
    } else if (rain >= 0.1 && showers < 0.1) {
      const p = rain < 2.5 ? "-" : rain <= 7.6 ? "" : "+";
      weather.push(`${p}RA`);
    } else if (
      stratCeil &&
      spread != null &&
      spread <= 3 &&
      showers < 0.1 &&
      hourlyRate < 0.5 &&
      rain < 0.1
    ) {
      const p = hourlyRate < 0.25 ? "-" : hourlyRate <= 0.5 ? "" : "+";
      weather.push(`${p}DZ`);
    }
  }

  if (snow >= 0.1 && temp != null && temp <= 2) {
    weather.push(snow < 2 ? "-SN" : snow <= 5 ? "SN" : "+SN");
  }

  let clouds = "NSC";
  if (effectiveCeilFt != null && effectiveCeilFt > 0) {
    const h = Math.floor(effectiveCeilFt / 100);
    const code = coverLow != null && coverLow >= 87.5 ? "OVC" : "BKN";
    clouds = `${code}${String(h).padStart(3, "0")}`;
  } else if (ceil.lowCloudUnresolved || (coverLow != null && coverLow >= BKN_CLOUD_COVER_PCT)) {
    const lclM = lclHeightM(temp, dew);
    const lclFt = lclM != null ? lclM * 3.280839895 : null;
    if (spread != null && spread <= 3 && rh != null && rh >= 92 && lclFt != null && lclFt < 5000) {
      effectiveCeilFt = lclFt;
      lowUnresolved = false;
      const h = Math.max(1, Math.floor(lclFt / 100));
      clouds = `BKN${String(h).padStart(3, "0")}`;
      rmkExtra.push("CB EST LCL");
    } else if (coverLow != null && coverLow >= BKN_CLOUD_COVER_PCT) {
      clouds = "BKN///";
      lowUnresolved = true;
    } else if (coverLow != null && coverLow >= 12.5) {
      clouds = lclFt != null && lclFt < 1500 ? `SCT///` : "NSC";
    } else {
      clouds = "NSC";
    }
  } else if (coverLow != null && coverLow >= 12.5 && coverLow < BKN_CLOUD_COVER_PCT) {
    clouds = "NSC";
  }

  if (forTaf && coverLow != null && coverLow >= BKN_CLOUD_COVER_PCT && clouds === "NSC") {
    clouds = "BKN///";
  }

  return {
    clouds,
    weather: weather.join(" ").trim(),
    rmkExtra,
    effectiveCeilFt,
    lowCloudUnresolved: lowUnresolved,
  };
}
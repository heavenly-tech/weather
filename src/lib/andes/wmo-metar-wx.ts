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

const M_TO_FT = 3.280839895;
/** Beyond this spread the surface LCL is not used for a low-cloud base (treat as mid-level). */
const MAX_LCL_SPREAD_C = 15;

export type MetarProductContext = {
  clouds: string;
  weather: string;
  rmkExtra: string[];
  /** After LCL estimate for METAR/TAF display */
  effectiveCeilFt: number | null;
  lowCloudUnresolved: boolean;
  cldEstimated: boolean;
};

/** Round base height down to the Annex 3 100 ft cloud group (e.g. 4511 ft → 45 → BKN045). */
export function cloudHeightHundredsFt(ftAgl: number): number {
  return Math.max(1, Math.floor(ftAgl / 100));
}

/**
 * Mid-level-only cloud (BKN low cover but no defensible surface LCL):
 * we emit **NSC** in METAR/TAF — no ceiling-height claim and no `///` groups.
 * Model mid/high cover still drives the ceiling map; NSC here means only that
 * this product will not state a low cloud base height (FM 51 / Annex 3 AUTO style).
 */
export function midLevelCloudGroup(): string {
  return "NSC";
}

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
  const rain = numAt(hourly, "rain", index) ?? 0;
  const showers = numAt(hourly, "showers", index) ?? 0;
  const snow = numAt(hourly, "snowfall", index) ?? 0;
  const coverLow = numAt(hourly, "cloud_cover_low", index);
  const cape = numAt(hourly, "cape", index);
  const convBase = numAt(hourly, "convective_cloud_base", index);

  const liquidRate = (i: number) =>
    Math.max(
      numAt(hourly, "precipitation", i) ?? 0,
      numAt(hourly, "rain", i) ?? 0,
      numAt(hourly, "showers", i) ?? 0
    );
  const prevPrecip = index > 0 ? liquidRate(index - 1) : 0;
  const nextPrecip = index + 1 < (hourly.time?.length ?? 0) ? liquidRate(index + 1) : 0;
  const hourlyRate = liquidRate(index);
  const hasAdjacent = prevPrecip >= 0.1 || nextPrecip >= 0.1;

  let effectiveCeilFt = ceil.ceilingFtAgl;
  const rmkExtra: string[] = [];
  let lowUnresolved = ceil.lowCloudUnresolved;
  let cldEstimated = false;
  const cover925 = numAt(hourly, "cloud_cover_925hPa", index);

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

  const lclM = lclHeightM(temp, dew);
  const lclFt = lclM != null ? lclM * M_TO_FT : null;
  const lowCloudTopFt =
    numAt(hourly, "geopotential_height_925hPa", index) != null
      ? Math.max(0, (numAt(hourly, "geopotential_height_925hPa", index)! - elevM) * M_TO_FT)
      : null;

  const lclImplausible =
    spread == null ||
    spread > MAX_LCL_SPREAD_C ||
    lclFt == null ||
    (lowCloudTopFt != null &&
      lowCloudTopFt > 0 &&
      lclFt > lowCloudTopFt &&
      cover925 != null &&
      cover925 >= BKN_CLOUD_COVER_PCT);

  let clouds = "NSC";
  if (effectiveCeilFt != null && effectiveCeilFt > 0) {
    const h = cloudHeightHundredsFt(effectiveCeilFt);
    const code = coverLow != null && coverLow >= 87.5 ? "OVC" : "BKN";
    clouds = `${code}${String(h).padStart(3, "0")}`;
  } else if (coverLow != null && coverLow >= BKN_CLOUD_COVER_PCT) {
    if (!lclImplausible && lclFt != null) {
      effectiveCeilFt = lclFt;
      lowUnresolved = false;
      cldEstimated = true;
      const h = cloudHeightHundredsFt(lclFt);
      clouds = `BKN${String(h).padStart(3, "0")}`;
      rmkExtra.push("CLD EST");
    } else {
      clouds = midLevelCloudGroup();
      effectiveCeilFt = null;
      lowUnresolved = false;
    }
  } else if (coverLow != null && coverLow >= 12.5 && coverLow < BKN_CLOUD_COVER_PCT) {
    clouds = "NSC";
  }

  if (forTaf && clouds.includes("///")) {
    clouds = midLevelCloudGroup();
  }

  return {
    clouds,
    weather: weather.join(" ").trim(),
    rmkExtra,
    effectiveCeilFt,
    lowCloudUnresolved: lowUnresolved,
    cldEstimated,
  };
}
import { annex3NscCeilingFtAgl } from "@/lib/andes/airfield-msa";
import type { CeilingSample } from "@/lib/andes/ceiling";
import { BKN_CLOUD_COVER_PCT, surfacePressureHpa } from "@/lib/andes/ceiling";
import { capEstimatedVisForLowCloud } from "@/lib/andes/visibility-estimate";
import { visObscurationWx } from "@/lib/andes/wmo-vis-wx";

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
  midCloudBaseUnk: boolean;
  /** Visibility used for the body, after the low-cloud / fog cap. */
  visM: number | null;
};

/** Round base height down to the Annex 3 100 ft cloud group (e.g. 4511 ft → 45 → BKN045). */
export function cloudHeightHundredsFt(ftAgl: number): number {
  return Math.max(1, Math.floor(ftAgl / 100));
}

export function midLevelCloudGroup(): string {
  return "NSC";
}

/** FM 51 minimum when low cover is BKN+ but base unknown (spread/LCL implausible). */
export const TAF_UNKNOWN_LOW_CLOUD_MIN_FT = 5000;

export function unknownLowCloudCover(forTaf: boolean): string {
  return forTaf
    ? `BKN${String(Math.floor(TAF_UNKNOWN_LOW_CLOUD_MIN_FT / 100)).padStart(3, "0")}`
    : "BKN///";
}

const LEVELS_FOR_NSC = [1000, 975, 950, 925, 900, 850, 800, 700] as const;

/** True when BKN+ cloud exists below max(1500 m / 5000 ft, 25 NM AIP MSA) AGL. */
export function hasSignificantCloudBelowNscCeiling(
  hourly: Hourly,
  index: number,
  elevM: number,
  icao: string
): boolean {
  const thresholdFt = annex3NscCeilingFtAgl(icao, elevM);
  const surfaceHpa = surfacePressureHpa(hourly, index, elevM);
  for (const hpa of LEVELS_FOR_NSC) {
    const gh = numAt(hourly, `geopotential_height_${hpa}hPa`, index);
    const cov = numAt(hourly, `cloud_cover_${hpa}hPa`, index);
    if (cov != null && cov >= BKN_CLOUD_COVER_PCT && gh != null && gh > elevM && hpa <= surfaceHpa + 1) {
      const aglFt = (gh - elevM) * M_TO_FT;
      if (aglFt < thresholdFt) return true;
    }
  }
  return false;
}

export function annex3NscEligible(hourly: Hourly, index: number, elevM: number, icao: string): boolean {
  return !hasSignificantCloudBelowNscCeiling(hourly, index, elevM, icao);
}

export function deriveMetarWxAndCloud(
  hourly: Hourly,
  index: number,
  elevM: number,
  icao: string,
  ceil: CeilingSample,
  visRoundM: number | null,
  forTaf = false,
  visEstimated = false
): MetarProductContext {
  const temp = numAt(hourly, "temperature_2m", index);
  const dew = numAt(hourly, "dew_point_2m", index);
  const rh = numAt(hourly, "relative_humidity_2m", index);
  const spread = temp != null && dew != null ? temp - dew : null;
  const rain = numAt(hourly, "rain", index) ?? 0;
  const showers = numAt(hourly, "showers", index) ?? 0;
  const snow = numAt(hourly, "snowfall", index) ?? 0;
  const coverLow = numAt(hourly, "cloud_cover_low", index);

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
  } else if (!ceil.obscured && coverLow != null && coverLow >= BKN_CLOUD_COVER_PCT) {
    if (!lclImplausible && lclFt != null) {
      effectiveCeilFt = lclFt;
      lowUnresolved = false;
      cldEstimated = true;
      const h = cloudHeightHundredsFt(lclFt);
      clouds = `BKN${String(h).padStart(3, "0")}`;
      rmkExtra.push("CLD EST");
    } else {
      clouds = unknownLowCloudCover(forTaf);
      effectiveCeilFt = forTaf ? TAF_UNKNOWN_LOW_CLOUD_MIN_FT : null;
      lowUnresolved = true;
      if (forTaf) {
        cldEstimated = true;
        rmkExtra.push("CLD EST");
      } else {
        rmkExtra.push("CLD BASE UNK");
      }
    }
  } else if (!ceil.obscured && ceil.capeOnlyLayer) {
    const h = cloudHeightHundredsFt(ceil.capeOnlyLayer.ftAgl);
    clouds = `${ceil.capeOnlyLayer.cover}${String(h).padStart(3, "0")}`;
    effectiveCeilFt = null;
    lowUnresolved = false;
  } else if (
    coverLow != null &&
    coverLow < BKN_CLOUD_COVER_PCT &&
    annex3NscEligible(hourly, index, elevM, icao)
  ) {
    clouds = midLevelCloudGroup();
  }

  const cloudLayer = /^(?:FEW|SCT|BKN|OVC)(?:\d{3}|\/\/\/)$/.test(clouds);
  if (ceil.obscured && !cloudLayer) {
    clouds = "VV000";
    effectiveCeilFt = 0;
    lowUnresolved = false;
  }

  const visM = capEstimatedVisForLowCloud({
    visM: visRoundM,
    estimated: visEstimated,
    ceilingFtAgl: effectiveCeilFt,
    obscured: ceil.obscured,
    spreadC: spread,
    rhPct: rh,
    lowCoverPct: coverLow,
  });

  const dryAir = spread != null && spread > 5;
  const stratCeil = effectiveCeilFt != null && effectiveCeilFt <= 3000;
  const precipWx: string[] = [];
  if (showers >= 0.1) {
    const p = showers < 2.5 ? "-" : showers <= 7.6 ? "" : "+";
    precipWx.push(`${p}SHRA`);
  } else if (!dryAir && hourlyRate >= 0.1 && (hasAdjacent || hourlyRate >= 0.25)) {
    if (rain >= 0.1) {
      const p = rain < 2.5 ? "-" : rain <= 7.6 ? "" : "+";
      precipWx.push(`${p}RA`);
    } else if (stratCeil && spread != null && spread <= 3 && hourlyRate < 0.5) {
      const p = hourlyRate < 0.25 ? "-" : hourlyRate <= 0.5 ? "" : "+";
      precipWx.push(`${p}DZ`);
    }
  }
  if (snow >= 0.1 && temp != null && temp <= 2) {
    precipWx.push(snow < 2 ? "-SN" : snow <= 5 ? "SN" : "+SN");
  }

  const visWx = visObscurationWx(visM, rh);
  const weather = [...precipWx, visWx].filter(Boolean).join(" ").trim();

  return {
    clouds,
    weather,
    rmkExtra,
    effectiveCeilFt,
    lowCloudUnresolved: lowUnresolved,
    cldEstimated,
    midCloudBaseUnk: false,
    visM,
  };
}
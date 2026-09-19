import { LEVEL_FL, kmhToKt, mToKm } from "./format";
import { fetchJson } from "./http";
import type { ForecastHour, PointForecast, PressureLevel, VerticalSample } from "./types";

const LEVELS: PressureLevel[] = [1000, 925, 850, 700, 500, 300];

type OpenMeteoHourly = Record<string, Array<number | null> | string[]>;

type OpenMeteoResponse = {
  latitude: number;
  longitude: number;
  elevation?: number;
  hourly?: OpenMeteoHourly;
};

function hourlyVars(prefix: string): string {
  return LEVELS.map((h) => `${prefix}_${h}hPa`).join(",");
}

function pressureHourly(): string {
  return [
    hourlyVars("temperature"),
    hourlyVars("relative_humidity"),
    hourlyVars("wind_speed"),
    hourlyVars("wind_direction"),
    hourlyVars("geopotential_height"),
    "temperature_2m",
    "cloud_cover",
    "precipitation",
    "weather_code",
  ].join(",");
}

export function openMeteoPressureUrl(lat: number, lon: number, days = 1): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: pressureHourly(),
    forecast_days: String(days),
    models: "gfs_seamless",
    timezone: "UTC",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export function openMeteoPressureUrlMulti(points: { lat: number; lon: number }[], days = 1): string {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(","),
    longitude: points.map((p) => p.lon.toFixed(4)).join(","),
    hourly: pressureHourly(),
    forecast_days: String(days),
    models: "gfs_seamless",
    timezone: "UTC",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export function openMeteoSurfaceUrl(lat: number, lon: number, days = 5): string {
  const hourly = [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "cloud_cover",
    "wind_speed_10m",
    "wind_direction_10m",
    "visibility",
    "weather_code",
  ].join(",");
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly,
    forecast_days: String(days),
    models: "gfs_seamless",
    timezone: "UTC",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

function numAt(hourly: OpenMeteoHourly | undefined, key: string, index: number): number | null {
  const series = hourly?.[key];
  if (!series) return null;
  const value = series[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function pickHourIndex(times: string[], target = new Date()): number {
  if (!times.length) return 0;
  const t = target.getTime();
  let best = 0;
  let bestDiff = Infinity;
  times.forEach((iso, i) => {
    const diff = Math.abs(new Date(iso).getTime() - t);
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  });
  return best;
}

export function extractLevels(hourly: OpenMeteoHourly, index: number): VerticalSample[] {
  return LEVELS.map((hpa) => ({
    hpa,
    flApprox: LEVEL_FL[hpa],
    tempC: numAt(hourly, `temperature_${hpa}hPa`, index),
    rhPct: numAt(hourly, `relative_humidity_${hpa}hPa`, index),
    windKt: kmhToKt(numAt(hourly, `wind_speed_${hpa}hPa`, index)),
    windDirDeg: numAt(hourly, `wind_direction_${hpa}hPa`, index),
    heightM: numAt(hourly, `geopotential_height_${hpa}hPa`, index),
  }));
}

export async function fetchOpenMeteo(url: string) {
  return fetchJson<OpenMeteoResponse | OpenMeteoResponse[]>(url);
}

export function asSingle(data: OpenMeteoResponse | OpenMeteoResponse[]): OpenMeteoResponse {
  return Array.isArray(data) ? data[0] : data;
}

export function asList(data: OpenMeteoResponse | OpenMeteoResponse[]): OpenMeteoResponse[] {
  return Array.isArray(data) ? data : [data];
}

export function surfaceSnapshot(hourly: OpenMeteoHourly, index: number) {
  return {
    surfaceTempC: numAt(hourly, "temperature_2m", index),
    cloudPct: numAt(hourly, "cloud_cover", index),
    precipMm: numAt(hourly, "precipitation", index),
    weatherCode: numAt(hourly, "weather_code", index),
    windKt: kmhToKt(numAt(hourly, "wind_speed_10m", index)),
    windDirDeg: numAt(hourly, "wind_direction_10m", index),
    rhPct: numAt(hourly, "relative_humidity_2m", index),
    visKm: mToKm(numAt(hourly, "visibility", index)),
  };
}

export function toPointForecast(
  icao: string,
  name: string,
  model: string,
  response: OpenMeteoResponse
): PointForecast {
  const hourly = response.hourly ?? {};
  const times = (hourly.time ?? []) as string[];
  const hours: ForecastHour[] = times.map((time, index) => {
    const snap = surfaceSnapshot(hourly, index);
    return {
      time,
      tempC: snap.surfaceTempC,
      rhPct: snap.rhPct,
      precipMm: snap.precipMm,
      cloudPct: snap.cloudPct,
      windKt: snap.windKt,
      windDirDeg: snap.windDirDeg,
      visKm: snap.visKm,
      weatherCode: snap.weatherCode,
    };
  });
  return {
    icao,
    name,
    model,
    lat: response.latitude,
    lon: response.longitude,
    elevM: response.elevation ?? null,
    hours,
  };
}

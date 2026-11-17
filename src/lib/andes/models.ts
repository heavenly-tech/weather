/**
 * Open-Meteo model sources for the Andes viewer.
 * Respect https://open-meteo.com/en/terms — cache responses server-side when scaling up.
 */

export type AndesModelId = "gfs_seamless" | "ecmwf_ifs025" | "icon_seamless" | "gem_seamless";

const VALID_MODELS: AndesModelId[] = ["gfs_seamless", "ecmwf_ifs025", "icon_seamless", "gem_seamless"];

export function parseAndesModelId(raw: string | null): AndesModelId | null {
  const id = (raw ?? "gfs_seamless") as AndesModelId;
  return VALID_MODELS.includes(id) ? id : null;
}

export const GRID_PRESSURE_LEVELS = [950, 925, 900, 850, 800, 700] as const;

export type AndesModelMeta = {
  id: AndesModelId;
  label: string;
  /** Open-Meteo `models=` query value */
  query: string;
  pressureLevels: boolean;
  cloudBaseField: "convective_cloud_base" | "cloud_base" | null;
  notes?: string;
};

export const ANDES_MODELS: AndesModelMeta[] = [
  {
    id: "gfs_seamless",
    label: "GFS",
    query: "gfs_seamless",
    pressureLevels: true,
    cloudBaseField: null,
    notes: "Pressure-level cloud cover; no CBH on Open-Meteo.",
  },
  {
    id: "ecmwf_ifs025",
    label: "ECMWF IFS 0.25°",
    query: "ecmwf_ifs025",
    pressureLevels: true,
    cloudBaseField: null,
    notes: "Use ecmwf_ifs025 for pressure levels (ecmwf_ifs has none).",
  },
  {
    id: "icon_seamless",
    label: "DWD ICON",
    query: "icon_seamless",
    pressureLevels: true,
    cloudBaseField: "convective_cloud_base",
    notes:
      "convective_cloud_base is metres AMSL. It is a BKN/OVC ceiling only with precipitation or cloud cover ≥ 62.5%; CAPE alone is FEW/SCT.",
  },
  {
    id: "gem_seamless",
    label: "GEM",
    query: "gem_seamless",
    pressureLevels: true,
    cloudBaseField: null,
  },
];

export function modelById(id: string): AndesModelMeta | undefined {
  return ANDES_MODELS.find((m) => m.id === id);
}

const PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300] as const;

/** Levels requested on single-point fetches (keeps URLs under Open-Meteo limits; ceiling uses 1000–700). */
const POINT_PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500] as const;

export type HourlyVarMode = "point" | "validate";

function surfaceVarsForModel(meta: AndesModelMeta, mode: HourlyVarMode): string[] {
  const base = [
    "surface_pressure",
    "cloud_cover",
    ...(meta.id === "icon_seamless" && mode === "point" ? [] : meta.id === "icon_seamless" ? [] : ["cloud_cover_low"]),
    "cloud_cover_mid",
    "cloud_cover_high",
    "temperature_2m",
    "dew_point_2m",
    "relative_humidity_2m",
    "pressure_msl",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "visibility",
    "precipitation",
    "rain",
    "showers",
    "snowfall",
    "weather_code",
  ];
  if (meta.id !== "icon_seamless" && !base.includes("cloud_cover_low")) base.splice(2, 0, "cloud_cover_low");
  if (meta.id === "icon_seamless") {
    base.splice(2, 0, "cloud_cover_low");
    base.push("convective_cloud_base", "cape");
  }
  return base;
}

export function hourlyVariablesForModel(meta: AndesModelMeta, mode: HourlyVarMode = "point"): string {
  const levels = mode === "validate" ? GRID_PRESSURE_LEVELS : POINT_PRESSURE_LEVELS;
  const levelVars = meta.pressureLevels
    ? [
        ...levels.flatMap((hpa) => {
          const base = [
            `cloud_cover_${hpa}hPa`,
            `geopotential_height_${hpa}hPa`,
          ];
          if (mode === "validate") {
            return [...base, `relative_humidity_${hpa}hPa`];
          }
          return [
            ...base,
            `relative_humidity_${hpa}hPa`,
            `temperature_${hpa}hPa`,
            `wind_speed_${hpa}hPa`,
            `wind_direction_${hpa}hPa`,
          ];
        }),
      ]
    : [];
  const surface = surfaceVarsForModel(meta, mode);
  return [...surface, ...levelVars].join(",");
}

export function openMeteoForecastUrl(
  lat: number,
  lon: number,
  model: AndesModelId,
  opts: { forecastHours?: number; pastHours?: number } = {}
): string {
  const meta = modelById(model)!;
  const forecastHours = opts.forecastHours ?? 48;
  const pastHours = opts.pastHours ?? 24;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: hourlyVariablesForModel(meta),
    forecast_hours: String(forecastHours),
    past_hours: String(pastHours),
    models: meta.query,
    timezone: "UTC",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export function openMeteoMultiUrl(points: { lat: number; lon: number }[], model: AndesModelId): string {
  const meta = modelById(model)!;
  // 6 levels × (cover + height) + surface pressure, precip, rain, showers, low cloud = 17.
  // ICON adds convective_cloud_base (18). Weighted cost is locations × vars/10.
  const hourly = [
    ...GRID_PRESSURE_LEVELS.map((hpa) => `cloud_cover_${hpa}hPa`),
    ...GRID_PRESSURE_LEVELS.map((hpa) => `geopotential_height_${hpa}hPa`),
    "surface_pressure",
    "precipitation",
    "rain",
    "showers",
    ...(model === "icon_seamless" ? ["convective_cloud_base", "cloud_cover_low"] : ["cloud_cover_low"]),
  ];
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(","),
    longitude: points.map((p) => p.lon.toFixed(4)).join(","),
    hourly: hourly.join(","),
    forecast_hours: "48",
    past_hours: "0",
    models: meta.query,
    timezone: "UTC",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export { PRESSURE_LEVELS };
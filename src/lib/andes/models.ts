/**
 * Open-Meteo model sources for the Andes viewer.
 * Respect https://open-meteo.com/en/terms — cache responses server-side when scaling up.
 */

export type AndesModelId = "gfs_seamless" | "ecmwf_ifs025" | "icon_seamless" | "gem_seamless";

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
    notes: "Supplies convective_cloud_base (m) where populated.",
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

export function hourlyVariablesForModel(meta: AndesModelMeta): string {
  const levelVars = meta.pressureLevels
    ? [
        ...PRESSURE_LEVELS.flatMap((hpa) => [
          `cloud_cover_${hpa}hPa`,
          `relative_humidity_${hpa}hPa`,
          `geopotential_height_${hpa}hPa`,
          `temperature_${hpa}hPa`,
          `wind_speed_${hpa}hPa`,
          `wind_direction_${hpa}hPa`,
        ]),
      ]
    : [];
  const surface = [
    "surface_pressure",
    "cloud_cover",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "temperature_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "wind_direction_10m",
    "visibility",
    "weather_code",
  ];
  if (meta.cloudBaseField) surface.push(meta.cloudBaseField);
  return [...surface, ...levelVars].join(",");
}

export function openMeteoForecastUrl(
  lat: number,
  lon: number,
  model: AndesModelId,
  days = 2
): string {
  const meta = modelById(model)!;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: hourlyVariablesForModel(meta),
    forecast_days: String(days),
    models: meta.query,
    timezone: "UTC",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export function openMeteoMultiUrl(points: { lat: number; lon: number }[], model: AndesModelId, days = 1): string {
  const meta = modelById(model)!;
  const hourly = [
    ...PRESSURE_LEVELS.map((hpa) => `cloud_cover_${hpa}hPa`),
    ...PRESSURE_LEVELS.map((hpa) => `geopotential_height_${hpa}hPa`),
    ...PRESSURE_LEVELS.map((hpa) => `relative_humidity_${hpa}hPa`),
    "surface_pressure",
    "temperature_2m",
  ];
  if (meta.cloudBaseField) hourly.push(meta.cloudBaseField);
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(","),
    longitude: points.map((p) => p.lon.toFixed(4)).join(","),
    hourly: hourly.join(","),
    forecast_days: String(days),
    models: meta.query,
    timezone: "UTC",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export { PRESSURE_LEVELS };
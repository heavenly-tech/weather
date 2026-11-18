/**
 * Model list shown on the Andes desk. Forecast URLs are built by the Rust server.
 */

export type AndesModelId = "gfs_seamless" | "ecmwf_ifs025" | "icon_seamless" | "gem_seamless";

const VALID_MODELS: AndesModelId[] = ["gfs_seamless", "ecmwf_ifs025", "icon_seamless", "gem_seamless"];

export function parseAndesModelId(raw: string | null): AndesModelId | null {
  const id = (raw ?? "gfs_seamless") as AndesModelId;
  return VALID_MODELS.includes(id) ? id : null;
}

export const GRID_PRESSURE_LEVELS = [950, 925, 900, 850, 800, 700] as const;

/** hPa steps the altitude picker snaps to. Forecast URLs are built in Rust. */
export const PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300] as const;

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

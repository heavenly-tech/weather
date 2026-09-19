export type SourceKind = "live" | "fallback" | "derived" | "mock";

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR" | "UNK";

export type LatLon = {
  lat: number;
  lon: number;
};

export type CloudLayer = {
  cover: string;
  baseFt: number | null;
};

export type MetarObservation = {
  icao: string;
  name: string;
  raw: string;
  observedAt: string | null;
  tempC: number | null;
  dewpointC: number | null;
  windDirDeg: number | null;
  windKt: number | null;
  gustKt: number | null;
  visM: number | null;
  altimeterHpa: number | null;
  flightCategory: FlightCategory;
  cover: string | null;
  clouds: CloudLayer[];
  lat: number;
  lon: number;
  elevM: number | null;
};

export type TafPeriod = {
  from: string | null;
  to: string | null;
  change: string | null;
  probability: number | null;
  windDirDeg: number | null;
  windKt: number | null;
  visM: number | null;
  wx: string | null;
  clouds: CloudLayer[];
  flightCategory: FlightCategory;
};

export type TafForecast = {
  icao: string;
  name: string;
  raw: string;
  issuedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  periods: TafPeriod[];
  lat: number;
  lon: number;
};

export type ProductEnvelope<T> = {
  data: T;
  source: SourceKind;
  sourceLabel: string;
  fetchedAt: string;
  warning?: string;
};

export type PressureLevel = 1000 | 925 | 850 | 700 | 500 | 300;

export type VerticalSample = {
  hpa: PressureLevel;
  flApprox: number;
  tempC: number | null;
  rhPct: number | null;
  windKt: number | null;
  windDirDeg: number | null;
  heightM: number | null;
};

export type GrametColumn = {
  km: number;
  lat: number;
  lon: number;
  label?: string;
  surfaceTempC: number | null;
  cloudPct: number | null;
  precipMm: number | null;
  weatherCode: number | null;
  levels: VerticalSample[];
};

export type GrametProduct = {
  fromIcao: string;
  toIcao: string;
  fromName: string;
  toName: string;
  validTime: string;
  distanceKm: number;
  columns: GrametColumn[];
};

export type GametSection = {
  title: string;
  lines: string[];
};

export type GametBulletin = {
  fir: string;
  firLabel: string;
  validFrom: string;
  validTo: string;
  raw: string;
  sections: GametSection[];
  sigmets: { raw: string; hazard: string | null }[];
};

export type ForecastHour = {
  time: string;
  tempC: number | null;
  rhPct: number | null;
  precipMm: number | null;
  cloudPct: number | null;
  windKt: number | null;
  windDirDeg: number | null;
  visKm: number | null;
  weatherCode: number | null;
};

export type PointForecast = {
  icao: string;
  name: string;
  model: string;
  lat: number;
  lon: number;
  elevM: number | null;
  hours: ForecastHour[];
};

export type SynopticProduct = {
  id: string;
  title: string;
  cycle: string;
  description: string;
  imagePath: string;
  origin: string;
};

export type VizStation = {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  elevM: number;
  flightCategory: FlightCategory;
  tempC: number | null;
  windKt: number | null;
  windDirDeg: number | null;
  cloudPct: number | null;
  precipMm: number | null;
  levels: VerticalSample[];
};

export type ChileFirId = "ANTOFAGASTA" | "SANTIAGO" | "PUERTO_MONTT";

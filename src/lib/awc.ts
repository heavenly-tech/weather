import type { CloudLayer, FlightCategory, MetarObservation, TafForecast, TafPeriod } from "./types";
import { unixToIso } from "./format";
import { awcVisToMeters, ceilingFtFromClouds, flightCategoryFromWx, resolveVisM } from "./visibility";

type AwcCloud = { cover?: string; base?: number | null; type?: string | null };

type AwcMetar = {
  icaoId?: string;
  name?: string;
  rawOb?: string;
  reportTime?: string;
  obsTime?: number;
  temp?: number;
  dewp?: number;
  wdir?: number | string;
  wspd?: number;
  wgst?: number;
  visib?: string | number;
  altim?: number;
  fltCat?: string;
  cover?: string;
  clouds?: AwcCloud[];
  lat?: number;
  lon?: number;
  elev?: number;
};

type AwcTafPeriod = {
  timeFrom?: number;
  timeTo?: number;
  fcstChange?: string | null;
  probability?: number | null;
  wdir?: number | null;
  wspd?: number | null;
  visib?: string | number | null;
  wxString?: string | null;
  clouds?: AwcCloud[];
};

type AwcTaf = {
  icaoId?: string;
  name?: string;
  rawTAF?: string;
  issueTime?: string;
  validTimeFrom?: number;
  validTimeTo?: number;
  lat?: number;
  lon?: number;
  fcsts?: AwcTafPeriod[];
};

function clouds(list?: AwcCloud[]): CloudLayer[] {
  return (list ?? []).map((c) => ({
    cover: c.cover ?? "SKC",
    baseFt: c.base ?? null,
  }));
}

function flightCat(value?: string): FlightCategory {
  if (value === "VFR" || value === "MVFR" || value === "IFR" || value === "LIFR") return value;
  return "UNK";
}

function windDir(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return Number.isFinite(value) ? value : null;
}

export function parseAwcMetar(row: AwcMetar): MetarObservation {
  const layers = clouds(row.clouds);
  const visM = resolveVisM(row.rawOb, row.visib);
  const fromAwc = flightCat(row.fltCat);
  return {
    icao: (row.icaoId ?? "").toUpperCase(),
    name: row.name ?? row.icaoId ?? "Unknown station",
    raw: row.rawOb ?? "",
    observedAt: row.reportTime ?? unixToIso(row.obsTime),
    tempC: row.temp ?? null,
    dewpointC: row.dewp ?? null,
    windDirDeg: windDir(row.wdir),
    windKt: row.wspd ?? null,
    gustKt: row.wgst ?? null,
    visM,
    altimeterHpa: row.altim ?? null,
    flightCategory:
      fromAwc === "UNK" ? flightCategoryFromWx(visM, ceilingFtFromClouds(layers)) : fromAwc,
    cover: row.cover ?? null,
    clouds: layers,
    lat: row.lat ?? 0,
    lon: row.lon ?? 0,
    elevM: row.elev ?? null,
  };
}

export function parseAwcTaf(row: AwcTaf): TafForecast {
  const periods: TafPeriod[] = (row.fcsts ?? []).map((p) => {
    const layers = clouds(p.clouds);
    const visM = awcVisToMeters(p.visib);
    return {
      from: unixToIso(p.timeFrom),
      to: unixToIso(p.timeTo),
      change: p.fcstChange ?? null,
      probability: p.probability ?? null,
      windDirDeg: windDir(p.wdir),
      windKt: p.wspd ?? null,
      visM,
      wx: p.wxString ?? null,
      clouds: layers,
      flightCategory: flightCategoryFromWx(visM, ceilingFtFromClouds(layers)),
    };
  });
  return {
    icao: (row.icaoId ?? "").toUpperCase(),
    name: row.name ?? row.icaoId ?? "Unknown station",
    raw: row.rawTAF ?? "",
    issuedAt: row.issueTime ?? null,
    validFrom: unixToIso(row.validTimeFrom),
    validTo: unixToIso(row.validTimeTo),
    periods,
    lat: row.lat ?? 0,
    lon: row.lon ?? 0,
  };
}

export type AwcSigmet = {
  icaoId?: string;
  firId?: string;
  firName?: string;
  hazard?: string;
  qualifier?: string;
  rawSigmet?: string;
  coords?: { lat: number; lon: number }[];
  validTimeFrom?: number;
  validTimeTo?: number;
};

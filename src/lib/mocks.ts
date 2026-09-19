import type {
  ForecastHour,
  GametBulletin,
  GrametColumn,
  GrametProduct,
  MetarObservation,
  PointForecast,
  TafForecast,
  VerticalSample,
  VizStation,
} from "./types";
import { LEVEL_FL } from "./format";
import { getStation, requireStation } from "./stations";

function isoHoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

export function mockMetar(icao: string): MetarObservation {
  const s = requireStation(icao);
  const raw = `METAR ${s.icao} ${zuluNow()} 18008KT 9999 FEW040 SCT100 16/08 Q1016 NOSIG`;
  return {
    icao: s.icao,
    name: `${s.city} / ${s.name}`,
    raw,
    observedAt: isoHoursAgo(0.4),
    tempC: 16,
    dewpointC: 8,
    windDirDeg: 180,
    windKt: 8,
    gustKt: null,
    visM: 9999,
    altimeterHpa: 1016,
    flightCategory: "VFR",
    cover: "SCT",
    clouds: [
      { cover: "FEW", baseFt: 4000 },
      { cover: "SCT", baseFt: 10000 },
    ],
    lat: s.lat,
    lon: s.lon,
    elevM: s.elevM,
  };
}

function zuluNow(): string {
  const d = new Date();
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(Math.floor(d.getUTCMinutes() / 30) * 30).padStart(2, "0");
  return `${dd}${hh}${mm}Z`;
}

export function mockTaf(icao: string): TafForecast {
  const s = requireStation(icao);
  const from = isoHoursAgo(2);
  const to = isoHoursFromNow(22);
  return {
    icao: s.icao,
    name: `${s.city} / ${s.name}`,
    raw: `TAF ${s.icao} ${zuluNow()} ${zuluNow().slice(0, 2)}00/${zuluNow().slice(0, 2)}24 18010KT 9999 FEW050 SCT120 TX23/19Z TN08/10Z BECMG 0204 13004KT SCT140 TEMPO 0813 4000 BR NSC`,
    issuedAt: isoHoursAgo(3),
    validFrom: from,
    validTo: to,
    lat: s.lat,
    lon: s.lon,
    periods: [
      {
        from,
        to: isoHoursFromNow(4),
        change: null,
        probability: null,
        windDirDeg: 180,
        windKt: 10,
        visM: 9999,
        wx: null,
        clouds: [
          { cover: "FEW", baseFt: 5000 },
          { cover: "SCT", baseFt: 12000 },
        ],
        flightCategory: "VFR",
      },
      {
        from: isoHoursFromNow(4),
        to: isoHoursFromNow(10),
        change: "BECMG",
        probability: null,
        windDirDeg: 130,
        windKt: 4,
        visM: 9999,
        wx: null,
        clouds: [{ cover: "SCT", baseFt: 14000 }],
        flightCategory: "VFR",
      },
      {
        from: isoHoursFromNow(10),
        to: isoHoursFromNow(16),
        change: "TEMPO",
        probability: null,
        windDirDeg: null,
        windKt: null,
        visM: 4000,
        wx: "BR",
        clouds: [{ cover: "NSC", baseFt: null }],
        flightCategory: "IFR",
      },
    ],
  };
}

function mockLevels(baseTemp: number): VerticalSample[] {
  const hpas = [1000, 925, 850, 700, 500, 300] as const;
  const lapse = [0, 4, 8, 16, 32, 48];
  return hpas.map((hpa, i) => ({
    hpa,
    flApprox: LEVEL_FL[hpa],
    tempC: Math.round((baseTemp - lapse[i]) * 10) / 10,
    rhPct: [62, 58, 48, 40, 35, 28][i],
    windKt: [8, 12, 18, 32, 48, 62][i],
    windDirDeg: [180, 190, 210, 230, 250, 260][i],
    heightM: [110, 760, 1480, 3010, 5680, 9180][i],
  }));
}

export function mockGramet(fromIcao: string, toIcao: string): GrametProduct {
  const from = requireStation(fromIcao);
  const to = requireStation(toIcao);
  const columns: GrametColumn[] = Array.from({ length: 6 }, (_, i) => {
    const t = i / 5;
    return {
      km: Math.round(t * 910),
      lat: from.lat + (to.lat - from.lat) * t,
      lon: from.lon + (to.lon - from.lon) * t,
      label: i === 0 ? from.icao : i === 5 ? to.icao : undefined,
      surfaceTempC: 16 - i * 1.2,
      cloudPct: 20 + i * 12,
      precipMm: i > 3 ? 0.4 : 0,
      weatherCode: i > 3 ? 51 : 2,
      levels: mockLevels(16 - i),
    };
  });
  return {
    fromIcao: from.icao,
    toIcao: to.icao,
    fromName: from.city,
    toName: to.city,
    validTime: new Date().toISOString(),
    distanceKm: 910,
    columns,
  };
}

export function mockGamet(firLabel: string): GametBulletin {
  const from = isoHoursFromNow(0);
  const to = isoHoursFromNow(6);
  const raw = `${firLabel} GAMET VALID ${zuluNow()}/${zuluNow().slice(0, 2)}1200 SCEL-
SECN I
SFC WIND: 10/18KT
SFC VIS: 8KM BR IN VALLEYS TIL 12Z
SIG CLOUD: BKN 040/100 ANDES
ICE: MOD FZLVL 11000FT
TURB: MOD ABV 080 ANDES
SIGMET: NIL
SECN II
PSYS: TROUGH OVER SCTE MOV E 15KT
WIND/T: 2000FT 180/12KT PS12 5000FT 210/18KT PS06 10000FT 240/32KT MS02
CLD: FEW/SCT CU 040/100
FZLVL: 11000FT
MNM QNH: 1012 HPA
=`;
  return {
    fir: firLabel,
    firLabel,
    validFrom: from,
    validTo: to,
    raw,
    sigmets: [],
    sections: [
      {
        title: "Section I — hazards for low-level flight",
        lines: [
          "SFC WIND: 10/18 KT, locally 22 KT on the coast",
          "SFC VIS: 8 KM, BR in Central Valley until 12Z",
          "SIG CLOUD: BKN 040/100 along the Andes",
          "ICE: MOD in cloud, freezing level 11 000 ft",
          "TURB: MOD above 8 000 ft over the Andes",
          "SIGMET: NIL in this mock bulletin",
        ],
      },
      {
        title: "Section II — additional information",
        lines: [
          "PSYS: trough near Puerto Montt moving east 15 KT",
          "WIND/T 2 000 ft: 180/12 KT +12",
          "WIND/T 5 000 ft: 210/18 KT +06",
          "WIND/T 10 000 ft: 240/32 KT −02",
          "CLD: FEW/SCT CU 040/100",
          "FZLVL: 11 000 ft",
          "MNM QNH: 1012 hPa",
        ],
      },
    ],
  };
}

export function mockForecast(icao: string): PointForecast {
  const s = requireStation(icao);
  const hours: ForecastHour[] = Array.from({ length: 48 }, (_, i) => {
    const time = isoHoursFromNow(i - new Date().getUTCHours());
    const diurnal = Math.sin(((i % 24) - 6) / 24 * Math.PI * 2);
    return {
      time,
      tempC: Math.round((14 + diurnal * 7) * 10) / 10,
      rhPct: Math.round(70 - diurnal * 20),
      precipMm: i % 17 === 0 ? 0.6 : 0,
      cloudPct: 40 + (i % 5) * 8,
      windKt: 6 + (i % 4),
      windDirDeg: 180 + (i % 6) * 5,
      visKm: 10,
      weatherCode: i % 17 === 0 ? 51 : 2,
    };
  });
  return {
    icao: s.icao,
    name: `${s.city} / ${s.name}`,
    model: "Mock WRF-style (offline)",
    lat: s.lat,
    lon: s.lon,
    elevM: s.elevM,
    hours,
  };
}

export function mockVizStations(): VizStation[] {
  return ["SCAR", "SCFA", "SCEL", "SCIE", "SCTE", "SCCI"].map((icao) => {
    const s = getStation(icao)!;
    return {
      icao: s.icao,
      name: s.city,
      lat: s.lat,
      lon: s.lon,
      elevM: s.elevM,
      flightCategory: icao === "SCTE" ? "MVFR" : "VFR",
      tempC: 14,
      windKt: 10,
      windDirDeg: 200,
      cloudPct: 45,
      precipMm: 0,
      levels: mockLevels(14),
    };
  });
}

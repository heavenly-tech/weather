/**
 * Write METAR/TAF parity inputs and the JSON.stringify bytes of the TypeScript
 * encoder. Recorded cases read the committed Open-Meteo bodies. This does not
 * fetch. Run from the repo root:
 *   npx tsx scripts/capture-metar-taf-parity.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { STAMP } from "../src/lib/andes/wmo-metar";
import { renderCeilingParity } from "./ceiling-parity-render";

const root = path.resolve(process.cwd(), "server-rs/tests/fixtures/parity");

type Role = "night" | "missing-field";

type Built = {
  id: string;
  source: string;
  role?: Role;
  input: Record<string, unknown>;
};

type RecordedBody = {
  elevation: number;
  latitude: number;
  longitude: number;
  hourly: { time: string[] };
};

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function recorded(modelFile: string): RecordedBody {
  return readJson(path.resolve(process.cwd(), "tests/fixtures/recorded", modelFile)) as RecordedBody;
}

function timesFrom(start: string, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(`${start}Z`);
    d.setUTCHours(d.getUTCHours() + i);
    out.push(d.toISOString().slice(0, 16));
  }
  return out;
}

function fill(count: number, value: number): number[] {
  return Array(count).fill(value);
}

const ecmwf = recorded("sctb-ecmwf-ifs025-2026-11-18.json");
const gfs = recorded("sctb-gfs-seamless-2026-11-18.json");

function recordedMetar(opts: {
  id: string;
  file: string;
  body: RecordedBody;
  model: string;
  stamp: string;
  role?: Role;
  note: string;
}): Built {
  const index = opts.body.hourly.time.indexOf(opts.stamp);
  if (index < 0) throw new Error(`${opts.file} has no ${opts.stamp}`);
  return {
    id: opts.id,
    source: `tests/fixtures/recorded/${opts.file}`,
    role: opts.role,
    input: {
      label: "recorded",
      op: "generateModelMetar",
      role: opts.role,
      source: `tests/fixtures/recorded/${opts.file}`,
      model: opts.model,
      icao: "SCTB",
      latitude: -33.456,
      longitude: -70.546,
      modelLatitude: opts.body.latitude,
      modelLongitude: opts.body.longitude,
      modelElevationM: opts.body.elevation,
      elevM: 649,
      hourIndex: index,
      runTime: `${opts.stamp}:00Z`,
      validTime: `${opts.stamp}:00Z`,
      note: opts.note,
      hourly: opts.body.hourly,
    },
  };
}

function recordedTaf(opts: { id: string; file: string; body: RecordedBody; model: string; note: string }): Built {
  return {
    id: opts.id,
    source: `tests/fixtures/recorded/${opts.file}`,
    input: {
      label: "recorded",
      op: "generateModelTaf",
      source: `tests/fixtures/recorded/${opts.file}`,
      model: opts.model,
      icao: "SCTB",
      latitude: -33.456,
      longitude: -70.546,
      modelLatitude: opts.body.latitude,
      modelLongitude: opts.body.longitude,
      modelElevationM: opts.body.elevation,
      elevM: 649,
      runTime: "2026-11-16T20:00:00Z",
      note: opts.note,
      hourly: opts.body.hourly,
    },
  };
}

function windShift(start: string, count: number, flipAt: string): Record<string, unknown> {
  const time = timesFrom(start, count);
  const wind = time.map((stamp) => (stamp >= flipAt ? 50 : 18));
  return {
    time,
    temperature_2m: fill(count, 16),
    dew_point_2m: fill(count, 6),
    relative_humidity_2m: fill(count, 40),
    visibility: fill(count, 9999),
    wind_speed_10m: wind,
    wind_direction_10m: fill(count, 200),
    wind_gusts_10m: wind,
    precipitation: fill(count, 0),
    rain: fill(count, 0),
    showers: fill(count, 0),
    surface_pressure: fill(count, 980),
    cloud_cover_low: fill(count, 5),
    cloud_cover_925hPa: fill(count, 5),
    geopotential_height_925hPa: fill(count, 1600),
  };
}

const cases: Built[] = [
  recordedMetar({
    id: "metar-sctb-ecmwf-night",
    file: "sctb-ecmwf-ifs025-2026-11-18.json",
    body: ecmwf,
    model: "ecmwf_ifs025",
    stamp: "2026-11-17T05:00",
    role: "night",
    note: "02:00 local (CLST, UTC−3). visibility is null for the whole response, so the METAR visibility is estimated. cape and convective_cloud_base are absent.",
  }),
  recordedMetar({
    id: "metar-sctb-ecmwf-missing-field",
    file: "sctb-ecmwf-ifs025-2026-11-18.json",
    body: ecmwf,
    model: "ecmwf_ifs025",
    stamp: "2026-11-17T18:00",
    role: "missing-field",
    note: "15:00 local. visibility is a null series. geopotential_height and cloud_cover at 975, 950, 900, and 800 hPa are null series. cape and convective_cloud_base are absent. No key was deleted by hand.",
  }),
  recordedTaf({
    id: "taf-sctb-ecmwf",
    file: "sctb-ecmwf-ifs025-2026-11-18.json",
    body: ecmwf,
    model: "ecmwf_ifs025",
    note: "Issue 2026-11-16T20:00Z so the 24 h validity includes the 2026-11-17T05:00Z night hour. Same raw ECMWF body as the night and missing-field METARs.",
  }),
  recordedMetar({
    id: "metar-sctb-gfs",
    file: "sctb-gfs-seamless-2026-11-18.json",
    body: gfs,
    model: "gfs_seamless",
    stamp: "2026-11-17T05:00",
    role: "night",
    note: "Same civil night on GFS, the other model the encoder uses. GFS visibility is observed. cape and convective_cloud_base are absent because the point query does not request them.",
  }),
  recordedTaf({
    id: "taf-sctb-gfs",
    file: "sctb-gfs-seamless-2026-11-18.json",
    body: gfs,
    model: "gfs_seamless",
    note: "GFS TAF from the same recorded point series, issued 2026-11-16T20:00Z.",
  }),
  {
    id: "metar-temp-half",
    source: "src/lib/andes/wmo-metar.ts formatTempGroup",
    input: {
      label: "EXAMPLE",
      op: "generateModelMetar",
      note: "Math.round(Math.abs(-1.5)) is 2 and Math.round(Math.abs(-0.5)) is 1, so the group is M02/M01. The signed JS half (-1.5 → -1) is not what this formatter does.",
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T06:00:00Z",
      validTime: "2026-11-17T06:00:00Z",
      hourIndex: 0,
      hourly: {
        time: ["2026-11-17T06:00"],
        temperature_2m: [-1.5],
        dew_point_2m: [-0.5],
        pressure_msl: [1013],
        relative_humidity_2m: [90],
        visibility: [9999],
        wind_speed_10m: [10],
        wind_direction_10m: [180],
        surface_pressure: [940],
      },
    },
  },
  {
    id: "metar-temp-m00",
    source: "src/lib/andes/wmo-metar.ts formatTempGroup",
    input: {
      label: "EXAMPLE",
      op: "generateModelMetar",
      note: "Values in (-0.5, 0) round through Math.abs to 0 and are encoded M00. The later M00 branch in the source is unreachable.",
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T06:00:00Z",
      validTime: "2026-11-17T06:00:00Z",
      hourIndex: 0,
      hourly: {
        time: ["2026-11-17T06:00"],
        temperature_2m: [-0.4],
        dew_point_2m: [-0.1],
        pressure_msl: [1013],
        relative_humidity_2m: [95],
        visibility: [9999],
        wind_speed_10m: [10],
        wind_direction_10m: [180],
        surface_pressure: [940],
      },
    },
  },
  {
    id: "taf-dd24",
    source: "src/lib/andes/wmo-taf.ts changeWindow",
    input: {
      label: "EXAMPLE",
      op: "generateModelTaf",
      note: "Validity ends at midnight and the last change is clamped to 1823/1824, never 1900.",
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T23:17:00Z",
      hourly: windShift("2026-11-17T18:00", 36, "2026-11-18T23:00"),
    },
  },
  {
    id: "taf-cross-midnight",
    source: "src/lib/andes/wmo-taf.ts changeWindow",
    input: {
      label: "EXAMPLE",
      op: "generateModelTaf",
      note: "Validity 1812/1912 keeps BECMG 1823/1901. DD24 is only the midnight end, not every window that crosses midnight.",
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-18T11:17:00Z",
      hourly: windShift("2026-11-18T12:00", 30, "2026-11-18T23:00"),
    },
  },
  {
    id: "metar-ecmwf-trace",
    source: "src/lib/andes/wmo-metar-wx.ts",
    input: {
      label: "EXAMPLE",
      op: "generateModelMetar",
      note: "ECMWF trace rain 0.15 mm/h with total cloud under 25% drops -SHRA and -RA.",
      icao: "SCTB",
      elevM: 649,
      model: "ecmwf_ifs025",
      runTime: "2026-11-17T18:00:00Z",
      validTime: "2026-11-17T18:00:00Z",
      hourIndex: 0,
      hourly: {
        time: ["2026-11-17T18:00"],
        temperature_2m: [16],
        dew_point_2m: [8],
        relative_humidity_2m: [55],
        precipitation: [0.15],
        rain: [0.15],
        showers: [0],
        visibility: [9000],
        cloud_cover_low: [4],
        cloud_cover_mid: [6],
        cloud_cover: [12],
        surface_pressure: [980],
        geopotential_height_700hPa: [3100],
        cape: [0],
        pressure_msl: [1013],
        wind_speed_10m: [12],
        wind_direction_10m: [200],
      },
    },
  },
  {
    id: "metar-ecmwf-mid-deck",
    source: "src/lib/andes/wmo-metar-wx.ts",
    input: {
      label: "EXAMPLE",
      op: "generateModelMetar",
      note: "Mid cloud at least 50% with no convective signal is -RA and BKN at 700 hPa.",
      icao: "SCTB",
      elevM: 649,
      model: "ecmwf_ifs025",
      runTime: "2026-11-17T18:00:00Z",
      validTime: "2026-11-17T18:00:00Z",
      hourIndex: 0,
      hourly: {
        time: ["2026-11-17T18:00"],
        temperature_2m: [12],
        dew_point_2m: [8],
        relative_humidity_2m: [70],
        precipitation: [0.4],
        rain: [0.4],
        showers: [0],
        visibility: [9000],
        cloud_cover_low: [8],
        cloud_cover_mid: [60],
        cloud_cover: [40],
        surface_pressure: [980],
        geopotential_height_700hPa: [3100],
        cape: [0],
        pressure_msl: [1013],
        wind_speed_10m: [12],
        wind_direction_10m: [200],
      },
    },
  },
  {
    id: "metar-ecmwf-600",
    source: "src/lib/andes/wmo-metar-wx.ts",
    input: {
      label: "EXAMPLE",
      op: "generateModelMetar",
      note: "700 hPa height is absent, so the light-rain base is the 600 hPa height.",
      icao: "SCTB",
      elevM: 649,
      model: "ecmwf_ifs025",
      runTime: "2026-11-17T06:00:00Z",
      validTime: "2026-11-17T06:00:00Z",
      hourIndex: 0,
      hourly: {
        time: ["2026-11-17T06:00"],
        temperature_2m: [9],
        dew_point_2m: [8.6],
        relative_humidity_2m: [96],
        precipitation: [0.3],
        rain: [0.3],
        showers: [0],
        visibility: [8000],
        cloud_cover_low: [2],
        cloud_cover_mid: [8],
        cloud_cover: [12],
        surface_pressure: [980],
        geopotential_height_600hPa: [4200],
        pressure_msl: [1014],
        wind_speed_10m: [4],
        wind_direction_10m: [160],
      },
    },
  },
  {
    id: "metar-ecmwf-600-deck",
    source: "src/lib/andes/wmo-metar-wx.ts",
    input: {
      label: "EXAMPLE",
      op: "generateModelMetar",
      note: "700 hPa height is null and mid cloud is 60%, so the stratiform deck is BKN at 600 hPa.",
      icao: "SCTB",
      elevM: 649,
      model: "ecmwf_ifs025",
      runTime: "2026-11-17T18:00:00Z",
      validTime: "2026-11-17T18:00:00Z",
      hourIndex: 0,
      hourly: {
        time: ["2026-11-17T18:00"],
        temperature_2m: [12],
        dew_point_2m: [8],
        relative_humidity_2m: [70],
        precipitation: [0.4],
        rain: [0.4],
        showers: [0],
        visibility: [9000],
        cloud_cover_low: [8],
        cloud_cover_mid: [60],
        cloud_cover: [40],
        surface_pressure: [980],
        geopotential_height_700hPa: [null],
        geopotential_height_600hPa: [4200],
        cape: [0],
        pressure_msl: [1013],
        wind_speed_10m: [12],
        wind_direction_10m: [200],
      },
    },
  },
  {
    id: "metar-ecmwf-missing-mid",
    source: "src/lib/andes/wmo-metar-wx.ts",
    input: {
      label: "EXAMPLE",
      op: "generateModelMetar",
      note: "cloud_cover_mid is absent. The hour stays on the low-cloud shower decision.",
      icao: "SCTB",
      elevM: 649,
      model: "ecmwf_ifs025",
      runTime: "2026-11-17T18:00:00Z",
      validTime: "2026-11-17T18:00:00Z",
      hourIndex: 0,
      hourly: {
        time: ["2026-11-17T18:00"],
        temperature_2m: [16],
        dew_point_2m: [8],
        relative_humidity_2m: [55],
        precipitation: [0.4],
        rain: [0.4],
        showers: [0],
        visibility: [9000],
        cloud_cover_low: [8],
        cloud_cover: [40],
        surface_pressure: [980],
        geopotential_height_700hPa: [3100],
        cape: [0],
        pressure_msl: [1013],
        wind_speed_10m: [12],
        wind_direction_10m: [180],
      },
    },
  },
  {
    id: "metar-ecmwf-null-mid",
    source: "src/lib/andes/wmo-metar-wx.ts",
    input: {
      label: "EXAMPLE",
      op: "generateModelMetar",
      note: "cloud_cover_mid is a null cell. Same low-cloud decision as an absent mid series.",
      icao: "SCTB",
      elevM: 649,
      model: "ecmwf_ifs025",
      runTime: "2026-11-17T18:00:00Z",
      validTime: "2026-11-17T18:00:00Z",
      hourIndex: 0,
      hourly: {
        time: ["2026-11-17T18:00"],
        temperature_2m: [16],
        dew_point_2m: [8],
        relative_humidity_2m: [55],
        precipitation: [0.4],
        rain: [0.4],
        showers: [0],
        visibility: [9000],
        cloud_cover_low: [8],
        cloud_cover_mid: [null],
        cloud_cover: [40],
        surface_pressure: [980],
        geopotential_height_700hPa: [3100],
        cape: [0],
        pressure_msl: [1013],
        wind_speed_10m: [12],
        wind_direction_10m: [180],
      },
    },
  },
  {
    id: "metar-bkn-unk",
    source: "src/lib/andes/wmo-metar-wx.ts",
    input: {
      label: "EXAMPLE",
      op: "generateModelMetar",
      note: "Hot spread makes the LCL implausible, so the METAR cloud group is BKN/// and the remark is CLD BASE UNK.",
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-08-18T12:00:00Z",
      validTime: "2026-08-18T12:00:00Z",
      hourIndex: 0,
      hourly: {
        time: ["2026-08-18T12:00"],
        temperature_2m: [26],
        dew_point_2m: [9],
        relative_humidity_2m: [40],
        pressure_msl: [1010],
        wind_speed_10m: [10],
        wind_direction_10m: [230],
        wind_gusts_10m: [20],
        visibility: [9999],
        precipitation: [0],
        rain: [0],
        showers: [0],
        cloud_cover_low: [90],
        surface_pressure: [980],
        cloud_cover_925hPa: [10],
        geopotential_height_925hPa: [800],
        cloud_cover_850hPa: [20],
        geopotential_height_850hPa: [1600],
      },
    },
  },
  {
    id: "taf-validator-dd24",
    source: "src/lib/andes/taf-format.ts",
    input: {
      label: "EXAMPLE",
      op: "assertModelTafFormat",
      note: "A validity ending at midnight accepts BECMG 1823/1824.",
      raw: `${STAMP}\nTAF SCTB 172317Z 1800/1824 VRB01KT 9999 NSC BECMG 1823/1824 VRB01KT 9999 NSC RMK GEN=x`,
    },
  },
  {
    id: "taf-validator-dd00",
    source: "src/lib/andes/taf-format.ts",
    input: {
      label: "EXAMPLE",
      op: "assertModelTafFormat",
      note: "The same window written 1823/1900 is rejected. Midnight is DD24.",
      raw: `${STAMP}\nTAF SCTB 172317Z 1800/1824 VRB01KT 9999 NSC BECMG 1823/1900 VRB01KT 9999 NSC RMK GEN=x`,
    },
  },
];

async function main(): Promise<void> {
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) as {
    label: string;
    description: string;
    cases: { id: string; label: string; role?: string; source?: string; method?: string; path?: string }[];
  };
  const owned = new Set(cases.map((entry) => entry.id));
  manifest.cases = manifest.cases.filter((entry) => !owned.has(entry.id));
  manifest.description =
    "Byte-identical TypeScript vs Rust outputs. Each case id has a sibling <id>.body captured from the TypeScript function. Recorded cases are real SCTB Open-Meteo responses. The set includes a night hour and a missing-field hour (null or absent series), plus EXAMPLE cases. METAR and TAF bodies are JSON.stringify of the raw string and the validator result. Add a case and a renderer in both languages; the compare stays exact.";
  for (const entry of cases) {
    const row: { id: string; source: string; label: string; role?: Role } = {
      id: entry.id,
      source: entry.source,
      label: entry.input.label === "recorded" ? "recorded" : "EXAMPLE",
    };
    if (entry.role) row.role = entry.role;
    manifest.cases.push(row);
    const inputPath = path.join(root, `${entry.id}.input.json`);
    writeFileSync(inputPath, `${JSON.stringify(entry.input, null, 2)}\n`);
    const stored = readJson(inputPath);
    const rendered = await renderCeilingParity(stored);
    const text = JSON.stringify(rendered);
    if (text === undefined) throw new Error(`${entry.id} rendered undefined`);
    writeFileSync(path.join(root, `${entry.id}.body`), text);
    console.log(entry.id, text.length);
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

void main();

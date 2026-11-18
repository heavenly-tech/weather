/**
 * Write EXAMPLE ceiling/regrid inputs and the JSON.stringify bytes of the
 * TypeScript functions. Run from the repo root:
 *   npx tsx scripts/capture-ceiling-parity.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderCeilingParity } from "./ceiling-parity-render";

const root = path.resolve(process.cwd(), "server-rs/tests/fixtures/parity");

type Case = {
  id: string;
  source: string;
  input: unknown;
  role?: string;
};

function readHourly(name: string): unknown {
  const file = path.resolve(process.cwd(), "tests/fixtures", name);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { hourly: unknown };
  return parsed.hourly;
}

const sctbRecordedPath = path.resolve(
  process.cwd(),
  "tests/fixtures/recorded/sctb-icon-seamless-2026-11-18.json"
);
const sctbRecorded = JSON.parse(readFileSync(sctbRecordedPath, "utf8")) as {
  elevation: number;
  latitude: number;
  longitude: number;
  hourly: { time: string[] };
};

function sctbRecordedHour(stamp: string, role: "night" | "missing-field", note: string): Case {
  const index = sctbRecorded.hourly.time.indexOf(stamp);
  if (index < 0) throw new Error(`recorded SCTB response has no ${stamp}`);
  return {
    id: role === "night" ? "ceiling-sctb-night" : "ceiling-sctb-missing-field",
    source: "tests/fixtures/recorded/sctb-icon-seamless-2026-11-18.json",
    role,
    input: {
      label: "recorded",
      op: "ceilingFromHourly",
      role,
      source: "tests/fixtures/recorded/sctb-icon-seamless-2026-11-18.json",
      model: "icon_seamless",
      icao: "SCTB",
      latitude: -33.456,
      longitude: -70.546,
      modelLatitude: sctbRecorded.latitude,
      modelLongitude: sctbRecorded.longitude,
      modelElevationM: sctbRecorded.elevation,
      terrainElevM: 649,
      index,
      validTime: stamp,
      note,
      hourly: sctbRecorded.hourly,
    },
  };
}

const sctbHourly = {
  time: ["2026-11-18T15:00"],
  surface_pressure: [950.2],
  cloud_cover: [70],
  cloud_cover_low: [35],
  cloud_cover_mid: [60],
  cloud_cover_high: [10],
  temperature_2m: [18.4],
  dew_point_2m: [9.1],
  relative_humidity_2m: [55],
  pressure_msl: [1016.4],
  wind_speed_10m: [12.5],
  wind_direction_10m: [220],
  wind_gusts_10m: [20.1],
  visibility: [9000],
  precipitation: [0],
  rain: [0],
  showers: [0],
  snowfall: [0],
  weather_code: [3],
  convective_cloud_base: [2100],
  cape: [40],
  cloud_cover_1000hPa: [90],
  geopotential_height_1000hPa: [110],
  relative_humidity_1000hPa: [95],
  cloud_cover_975hPa: [null],
  geopotential_height_975hPa: [280],
  relative_humidity_975hPa: [null],
  cloud_cover_950hPa: [15],
  geopotential_height_950hPa: [720],
  relative_humidity_950hPa: [70],
  cloud_cover_925hPa: [25],
  geopotential_height_925hPa: [980],
  relative_humidity_925hPa: [60],
  cloud_cover_900hPa: [40],
  geopotential_height_900hPa: [1200],
  relative_humidity_900hPa: [55],
  cloud_cover_850hPa: [85],
  geopotential_height_850hPa: [1580],
  relative_humidity_850hPa: [80],
  cloud_cover_800hPa: [20],
  geopotential_height_800hPa: [2100],
  relative_humidity_800hPa: [40],
  cloud_cover_700hPa: [5],
  geopotential_height_700hPa: [3100],
  relative_humidity_700hPa: [20],
  cloud_cover_600hPa: [null],
  geopotential_height_600hPa: [null],
  relative_humidity_600hPa: [null],
  cloud_cover_500hPa: [null],
  geopotential_height_500hPa: [4300],
  relative_humidity_500hPa: [10],
  cloud_cover_400hPa: [null],
  geopotential_height_400hPa: [null],
  relative_humidity_400hPa: [null],
  cloud_cover_300hPa: [null],
  geopotential_height_300hPa: [null],
  relative_humidity_300hPa: [null],
};

function isolatedGrid(): unknown {
  const rows = 11;
  const cols = 8;
  const cells = Array.from({ length: rows * cols }, () => ({
    lat: 0,
    lon: 0,
    baseMslM: null as number | null,
    obscured: false,
    lowCloudUnresolved: false,
    precipMmH: 0,
  }));
  const isolated = 5 * cols + 3;
  const cell = cells[isolated];
  if (!cell) throw new Error("isolated index");
  cells[isolated] = { ...cell, baseMslM: 1800, precipMmH: 6 };
  return {
    label: "EXAMPLE",
    op: "refineCeilingGrid",
    note: "EXAMPLE isolated coarse cell inside the 11×8 domain. Fine lat/lon run from the north-west corner (-32.1, -71.8) to the south-east corner (-34.8, -70). Neighbourhood keeps min base and max precip, not a bilinear blend.",
    rows,
    cols,
    cells,
  };
}

const cases: Case[] = [
  {
    id: "ceiling-recorded-interpolate",
    source: "src/lib/andes/ceiling.ts interpolateCloudBaseMsl",
    input: {
      label: "EXAMPLE",
      op: "interpolateCloudBaseMsl",
      note: "Recorded tests/fixtures/open-meteo-hourly.json hour 0, terrain 600 m, surface 1015 hPa.",
      terrainElevM: 600,
      index: 0,
      surfaceHpa: 1015,
      hourly: readHourly("open-meteo-hourly.json"),
    },
  },
  {
    id: "ceiling-recorded-underground",
    source: "src/lib/andes/ceiling.ts ceilingFromHourly",
    input: {
      label: "EXAMPLE",
      op: "ceilingFromHourly",
      note: "Recorded tests/fixtures/underground-cloud-levels.json. 1000/975 hPa are underground at 474 m.",
      terrainElevM: 474,
      index: 0,
      hourly: readHourly("underground-cloud-levels.json"),
    },
  },
  {
    id: "ceiling-sctb-shape",
    source: "src/lib/andes/ceiling.ts ceilingFromHourly",
    input: {
      label: "EXAMPLE",
      op: "ceilingFromHourly",
      note: "EXAMPLE values in the hourly key shape of an Open-Meteo ICON point response (docs/validation/scel-2026-11-17), plus the ceiling keys a grid fetch adds. Terrain is SCTB at 649 m. Not a live fetch.",
      focus: { icao: "SCTB", lat: -33.456, lon: -70.546, elevM: 649 },
      terrainElevM: 649,
      index: 0,
      hourly: sctbHourly,
    },
  },
  {
    id: "ceiling-nulls-negatives",
    source: "src/lib/andes/ceiling.ts ceilingFromHourly",
    input: {
      label: "EXAMPLE",
      op: "ceilingFromHourly",
      note: "EXAMPLE nulls, a negative convective base, negative terrain, and non-finite cover. Surface RH stays below the fog gate so the interpolated base stays negative and feet stay positive. Null does not become 0.",
      terrainElevM: -100,
      index: 0,
      hourly: {
        time: ["t"],
        surface_pressure: [null],
        convective_cloud_base: [-40],
        showers: [-2],
        rain: [null],
        precipitation: ["NaN"],
        cloud_cover_low: [null],
        cape: [-5],
        visibility: [null],
        relative_humidity_2m: [50],
        cloud_cover_850hPa: [80],
        geopotential_height_850hPa: [-40],
        cloud_cover_700hPa: ["Infinity"],
        geopotential_height_700hPa: [3000],
      },
    },
  },
  {
    id: "ceiling-isa-649",
    source: "src/lib/andes/ceiling.ts surfacePressureHpa",
    input: {
      label: "EXAMPLE",
      op: "surfacePressureHpa",
      note: "EXAMPLE SCTB elevation with no surface_pressure key. Locks the ISA pow path.",
      terrainElevM: 649,
      index: 0,
      hourly: { time: ["t"] },
    },
  },
  {
    id: "ceiling-isa-out-of-range",
    source: "src/lib/andes/ceiling.ts surfacePressureHpa",
    input: {
      label: "EXAMPLE",
      op: "surfacePressureHpa",
      note: "EXAMPLE surface pressure below 400 hPa falls through to the ISA formula.",
      terrainElevM: 649,
      index: 0,
      hourly: { surface_pressure: [50] },
    },
  },
  {
    id: "ceiling-surface-950-2",
    source: "src/lib/andes/ceiling.ts surfacePressureHpa",
    input: {
      label: "EXAMPLE",
      op: "surfacePressureHpa",
      note: "A valid surface pressure is returned as-is. Math.round is only applied to the interpolation floor.",
      terrainElevM: 649,
      index: 0,
      hourly: { surface_pressure: [950.2] },
    },
  },
  {
    id: "ceiling-vis-lifr",
    source: "src/lib/andes/ceiling.ts ceilingFromHourly",
    input: {
      label: "EXAMPLE",
      op: "ceilingFromHourly",
      note: "EXAMPLE high base with 1200 m visibility. That is LIFR visibility (under 1 SM) but not the fog gate (under 1000 m), so the ceiling stays high.",
      terrainElevM: 474,
      index: 0,
      hourly: {
        time: ["t"],
        surface_pressure: [955],
        visibility: [1200],
        cloud_cover_850hPa: [80],
        geopotential_height_850hPa: [5000],
      },
    },
  },
  {
    id: "ceiling-fog",
    source: "src/lib/andes/ceiling.ts ceilingFromHourly",
    input: {
      label: "EXAMPLE",
      op: "ceilingFromHourly",
      note: "EXAMPLE visibility under 1000 m. Fog replaces the higher stratiform base.",
      terrainElevM: 474,
      index: 0,
      hourly: {
        time: ["t"],
        surface_pressure: [980],
        visibility: [400],
        cloud_cover_850hPa: [80],
        geopotential_height_850hPa: [1600],
      },
    },
  },
  {
    id: "ceiling-low-cloud-unresolved",
    source: "src/lib/andes/ceiling.ts ceilingFromHourly",
    input: {
      label: "EXAMPLE",
      op: "ceilingFromHourly",
      terrainElevM: 474,
      index: 0,
      hourly: {
        time: ["t"],
        surface_pressure: [990],
        cloud_cover_low: [55],
        cloud_cover_925hPa: [40],
        geopotential_height_925hPa: [1200],
        cloud_cover_850hPa: [30],
        geopotential_height_850hPa: [1600],
      },
    },
  },
  {
    id: "ceiling-moist-140m",
    source: "src/lib/andes/ceiling.ts ceilingFromHourly",
    input: {
      label: "EXAMPLE",
      op: "ceilingFromHourly",
      terrainElevM: 480,
      index: 0,
      hourly: {
        time: ["t"],
        surface_pressure: [980],
        cloud_cover_925hPa: [80],
        geopotential_height_925hPa: [480 + 140],
        cloud_cover_850hPa: [20],
        geopotential_height_850hPa: [1600],
      },
    },
  },
  {
    id: "ceiling-convective-ignored",
    source: "src/lib/andes/ceiling.ts ceilingFromHourly",
    input: {
      label: "EXAMPLE",
      op: "ceilingFromHourly",
      terrainElevM: 474,
      index: 0,
      hourly: {
        time: ["t"],
        surface_pressure: [955],
        convective_cloud_base: [1200],
        showers: [0],
        cloud_cover_low: [10],
        cloud_cover_850hPa: [5],
        geopotential_height_850hPa: [1600],
      },
    },
  },
  {
    id: "ceiling-cape-only",
    source: "src/lib/andes/ceiling.ts ceilingFromHourly",
    input: {
      label: "EXAMPLE",
      op: "ceilingFromHourly",
      terrainElevM: 474,
      index: 0,
      hourly: {
        time: ["t"],
        surface_pressure: [955],
        convective_cloud_base: [1200],
        cape: [250],
        showers: [0],
        rain: [0],
        precipitation: [0],
        cloud_cover_low: [10],
        cloud_cover_850hPa: [5],
        geopotential_height_850hPa: [1600],
      },
    },
  },
  {
    id: "ceiling-showers",
    source: "src/lib/andes/ceiling.ts ceilingFromHourly",
    input: {
      label: "EXAMPLE",
      op: "ceilingFromHourly",
      terrainElevM: 474,
      index: 0,
      hourly: {
        time: ["t"],
        surface_pressure: [955],
        convective_cloud_base: [1200],
        showers: [0.5],
        cloud_cover_low: [20],
        cloud_cover_850hPa: [5],
        geopotential_height_850hPa: [1600],
      },
    },
  },
  {
    id: "neighbourhood-min-base",
    source: "src/lib/andes/ceiling-regrid.ts neighbourhoodBaseAndPrecip",
    input: {
      label: "EXAMPLE",
      op: "neighbourhoodBaseAndPrecip",
      corners: [
        { lat: 1, lon: 1, baseMslM: 1500, obscured: false, lowCloudUnresolved: false, precipMmH: 4.2 },
        { lat: 1, lon: 2, baseMslM: null, obscured: false, lowCloudUnresolved: false, precipMmH: 0 },
        null,
        { lat: 2, lon: 2, baseMslM: 3200, obscured: false, lowCloudUnresolved: false, precipMmH: 0.1 },
      ],
    },
  },
  {
    id: "neighbourhood-nulls-negatives",
    source: "src/lib/andes/ceiling-regrid.ts neighbourhoodBaseAndPrecip",
    input: {
      label: "EXAMPLE",
      op: "neighbourhoodBaseAndPrecip",
      note: "EXAMPLE negative base is the minimum. Null base is skipped. NaN precip is not finite and is skipped. Zero precip still counts.",
      corners: [
        { lat: -33.456, lon: -70.546, baseMslM: -20, obscured: false, lowCloudUnresolved: false, precipMmH: -3 },
        { lat: -33.456, lon: -70.5, baseMslM: null, obscured: false, lowCloudUnresolved: true, precipMmH: 0 },
        null,
        { lat: -33.5, lon: -70.5, baseMslM: 100, obscured: false, lowCloudUnresolved: false, precipMmH: "NaN" },
      ],
    },
  },
  {
    id: "neighbourhood-nan-base",
    source: "src/lib/andes/ceiling-regrid.ts neighbourhoodBaseAndPrecip",
    input: {
      label: "EXAMPLE",
      op: "neighbourhoodBaseAndPrecip",
      note: "A NaN base is not null, so Math.min returns NaN and JSON.stringify writes null.",
      corners: [
        { lat: 0, lon: 0, baseMslM: "NaN", obscured: false, lowCloudUnresolved: false, precipMmH: 1 },
        { lat: 0, lon: 1, baseMslM: 1500, obscured: false, lowCloudUnresolved: false, precipMmH: null },
      ],
    },
  },
  {
    id: "regrid-isolated-cell",
    source: "src/lib/andes/ceiling-regrid.ts refineCeilingGrid",
    input: isolatedGrid(),
  },
  sctbRecordedHour(
    "2026-11-17T05:00",
    "night",
    "Recorded Open-Meteo ICON point response for SCTB. 2026-11-17T05:00Z is 02:00 local (UTC−3). visibility is null at this hour. The negative convective base in the response must not become the ceiling."
  ),
  sctbRecordedHour(
    "2026-11-17T18:00",
    "missing-field",
    "Same recorded SCTB response. visibility is a series of JSON nulls at every hour, and cloud_cover_400hPa / geopotential_height_300hPa are absent. Neither becomes 0."
  ),
];

function jsNumberSamples(): string[] {
  const specials = [
    0, -0, 1, -1, 1800, -70, 62.5, 0.5, -1.5, 0.1, -0.1, 4.2, 950.2, 1013.25, 3.280839895,
    -32.1, -34.8, -71.8, -70, 649 * 3.280839895, 0.1 * 3.280839895,
    1013.25 * Math.pow(1 - 649 / 44330, 5.255), 1e-6, 1e-7, 1e-10, 1.23e-7, 5e-7, 9.87654321e-8,
    1e20, 1e21, 1e22, -1e21, 1.23e21, 5e-324, Number.MAX_VALUE, Number.MIN_VALUE,
    2.2250738585072014e-308, Math.PI, -Math.PI, 9007199254740992, 1.0000000000000002,
  ];
  let state = 0x2a89;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const randoms: number[] = [];
  for (let i = 0; i < 200; i++) {
    const unit = next();
    const decade = Math.floor(next() * 24) - 8;
    const sign = next() < 0.5 ? -1 : 1;
    randoms.push(sign * unit * 10 ** decade);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...specials, ...randoms]) {
    if (!Number.isFinite(value)) continue;
    const text = JSON.stringify(value);
    if (text === undefined || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

async function main(): Promise<void> {
  const manifestCases: Array<Record<string, string>> = [
    {
      id: "api-health",
      method: "GET",
      path: "/api/health",
      source: "src/app/api/health/route.ts",
      label: "EXAMPLE",
    },
  ];
  for (const entry of cases) {
    writeFileSync(path.join(root, `${entry.id}.input.json`), `${JSON.stringify(entry.input, null, 2)}\n`);
    const rendered = await renderCeilingParity(entry.input);
    writeFileSync(path.join(root, `${entry.id}.body`), JSON.stringify(rendered));
    const input = entry.input as { label?: string };
    const row: Record<string, string> = {
      id: entry.id,
      source: entry.source,
      label: input.label ?? "EXAMPLE",
    };
    if (entry.role) row.role = entry.role;
    manifestCases.push(row);
  }
  writeFileSync(
    path.join(root, "manifest.json"),
    `${JSON.stringify(
      {
        label: "EXAMPLE",
        description:
          "Byte-identical TypeScript vs Rust outputs. Each case id has a sibling <id>.body captured from the TypeScript function. Ceiling and regrid cases also have <id>.input.json. Recorded cases are real SCTB Open-Meteo responses and are labeled recorded. The set includes a night hour and a missing-field hour. Add a case and a renderer in both languages; the compare stays exact.",
        cases: manifestCases,
      },
      null,
      2
    )}\n`
  );
  writeFileSync(
    path.resolve(process.cwd(), "server-rs/tests/fixtures/js-json-numbers.json"),
    `${JSON.stringify(jsNumberSamples(), null, 2)}\n`
  );
}

void main();

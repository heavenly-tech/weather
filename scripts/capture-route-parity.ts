/**
 * Replay recorded SCTB Open-Meteo bodies through the Next route handlers.
 * No network. Run from the repo root:
 *   npx tsx scripts/capture-route-parity.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { clearOpenMeteoCache } from "../src/lib/andes/open-meteo-cache";
import { GET as modelsGet } from "../src/app/api/andes/models/route";
import { GET as timesGet } from "../src/app/api/andes/times/route";
import { GET as ceilingGet } from "../src/app/api/andes/ceiling/route";
import { GET as sliceGet } from "../src/app/api/andes/slice/route";
import { GET as timelineGet } from "../src/app/api/andes/timeline/route";
import { GET as coherenceGet } from "../src/app/api/andes/coherence/route";
import { GET as metarGet } from "../src/app/api/generated/metar/route";
import { GET as tafGet } from "../src/app/api/generated/taf/route";

const root = path.resolve(process.cwd(), "server-rs/tests/fixtures/routes");
mkdirSync(root, { recursive: true });

const ecmwf = JSON.parse(readFileSync("tests/fixtures/recorded/sctb-ecmwf-ifs025-2026-11-18.json", "utf8"));
const gfs = JSON.parse(readFileSync("tests/fixtures/recorded/sctb-gfs-seamless-2026-11-18.json", "utf8"));

type Upstream = { status: number; body: string; statusText?: string };

function copies(body: unknown, url: string): string {
  const query = new URL(url).searchParams.get("latitude") ?? "";
  const count = query.split(",").filter(Boolean).length;
  if (count <= 1) return JSON.stringify(body);
  return JSON.stringify(Array.from({ length: count }, () => body));
}

function upstream(kind: string, url: string, calls: { n: number }): Upstream {
  if (url.includes("aviationweather.gov")) {
    return { status: 502, body: "upstream", statusText: "Bad Gateway" };
  }
  if (kind === "429") return { status: 429, body: "", statusText: "Too Many Requests" };
  if (kind === "503") return { status: 503, body: "", statusText: "Service Unavailable" };
  if (kind === "ceiling-429") return { status: 429, body: "slow down", statusText: "Too Many Requests" };
  if (kind === "ceiling-500") return { status: 500, body: "boom", statusText: "Internal Server Error" };
  const model = new URL(url).searchParams.get("models") ?? "";
  if (model.startsWith("ecmwf_ifs025")) return { status: 200, body: copies(ecmwf, url), statusText: "OK" };
  if (model.startsWith("gfs_seamless")) return { status: 200, body: copies(gfs, url), statusText: "OK" };
  void calls;
  return { status: 502, body: "no recording", statusText: "Bad Gateway" };
}

const RealDate = Date;

function freeze(iso: string) {
  const fixed = RealDate.parse(iso);
  const Frozen = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) return new RealDate(fixed);
    return new RealDate(...(args as ConstructorParameters<DateConstructor>));
  };
  const ctor = Frozen as unknown as DateConstructor;
  ctor.now = () => fixed;
  ctor.parse = RealDate.parse;
  ctor.UTC = RealDate.UTC;
  Object.defineProperty(ctor, "prototype", { value: RealDate.prototype });
  globalThis.Date = ctor;
  Math.random = () => 0.5;
}

type Case = {
  id: string;
  path: string;
  clock: string;
  upstream: string;
  label: "recorded" | "EXAMPLE";
  role?: "night" | "missing-field";
  note: string;
};

const cases: Case[] = [
  {
    id: "generated-metar-ecmwf-night",
    path: "/api/generated/metar?icao=SCTB&model=ecmwf_ifs025",
    clock: "2026-11-17T05:00:00.000Z",
    upstream: "recorded",
    label: "recorded",
    role: "night",
    note: "ECMWF point body, clock at 2026-11-17T05:00Z. Visibility is null, so the METAR visibility is estimated.",
  },
  {
    id: "generated-metar-ecmwf-missing",
    path: "/api/generated/metar?icao=SCTB&model=ecmwf_ifs025",
    clock: "2026-11-17T18:00:00.000Z",
    upstream: "recorded",
    label: "recorded",
    role: "missing-field",
    note: "Same ECMWF body at 15:00 local. Null visibility and null 975/950/900/800 hPa series. cape is absent.",
  },
  {
    id: "generated-metar-gfs-night",
    path: "/api/generated/metar?icao=SCTB&model=gfs_seamless",
    clock: "2026-11-17T05:00:00.000Z",
    upstream: "recorded",
    label: "recorded",
    role: "night",
    note: "GFS point body at the same night hour. Visibility is the observed series.",
  },
  {
    id: "generated-taf-ecmwf",
    path: "/api/generated/taf?icao=SCTB&model=ecmwf_ifs025",
    clock: "2026-11-17T05:00:00.000Z",
    upstream: "recorded",
    label: "recorded",
    role: "night",
    note: "TAF from the recorded ECMWF series. The issue clock is the night hour.",
  },
  {
    id: "times-ecmwf",
    path: "/api/andes/times?model=ecmwf_ifs025",
    clock: "2026-11-17T05:00:00.000Z",
    upstream: "recorded",
    label: "recorded",
    note: "Hour list from the recorded ECMWF body.",
  },
  {
    id: "models-sctb",
    path: "/api/andes/models",
    clock: "2026-11-17T05:00:00.000Z",
    upstream: "recorded",
    label: "recorded",
    note: "Probe uses the recorded ECMWF and GFS bodies. ICON and GEM have no recording and come back unavailable.",
  },
  {
    id: "ceiling-ecmwf-night",
    path: "/api/andes/ceiling?model=ecmwf_ifs025&validTime=2026-11-17T05:00:00.000Z",
    clock: "2026-11-17T05:00:00.000Z",
    upstream: "recorded",
    label: "recorded",
    role: "night",
    note: "Each coarse point is a copy of the recorded ECMWF hour. validTime selects 05:00Z.",
  },
  {
    id: "ceiling-ecmwf-missing",
    path: "/api/andes/ceiling?model=ecmwf_ifs025&validTime=2026-11-17T18:00:00.000Z",
    clock: "2026-11-17T18:00:00.000Z",
    upstream: "recorded",
    label: "recorded",
    role: "missing-field",
    note: "Same recorded ECMWF body, validTime 18:00Z.",
  },
  {
    id: "slice-ecmwf-night",
    path: "/api/andes/slice?model=ecmwf_ifs025&hpa=850&validTime=2026-11-17T05:00:00.000Z",
    clock: "2026-11-17T05:00:00.000Z",
    upstream: "recorded",
    label: "recorded",
    role: "night",
    note: "850 hPa slice. Coarse points replay the recorded ECMWF body.",
  },
  {
    id: "times-429",
    path: "/api/andes/times?model=gfs_seamless",
    clock: "2026-11-17T05:00:00.000Z",
    upstream: "429",
    label: "EXAMPLE",
    note: "Upstream 429 is not stored. The point route reports HTTP 429 and does not retry.",
  },
  {
    id: "generated-metar-503",
    path: "/api/generated/metar?icao=SCTB&model=gfs_seamless",
    clock: "2026-11-17T05:00:00.000Z",
    upstream: "503",
    label: "EXAMPLE",
    note: "Upstream 503 becomes 502 with error HTTP 503.",
  },
  {
    id: "ceiling-429",
    path: "/api/andes/ceiling?model=ecmwf_ifs025&validTime=2026-11-17T05:00:00.000Z",
    clock: "2026-11-17T05:00:00.000Z",
    upstream: "ceiling-429",
    label: "EXAMPLE",
    note: "The batch retries a 429 once. The second response is still 429, so the body is the error text.",
  },
  {
    id: "coherence-ecmwf-night",
    path: "/api/andes/coherence?icao=SCTB&model=ecmwf_ifs025",
    clock: "2026-11-17T05:00:00.000Z",
    upstream: "recorded",
    label: "recorded",
    role: "night",
    note: "Open-Meteo is the recorded ECMWF body. AWC is down, so the official lines are the EXAMPLE mock.",
  },
  {
    id: "timeline-sctb-night",
    path: "/api/andes/timeline?icao=SCTB",
    clock: "2026-11-17T05:00:00.000Z",
    upstream: "recorded",
    label: "recorded",
    role: "night",
    note: "ECMWF and GFS series are the recorded bodies. ICON and GEM are unavailable. AWC observation is null.",
  },
];

const handlers: Record<string, (request: Request) => Promise<Response>> = {
  "/api/andes/models": modelsGet,
  "/api/andes/times": timesGet,
  "/api/andes/ceiling": ceilingGet,
  "/api/andes/slice": sliceGet,
  "/api/andes/timeline": timelineGet,
  "/api/andes/coherence": coherenceGet,
  "/api/generated/metar": metarGet,
  "/api/generated/taf": tafGet,
};

async function main(): Promise<void> {
  const manifest = [];
  for (const entry of cases) {
    clearOpenMeteoCache();
    const calls = { n: 0 };
    globalThis.fetch = (async (url: string | URL) => {
      calls.n += 1;
      const hit = upstream(entry.upstream, String(url), calls);
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText });
    }) as typeof fetch;
    freeze(entry.clock);
    const pathname = entry.path.split("?")[0]!;
    const handler = handlers[pathname];
    if (!handler) throw new Error(pathname);
    const response = await handler(new Request(`http://127.0.0.1${entry.path}`));
    const body = await response.text();
    writeFileSync(path.join(root, `${entry.id}.body`), body);
    manifest.push({
      id: entry.id,
      path: entry.path,
      status: response.status,
      clock: entry.clock,
      upstream: entry.upstream,
      label: entry.label,
      role: entry.role,
      note: entry.note,
      contentType: response.headers.get("content-type"),
    });
    console.log(entry.id, response.status, body.length, response.headers.get("content-type"));
  }
  writeFileSync(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

void main();

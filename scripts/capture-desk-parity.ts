/**
 * Replay recorded AWC and Open-Meteo bodies through the desk route handlers.
 * No network. Run from the repo root:
 *   npx tsx scripts/capture-desk-parity.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { clearOpenMeteoCache } from "../src/lib/andes/open-meteo-cache";
import { GET as configGet } from "../src/app/api/config/route";
import { GET as metarGet } from "../src/app/api/metar/route";
import { GET as tafGet } from "../src/app/api/taf/route";
import { GET as forecastGet } from "../src/app/api/forecast/route";
import { GET as grametGet } from "../src/app/api/gramet/route";
import { GET as gametGet } from "../src/app/api/gamet/route";
import { GET as synopticGet } from "../src/app/api/synoptic/route";
import { GET as imageGet } from "../src/app/api/synoptic/image/route";
import { GET as vizGet } from "../src/app/api/viz/route";
import { GET as timelineGet } from "../src/app/api/andes/timeline/route";
import { GET as coherenceGet } from "../src/app/api/andes/coherence/route";

const root = path.resolve(process.cwd(), "server-rs/tests/fixtures/desk");
mkdirSync(root, { recursive: true });

const gfs = JSON.parse(readFileSync("tests/fixtures/recorded/sctb-gfs-seamless-2026-11-18.json", "utf8"));
const liveMetar = JSON.parse(readFileSync("tests/fixtures/recorded/awc/metar-sctb-scel-2026-11-18.json", "utf8")) as Record<string, unknown>[];
const nightMetar = JSON.parse(readFileSync("tests/fixtures/recorded/awc/metar-scel-night-2026-11-17.json", "utf8"));
const cavokMetar = JSON.parse(readFileSync("tests/fixtures/recorded/awc/metar-scel-cavok-2026-11-15.json", "utf8"));
const liveTaf = readFileSync("tests/fixtures/recorded/awc/taf-sctb-scel-2026-11-18.json", "utf8");
const emptyTaf = readFileSync("tests/fixtures/recorded/awc/taf-sctb-2026-11-18.json", "utf8");
const sigmet = readFileSync("tests/fixtures/recorded/awc/sigmet-2026-11-18.json", "utf8");
const gif = readFileSync("tests/fixtures/recorded/awc/sam-12.gif");

function copies(body: unknown, url: string): string {
  const query = new URL(url).searchParams.get("latitude") ?? "";
  const count = query.split(",").filter(Boolean).length;
  if (count <= 1) return JSON.stringify(body);
  return JSON.stringify(Array.from({ length: count }, () => body));
}

function metarBody(kind: string, url: string): string {
  const ids = new URL(url).searchParams.get("ids") ?? "";
  if (kind === "missing") return JSON.stringify(ids.includes("SCTB") && !ids.includes(",") ? [] : cavokMetar);
  if (kind === "night-archive") return JSON.stringify(nightMetar);
  const wanted = ids.split(",").filter(Boolean);
  const rows = liveMetar.filter((row) => wanted.includes(String(row.icaoId)));
  return JSON.stringify(rows);
}

function upstream(kind: string, url: string): { status: number; body: BodyInit; statusText: string; contentType?: string } {
  if (kind === "down") {
    return { status: 502, body: "upstream", statusText: "Bad Gateway" };
  }
  if (url.includes("climatologia.meteochile.gob.cl")) {
    return { status: 404, body: "no token", statusText: "Not Found" };
  }
  if (url.includes("sampssfc12.gif")) {
    return { status: 200, body: gif, statusText: "OK", contentType: "image/gif" };
  }
  if (url.includes("/api/data/isigmet")) return { status: 200, body: sigmet, statusText: "OK" };
  if (url.includes("/api/data/metar")) return { status: 200, body: metarBody(kind, url), statusText: "OK" };
  if (url.includes("/api/data/taf")) {
    const ids = new URL(url).searchParams.get("ids") ?? "";
    return { status: 200, body: ids === "SCTB" || kind === "missing" && ids.includes("SCTB") ? emptyTaf : liveTaf, statusText: "OK" };
  }
  if (url.includes("api.open-meteo.com")) return { status: 200, body: copies(gfs, url), statusText: "OK" };
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
}

type Case = {
  id: string;
  path: string;
  clock: string;
  upstream: string;
  label: "recorded" | "EXAMPLE";
  role?: string;
  note: string;
  binary?: boolean;
};

const clock = "2026-11-18T03:00:00.000Z";
const cases: Case[] = [
  { id: "config-empty", path: "/api/config", clock, upstream: "recorded", label: "EXAMPLE", note: "No Cesium token in the environment." },
  { id: "metar-scel-night", path: "/api/metar?icao=SCEL", clock, upstream: "recorded", label: "recorded", role: "night", note: "Live AWC SCEL 180300Z, 00:00 CLST." },
  { id: "metar-sctb", path: "/api/metar?icao=SCTB", clock, upstream: "recorded", label: "recorded", note: "Live AWC SCTB 172300Z. Gust is absent." },
  { id: "metar-scel-cavok", path: "/api/metar?icao=SCEL", clock: "2026-11-15T00:00:00.000Z", upstream: "missing", label: "recorded", role: "missing-field", note: "Recorded SCEL CAVOK with an empty clouds array." },
  { id: "metar-down", path: "/api/metar?icao=SCEL", clock, upstream: "down", label: "EXAMPLE", note: "AWC transport failure falls back to the EXAMPLE mock." },
  { id: "taf-scel", path: "/api/taf?icao=SCEL", clock, upstream: "recorded", label: "recorded", note: "Live AWC TAF SCEL. Period wx and gust are null." },
  { id: "taf-sctb-empty", path: "/api/taf?icao=SCTB", clock, upstream: "recorded", label: "recorded", role: "missing-field", note: "The live SCTB TAF query returned []." },
  { id: "forecast-scel", path: "/api/forecast?icao=SCEL", clock, upstream: "recorded", label: "recorded", role: "missing-field", note: "No WRF token. GFS is the recorded SCTB surface file, which lacks several desk series." },
  { id: "forecast-down", path: "/api/forecast?icao=SCTB", clock, upstream: "down", label: "EXAMPLE", note: "Open-Meteo down. EXAMPLE mock forecast." },
  { id: "gramet-down", path: "/api/gramet?from=SCEL&to=SCTE", clock, upstream: "down", label: "EXAMPLE", note: "EXAMPLE mock GRAMET." },
  { id: "gramet-recorded", path: "/api/gramet?from=SCEL&to=SCTB", clock, upstream: "recorded", label: "recorded", role: "missing-field", note: "Recorded GFS body repeated for each route point." },
  { id: "gamet-recorded", path: "/api/gamet?fir=SANTIAGO", clock, upstream: "recorded", label: "recorded", note: "Recorded SIGMET subset plus the recorded GFS body." },
  { id: "gamet-down", path: "/api/gamet?fir=SANTIAGO", clock, upstream: "down", label: "EXAMPLE", note: "Model down. EXAMPLE mock GAMET. SIGMET circuit is down too." },
  { id: "synoptic", path: "/api/synoptic", clock, upstream: "recorded", label: "EXAMPLE", note: "Static chart list. fetchedAt is the frozen clock." },
  { id: "synoptic-image", path: "/api/synoptic/image?id=sam-12", clock, upstream: "recorded", label: "recorded", note: "Recorded NOAA WPC GIF.", binary: true },
  { id: "synoptic-unknown", path: "/api/synoptic/image?id=nope", clock, upstream: "recorded", label: "EXAMPLE", note: "Unknown chart id." },
  { id: "synoptic-image-down", path: "/api/synoptic/image?id=sam-12", clock, upstream: "down", label: "EXAMPLE", note: "Chart circuit down. Body is the status text." },
  { id: "viz-scel", path: "/api/viz?icao=SCEL", clock, upstream: "recorded", label: "recorded", role: "night", note: "Live SCEL and SCTB METARs. Other stations have no observation. GFS column is the recorded body." },
  { id: "viz-down", path: "/api/viz?icao=SCEL", clock, upstream: "down", label: "EXAMPLE", note: "Both circuits down. EXAMPLE mock field." },
  { id: "timeline-scel-night", path: "/api/andes/timeline?icao=SCEL", clock: "2026-11-17T05:00:00.000Z", upstream: "night-archive", label: "recorded", role: "night", note: "Recorded SCEL 170500Z METAR plus the recorded GFS series." },
  { id: "coherence-scel", path: "/api/andes/coherence?icao=SCEL&model=gfs_seamless", clock, upstream: "recorded", label: "recorded", role: "night", note: "Live SCEL METAR and TAF with the recorded GFS point." },
];

const handlers: Record<string, (request: Request) => Promise<Response>> = {
  "/api/config": configGet,
  "/api/metar": metarGet,
  "/api/taf": tafGet,
  "/api/forecast": forecastGet,
  "/api/gramet": grametGet,
  "/api/gamet": gametGet,
  "/api/synoptic": synopticGet,
  "/api/synoptic/image": imageGet,
  "/api/viz": vizGet,
  "/api/andes/timeline": timelineGet,
  "/api/andes/coherence": coherenceGet,
};

async function main(): Promise<void> {
  delete process.env.CESIUM_ION_TOKEN;
  delete process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
  delete process.env.METEOCHILE_USER;
  delete process.env.METEOCHILE_TOKEN;
  const manifest = [];
  for (const entry of cases) {
    clearOpenMeteoCache();
    globalThis.fetch = (async (url: string | URL) => {
      const hit = upstream(entry.upstream, String(url));
      return new Response(hit.body, {
        status: hit.status,
        statusText: hit.statusText,
        headers: hit.contentType ? { "content-type": hit.contentType } : undefined,
      });
    }) as typeof fetch;
    freeze(entry.clock);
    const pathname = entry.path.split("?")[0]!;
    const handler = handlers[pathname];
    if (!handler) throw new Error(pathname);
    const response = await handler(new Request(`http://127.0.0.1${entry.path}`));
    const bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(path.join(root, `${entry.id}.body`), bytes);
    manifest.push({
      id: entry.id,
      path: entry.path,
      status: response.status,
      clock: entry.clock,
      upstream: entry.upstream,
      label: entry.label,
      role: entry.role ?? null,
      note: entry.note,
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
    });
    console.log(entry.id, response.status, bytes.length, response.headers.get("content-type"), response.headers.get("cache-control"));
  }
  writeFileSync(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

void main();

#!/usr/bin/env node
/** Screenshot METAR/TAF side-by-side with mocked official + AWC API (no IFIS network). */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const outMain =
  process.env.SCREENSHOT_OUT ?? "/opt/cursor/artifacts/official-vs-model-metar-taf.png";
const outUnavailable =
  process.env.SCREENSHOT_UNAVAILABLE_OUT ??
  "/opt/cursor/artifacts/official-taf-unavailable-scvh.png";

const officialMetar = {
  icao: "SCTB",
  raw: "METAR SCTB 181300Z 24003KT 9999 SCT120 17/11 Q1016",
  kind: "METAR",
  source: "dgac-ifis",
  officialLabel: "Oficial DGAC",
  sourceUrl: "https://aipchile.dgac.gob.cl/metar?designador=SCTB",
  fetchedAt: "2026-11-18T13:05:00.000Z",
  issuedAt: "2026-11-18T13:00:00.000Z",
  ageSeconds: 300,
  stale: false,
  unavailable: false,
  unavailableReason: null,
};

const officialTaf = {
  icao: "SCTB",
  raw: "TAF SCTB 181100Z 1812/1824 VRB02KT 9999 SCT030 BKN050 TX25/1819Z TN16/1812Z BECMG 1816/1818 20010KT CAVOK",
  source: "dgac-ifis",
  officialLabel: "Oficial DGAC",
  sourceUrl: "https://aipchile.dgac.gob.cl/taf?designador=SCTB",
  fetchedAt: "2026-11-18T13:05:00.000Z",
  issuedAt: "2026-11-18T11:00:00.000Z",
  ageSeconds: 7500,
  stale: false,
  unavailable: false,
  unavailableReason: null,
};

const officialTafScvh = {
  icao: "SCVH",
  raw: "",
  source: "dgac-ifis",
  officialLabel: "Oficial DGAC",
  sourceUrl: "https://aipchile.dgac.gob.cl/taf?designador=SCVH",
  fetchedAt: "2026-11-18T13:05:00.000Z",
  issuedAt: null,
  ageSeconds: -1,
  stale: false,
  unavailable: true,
  unavailableReason: "no_taf_for_designator",
};

const awcMetar = {
  data: {
    icao: "SCTB",
    name: "Eulogio Sánchez",
    raw: "METAR SCTB 181300Z 24003KT 9999 SCT120 17/11 Q1016 NOSIG",
    observedAt: "2026-11-18T13:00:00.000Z",
    tempC: 17,
    dewpointC: 11,
    windDirDeg: 240,
    windKt: 3,
    gustKt: null,
    visM: 9999,
    altimeterHpa: 1016,
    flightCategory: "VFR",
    cover: null,
    clouds: [{ cover: "SCT", baseFt: 12000 }],
    lat: -33.456,
    lon: -70.546,
    elevM: 649,
  },
  source: "live",
  sourceLabel: "Live METAR from NOAA Aviation Weather Center",
  fetchedAt: "2026-11-18T13:05:00.000Z",
};

const awcTaf = {
  data: {
    icao: "SCTB",
    name: "Eulogio Sánchez",
    raw: "TAF SCTB 181100Z 1812/1824 VRB02KT 9999 SCT030 BKN050",
    issuedAt: "2026-11-18T11:00:00.000Z",
    validFrom: "2026-11-18T12:00:00.000Z",
    validTo: "2026-11-19T00:00:00.000Z",
    periods: [],
    lat: -33.456,
    lon: -70.546,
  },
  source: "live",
  sourceLabel: "Live TAF from NOAA Aviation Weather Center",
  fetchedAt: "2026-11-18T13:05:00.000Z",
};

const awcTafScvh = {
  data: {
    icao: "SCVH",
    name: "Villarrica",
    raw: "TAF SCVH 180300Z 1800/1824 18010KT 9999 FEW050 SCT120",
    issuedAt: "2026-11-18T00:00:00.000Z",
    validFrom: "2026-11-18T01:00:00.000Z",
    validTo: "2026-11-19T01:00:00.000Z",
    periods: [],
    lat: -39.28,
    lon: -72.22,
  },
  source: "live",
  sourceLabel: "Live TAF from NOAA Aviation Weather Center",
  fetchedAt: "2026-11-18T13:05:00.000Z",
};

function buildMocks(icao) {
  const upper = icao.toUpperCase();
  return {
    [`/api/official/metar?icao=${upper}`]:
      upper === "SCVH"
        ? { ...officialMetar, icao: "SCVH" }
        : officialMetar,
    [`/api/official/taf?icao=${upper}`]: upper === "SCVH" ? officialTafScvh : officialTaf,
    [`/api/metar?icao=${upper}`]: upper === "SCVH" ? { ...awcMetar, data: { ...awcMetar.data, icao: "SCVH" } } : awcMetar,
    [`/api/taf?icao=${upper}`]: upper === "SCVH" ? awcTafScvh : awcTaf,
  };
}

const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

let activeMocks = buildMocks("SCTB");

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const mock = activeMocks[url.pathname + url.search];
  if (mock) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(mock));
    return;
  }
  let filePath = path.join(dist, url.pathname === "/" ? "index.html" : url.pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(dist, "index.html");
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "content-type": mime[ext] ?? "application/octet-stream" });
  res.end(fs.readFileSync(filePath));
});

await new Promise((resolve) => server.listen(43125, "127.0.0.1", resolve));

const browser = await chromium.launch({
  args: ["--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});

async function shot(routePath, outPath) {
  const icao = new URL(routePath, "http://x").searchParams.get("icao") ?? "SCTB";
  activeMocks = buildMocks(icao);
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`http://127.0.0.1:43125${routePath}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, fullPage: true });
  await page.close();
  console.log(`Saved ${outPath}`);
}

await shot("/metar-taf?icao=SCTB", outMain);
await shot("/metar-taf?icao=SCVH", outUnavailable);

await browser.close();
server.close();
#!/usr/bin/env node
/**
 * Compare a Node image and the Rust image on all 18 /api routes.
 *
 *   node scripts/dual-run-diff.mjs --node http://127.0.0.1:4311 --rust http://127.0.0.1:4310
 *   node scripts/dual-run-diff.mjs --self-test
 *
 * Station routes are requested for SCTB, SCEL, and SCVM. Routes with no
 * station are requested once. Bodies are compared as raw bytes.
 *
 * A difference is allowed only when it is one of the documented known
 * deviations. Anything else exits 1. The script does not call upstream
 * weather itself; each image does, when this is pointed at two servers.
 */

const ICAOS = ["SCTB", "SCEL", "SCVM"];
const TIMEOUT_MS = 180_000;

const SHARED = [
  "/api/health",
  "/api/config",
  "/api/andes/models",
  "/api/andes/times?model=gfs_seamless",
  "/api/andes/ceiling?model=gfs_seamless",
  "/api/andes/slice?model=gfs_seamless&hpa=850",
  "/api/synoptic",
  "/api/synoptic/image?id=sam-12",
];

function stationPaths(icao) {
  const to = icao === "SCEL" ? "SCTB" : "SCEL";
  return [
    `/api/metar?icao=${icao}`,
    `/api/taf?icao=${icao}`,
    `/api/forecast?icao=${icao}`,
    `/api/gramet?from=${icao}&to=${to}`,
    `/api/gamet?fir=SANTIAGO&icao=${icao}`,
    `/api/andes/timeline?icao=${icao}`,
    `/api/andes/coherence?icao=${icao}&model=gfs_seamless`,
    `/api/generated/metar?icao=${icao}&model=gfs_seamless`,
    `/api/generated/taf?icao=${icao}&model=gfs_seamless`,
    `/api/viz?icao=${icao}`,
  ];
}

function requestPaths() {
  return [...SHARED, ...ICAOS.flatMap(stationPaths), "/api/andes/times?model=not-a-model"];
}

/** Documented Rust/TS differences. Happy-path bodies are not rewritten. */
function isKnownDeviation(path, nodeStatus, _nodeBody, rustStatus, rustBody) {
  if (path.startsWith("/api/andes/times") && path.includes("model=not-a-model")) {
    return nodeStatus === 500 && rustStatus === 400 && rustBody === '{"error":"Invalid model"}';
  }
  return false;
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, body };
}

function selfTest() {
  const paths = requestPaths();
  const names = new Set(paths.map((path) => path.split("?")[0]));
  if (names.size !== 18) {
    throw new Error(`expected 18 routes, got ${names.size}: ${[...names].join(" ")}`);
  }
  const same = isKnownDeviation("/api/health", 200, "a", 200, "b");
  if (same) throw new Error("a healthy body must not be a known deviation");
  const known = isKnownDeviation(
    "/api/andes/times?model=not-a-model",
    500,
    "<html>500</html>",
    400,
    '{"error":"Invalid model"}'
  );
  if (!known) throw new Error("the unknown-model probe was not classified");
  const wrong = isKnownDeviation(
    "/api/andes/times?model=not-a-model",
    200,
    "{}",
    400,
    '{"error":"Invalid model"}'
  );
  if (wrong) throw new Error("a 200 from Node is not the known times deviation");
  console.log("dual-run self-test ok");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  const nodeBase = arg("--node");
  const rustBase = arg("--rust");
  if (!nodeBase || !rustBase) {
    console.error("usage: node scripts/dual-run-diff.mjs --node URL --rust URL");
    process.exit(2);
  }
  const unexplained = [];
  const known = [];
  for (const path of requestPaths()) {
    const [nodeRes, rustRes] = await Promise.all([
      fetchBytes(new URL(path, nodeBase)),
      fetchBytes(new URL(path, rustBase)),
    ]);
    const nodeText = nodeRes.body.toString("utf8");
    const rustText = rustRes.body.toString("utf8");
    const equal = nodeRes.status === rustRes.status && nodeRes.body.equals(rustRes.body);
    if (equal) {
      console.log(`ok ${nodeRes.status} ${path}`);
      continue;
    }
    if (isKnownDeviation(path, nodeRes.status, nodeText, rustRes.status, rustText)) {
      known.push(path);
      console.log(`known ${nodeRes.status}/${rustRes.status} ${path}`);
      continue;
    }
    unexplained.push({
      path,
      nodeStatus: nodeRes.status,
      rustStatus: rustRes.status,
      node: nodeText.slice(0, 240),
      rust: rustText.slice(0, 240),
    });
    console.log(`DIFF ${path} node=${nodeRes.status} rust=${rustRes.status}`);
  }
  if (unexplained.length) {
    console.error(JSON.stringify(unexplained, null, 2));
    process.exit(1);
  }
  console.log(`no unexplained diffs (${known.length} known)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

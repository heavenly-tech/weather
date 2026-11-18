#!/usr/bin/env python3
"""Score the old FG rule, the new FG rule, and PROB30 against Ogimet METARs.

Window: 2026-10-01 00:00 UTC through 2026-11-17 23:00 UTC (seven weeks).
Stations: SCTB and SCEL.

Observations are Ogimet METAR text. Model hours are the Open-Meteo
historical-forecast API, model ecmwf_ifs025, on the free host
historical-forecast-api.open-meteo.com. No API key. Wind is requested in km/h,
which is what the encoder converts with Math.round(kmh / 1.852).

The FG decision is not reimplemented here. Each station's hourly JSON is
passed to `cargo run --quiet --bin score-fog` in server-rs, which calls
derive_metar_wx_and_cloud.

Old FG: the coded visibility, after the existing low-cloud cap, is below
1000 m. That is the previous vis_obscuration_wx rule.
New FG: that same visibility gate, plus all of night (solar elevation < 0
at the aerodrome), T-Td <= 1 C, wind <= 5 kt, and a saturated lowest level
(relative humidity >= 95 at the lowest pressure level above the field, or
at the surface when no pressure level is above the field).
PROB30 BR/FG (`risk`): night, T-Td <= 2 C, and wind <= 5 kt. Saturation is
not required. A hit is still an observed FG or FZFG hour.

A METAR matches a model hour when the Ogimet timestamp is that exact hour.
Observed fog is an exact token FG or FZFG before RMK. BCFG, MIFG, PRFG, and
VCFG do not count. Hours with no METAR are left out of the counts.

POD = hits / (hits + misses). FAR = false alarms / (hits + false alarms).
"""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BEGIN = "202610010000"
END = "202611172359"
START_DATE = "2026-10-01"
END_DATE = "2026-11-17"
MODEL = "ecmwf_ifs025"
STATIONS = {
    "SCTB": (-33.456, -70.546),
    "SCEL": (-33.393, -70.786),
}
LEVELS = (1000, 975, 950, 925, 900, 850, 800, 700, 600, 500)
FOG_TOKENS = {"FG", "FZFG"}


def hourly_variables() -> str:
    names = [
        "temperature_2m",
        "dew_point_2m",
        "relative_humidity_2m",
        "wind_speed_10m",
        "wind_direction_10m",
        "wind_gusts_10m",
        "precipitation",
        "rain",
        "showers",
        "snowfall",
        "cloud_cover",
        "cloud_cover_low",
        "cloud_cover_mid",
        "cloud_cover_high",
        "surface_pressure",
        "pressure_msl",
    ]
    for level in LEVELS:
        names.append(f"cloud_cover_{level}hPa")
        names.append(f"relative_humidity_{level}hPa")
        names.append(f"geopotential_height_{level}hPa")
    return ",".join(names)


def fetch(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    request = urllib.request.Request(url, headers={"User-Agent": "weather-desk-score/1.0"})
    with urllib.request.urlopen(request, timeout=180) as response:
        dest.write_bytes(response.read())


def download(cache: Path) -> None:
    cache.mkdir(parents=True, exist_ok=True)
    variables = hourly_variables()
    for icao, (lat, lon) in STATIONS.items():
        model_url = (
            "https://historical-forecast-api.open-meteo.com/v1/forecast?"
            f"latitude={lat}&longitude={lon}&start_date={START_DATE}&end_date={END_DATE}"
            f"&hourly={variables}&models={MODEL}&wind_speed_unit=kmh"
        )
        fetch(model_url, cache / f"om-{icao.lower()}.json")
        ogimet = (
            "https://www.ogimet.com/cgi-bin/getmetar?"
            f"icao={icao}&begin={BEGIN}&end={END}"
        )
        fetch(ogimet, cache / f"ogimet-{icao.lower()}.txt")


def observed_fog(text: str) -> bool:
    body = text.split(" RMK", 1)[0]
    return any(token in FOG_TOKENS for token in body.split())


def parse_metars(path: Path) -> dict[str, bool]:
    hours: dict[str, bool] = {}
    for line in path.read_text(errors="replace").splitlines():
        parts = line.split(",", 6)
        if len(parts) < 7:
            continue
        _icao, year, month, day, hour, minute, text = parts
        if minute != "00":
            continue
        stamp = f"{year}-{month}-{day}T{hour}:00"
        hours[stamp] = observed_fog(text)
    return hours


def model_flags(icao: str, hourly: dict) -> dict[str, tuple[bool, bool]]:
    payload = json.dumps({"icao": icao, "model": MODEL, "hourly": hourly})
    run = subprocess.run(
        [
            "cargo",
            "run",
            "--quiet",
            "--bin",
            "score-fog",
            "--manifest-path",
            str(ROOT / "server-rs" / "Cargo.toml"),
        ],
        input=payload,
        text=True,
        check=True,
        capture_output=True,
        cwd=ROOT,
    )
    flags: dict[str, tuple[bool, bool, bool]] = {}
    for line in run.stdout.splitlines():
        stamp, old, new, risk = line.split("\t")
        flags[stamp] = (old == "1", new == "1", risk == "1")
    return flags


def rates(hits: int, misses: int, false_alarms: int) -> dict[str, float | None]:
    observed = hits + misses
    forecast = hits + false_alarms
    return {
        "pod": (hits / observed) if observed else None,
        "far": (false_alarms / forecast) if forecast else None,
    }


def score_station(
    icao: str, observed: dict[str, bool], flags: dict[str, tuple[bool, bool, bool]]
) -> dict:
    names = ("old", "new", "risk")
    counts = {name: {"hit": 0, "miss": 0, "false_alarm": 0} for name in names}
    matched = 0
    for stamp, saw_fog in observed.items():
        if stamp not in flags:
            continue
        matched += 1
        old, new, risk = flags[stamp]
        for name, predicted in (("old", old), ("new", new), ("risk", risk)):
            if predicted and saw_fog:
                counts[name]["hit"] += 1
            elif saw_fog:
                counts[name]["miss"] += 1
            elif predicted:
                counts[name]["false_alarm"] += 1
    out = {"icao": icao, "matched_hours": matched, "observed_fog_hours": sum(observed.values())}
    for name in ("old", "new", "risk"):
        hit = counts[name]["hit"]
        miss = counts[name]["miss"]
        false_alarm = counts[name]["false_alarm"]
        out[name] = {
            "hit": hit,
            "miss": miss,
            "false_alarm": false_alarm,
            **rates(hit, miss, false_alarm),
        }
    return out


def main() -> None:
    cache = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/fog-score")
    download(cache)
    summary = {
        "window": f"{START_DATE} to {END_DATE} UTC",
        "model": MODEL,
        "source": "Ogimet METAR text and Open-Meteo historical-forecast (free tier)",
        "stations": [],
    }
    for icao in STATIONS:
        observed = parse_metars(cache / f"ogimet-{icao.lower()}.txt")
        model = json.loads((cache / f"om-{icao.lower()}.json").read_text())
        flags = model_flags(icao, model["hourly"])
        summary["stations"].append(score_station(icao, observed, flags))
    combined = {"matched_hours": 0, "observed_fog_hours": 0}
    for name in ("old", "new", "risk"):
        hit = miss = false_alarm = 0
        for station in summary["stations"]:
            hit += station[name]["hit"]
            miss += station[name]["miss"]
            false_alarm += station[name]["false_alarm"]
        combined[name] = {
            "hit": hit,
            "miss": miss,
            "false_alarm": false_alarm,
            **rates(hit, miss, false_alarm),
        }
    for station in summary["stations"]:
        combined["matched_hours"] += station["matched_hours"]
        combined["observed_fog_hours"] += station["observed_fog_hours"]
    summary["combined"] = combined
    text = json.dumps(summary, indent=2)
    print(text)
    (ROOT / "scripts" / "fog-score-summary.json").write_text(text + "\n")


if __name__ == "__main__":
    main()

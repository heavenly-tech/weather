"""Turn a tiny wrfout-shaped JSON fixture into the desk product.

Real wrfout files are NetCDF. CI uses this JSON shape, with the same
variable names, and does not call NOMADS. Wind components are m/s.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

NO_RUN = "No run available yet"
M_TO_FT = 3.280839895
MS_TO_KT = 1.0 / 0.514444


def postprocess(wrfout: dict, stations: list[tuple[str, float, float]], cycle: str | None = None) -> dict:
    times = wrfout["Times"]
    if not times:
        raise ValueError("wrfout has no Times")
    lats = wrfout["XLAT"]
    lons = wrfout["XLONG"]
    rows = len(lats)
    cols = len(lats[0]) if rows else 0
    stamp = cycle or _wrf_time(times[0])
    points = []
    for j in range(rows):
        for i in range(cols):
            points.append((j, i, float(lats[j][i]), float(lons[j][i])))
    station_out = {}
    for icao, lat, lon in stations:
        j, i, _, _ = _nearest(points, lat, lon)
        hours = []
        previous_rain = 0.0
        for index, raw_time in enumerate(times):
            rain = _accum(wrfout, "RAINC", index, j, i) + _accum(wrfout, "RAINNC", index, j, i)
            precip = max(0.0, rain - previous_rain)
            previous_rain = rain
            temp_c = _kelvin(wrfout["T2"][index][j][i])
            dew_c = _kelvin(wrfout["TD2"][index][j][i])
            u = float(wrfout["U10"][index][j][i])
            v = float(wrfout["V10"][index][j][i])
            speed_kt, direction = _wind(u, v)
            cloud = _cloud_pct(wrfout, index, j, i)
            base_m = _optional(wrfout, "cloud_base_m_agl", index, j, i)
            ceiling = None
            if base_m is not None and cloud is not None and cloud >= 62.5:
                ceiling = round(base_m * M_TO_FT, 1)
            vis_m = float(wrfout["visibility_m"][index][j][i])
            fog = _fog(vis_m)
            hours.append(
                {
                    "time": _wrf_time(raw_time),
                    "tempC": round(temp_c, 1),
                    "dewpointC": round(dew_c, 1),
                    "rhPct": round(_rh(temp_c, dew_c), 1),
                    "precipMm": round(precip, 2),
                    "cloudPct": None if cloud is None else round(cloud, 1),
                    "windKt": speed_kt,
                    "windDirDeg": direction,
                    "visKm": round(vis_m / 1000.0, 1),
                    "weatherCode": 45 if fog == "FG" else None,
                    "ceilingFt": ceiling,
                    "fogGuidance": fog,
                }
            )
        station_out[icao] = {"hours": hours}
    cells = []
    for j, i, lat, lon in points:
        cloud = _cloud_pct(wrfout, 0, j, i)
        base_m = _optional(wrfout, "cloud_base_m_agl", 0, j, i)
        ceiling = None
        if base_m is not None and cloud is not None and cloud >= 62.5:
            ceiling = round(base_m * M_TO_FT, 1)
        hgt = wrfout.get("HGT")
        elev = float(hgt[j][i]) if hgt is not None else 0.0
        cells.append(
            {
                "lat": lat,
                "lon": lon,
                "elevM": elev,
                "ceilingFtAgl": ceiling,
                "category": _category(ceiling),
                "obscured": False,
            }
        )
    return {
        "cycle": stamp,
        "model": "WRF (local)",
        "domainId": "chile-central-3km",
        "stations": station_out,
        "grid": {"rows": rows, "cols": cols, "cells": cells},
    }


def write_product(wrfout_path: Path, stations: list[tuple[str, float, float]], dest: Path) -> dict:
    product = postprocess(json.loads(wrfout_path.read_text()), stations)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(product, indent=2) + "\n")
    return product


def _wrf_time(text: str) -> str:
    return text.replace("_", "T") + "Z"


def _kelvin(value: float) -> float:
    return float(value) - 273.15


def _accum(wrfout: dict, name: str, index: int, j: int, i: int) -> float:
    table = wrfout.get(name)
    if table is None:
        return 0.0
    return float(table[index][j][i])


def _optional(wrfout: dict, name: str, index: int, j: int, i: int) -> float | None:
    table = wrfout.get(name)
    if table is None:
        return None
    value = table[index][j][i]
    if value is None:
        return None
    return float(value)


def _cloud_pct(wrfout: dict, index: int, j: int, i: int) -> float | None:
    table = wrfout.get("CLDFRA")
    if table is None:
        return None
    column = table[index]
    # Time, bottom_top, south_north, west_east. A flat [j][i] is also accepted.
    if column and isinstance(column[0], list) and column[0] and isinstance(column[0][0], list):
        fractions = [float(level[j][i]) for level in column]
    else:
        fractions = [float(column[j][i])]
    return max(fractions) * 100.0


def _wind(u: float, v: float) -> tuple[float | None, float | None]:
    speed = math.hypot(u, v)
    if speed == 0.0:
        return 0.0, None
    direction = math.degrees(math.atan2(-u, -v)) % 360.0
    return round(speed * MS_TO_KT), round(direction)

def _rh(temp_c: float, dew_c: float) -> float:
    def saturation(value: float) -> float:
        return 6.112 * math.exp(17.67 * value / (value + 243.5))

    if saturation(temp_c) == 0:
        return 0.0
    return min(100.0, 100.0 * saturation(dew_c) / saturation(temp_c))


def _fog(vis_m: float) -> str:
    if vis_m < 1000.0:
        return "FG"
    if 3000.0 <= vis_m <= 5000.0:
        return "BR"
    return ""


def _category(ceiling_ft: float | None) -> str:
    if ceiling_ft is None:
        return "VFR"
    if ceiling_ft < 500:
        return "LIFR"
    if ceiling_ft < 1000:
        return "IFR"
    if ceiling_ft < 3000:
        return "MVFR"
    return "VFR"


def _nearest(points: list[tuple[int, int, float, float]], lat: float, lon: float):
    def distance(point):
        _, _, plat, plon = point
        return (plat - lat) ** 2 + (plon - lon) ** 2

    return min(points, key=distance)

"""NOMADS GFS 0.25 grib-filter URLs. No API key and no credentials."""

from __future__ import annotations

from urllib.parse import urlencode

NOMADS_FILTER = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"

SURFACE_LEVELS = (
    "lev_2_m_above_ground",
    "lev_10_m_above_ground",
    "lev_surface",
    "lev_mean_sea_level",
)
PRESSURE_LEVELS = tuple(
    f"lev_{hpa}_mb"
    for hpa in (
        1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500,
        450, 400, 350, 300, 250, 200, 150, 100,
    )
)
VARIABLES = (
    "var_TMP",
    "var_UGRD",
    "var_VGRD",
    "var_RH",
    "var_HGT",
    "var_PRMSL",
    "var_PRES",
    "var_LAND",
    "var_SOILW",
    "var_TSOIL",
    "var_WEASD",
    "var_SNOD",
)


def filter_url(ymd: str, cycle: str, forecast_hour: int) -> str:
    """Public filter URL for one GFS 0.25 file. `cycle` is '00' or '12'."""
    hour = f"{forecast_hour:03d}"
    query = {
        "file": f"gfs.t{cycle}z.pgrb2.0p25.f{hour}",
        "dir": f"/gfs.{ymd}/{cycle}/atmos",
    }
    for name in SURFACE_LEVELS + PRESSURE_LEVELS + VARIABLES:
        query[name] = "on"
    return f"{NOMADS_FILTER}?{urlencode(query)}"


def forecast_hours(run_hours: int, step: int = 3) -> list[int]:
    return list(range(0, run_hours + 1, step))

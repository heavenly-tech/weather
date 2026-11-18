#!/usr/bin/env python3
"""One WRF cycle. No scheduler, and no run unless the host is allowed.

The command reads directories from the environment. It does not embed a
machine path. A cycle runs geogrid once (the geo_em file is reused), then
ungrib, metgrid, real, wrf, and post-processing. `--fixture` skips NOMADS
and Docker and only post-processes an EXAMPLE wrfout-shaped JSON file.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
from pathlib import Path

from gfs import filter_url, forecast_hours
from postprocess import write_product

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ALLOWED = ("omarchibald", "mac-mini")
NO_RUN = "No run available yet"
EXAMPLE_STATIONS = (
    ("SCEL", -33.393, -70.786),
    ("SCTB", -33.456, -70.546),
)


def hostname(env: dict[str, str] | None = None) -> str:
    source = env if env is not None else os.environ
    return source.get("WRF_HOST") or socket.gethostname()


def host_allowed(name: str, allowed: tuple[str, ...] = DEFAULT_ALLOWED) -> bool:
    host = name.split(".")[0].lower()
    if host == "heavenly" or host.startswith("heavenly"):
        return False
    return host in {item.strip().lower() for item in allowed if item.strip()}


def allowed_hosts(env: dict[str, str]) -> tuple[str, ...]:
    raw = env.get("WRF_ALLOWED_HOSTS", "")
    if not raw.strip():
        return DEFAULT_ALLOWED
    return tuple(part.strip() for part in raw.split(",") if part.strip())


def ci_busy(env: dict[str, str], processes: list[str] | None = None) -> bool:
    flag = env.get("WRF_CI_BUSY_FILE", "")
    if flag and Path(flag).exists():
        return True
    if env.get("WRF_YIELD_TO_BUILDS", "1") != "1":
        return False
    listing = processes if processes is not None else _process_args()
    for line in listing:
        if "cargo build" in line or "docker build" in line or "cargo test" in line:
            return True
    return False


def plan_stages(work: Path) -> list[str]:
    stages = []
    if not (work / "geo_em.d01.nc").exists():
        stages.append("geogrid")
    stages.extend(["ungrib", "metgrid", "real", "wrf", "postprocess"])
    return stages


def priority_prefix() -> list[str]:
    return ["nice", "-n", "19", "ionice", "-c", "3"]


def render_namelist(template: str, values: dict[str, str]) -> str:
    text = template
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    if "{{" in text:
        raise ValueError("namelist template still has an unfilled placeholder")
    return text


def namelist_values(domain: dict, geog: str, start: str, end: str) -> dict[str, str]:
    start_parts = _stamp_parts(start)
    end_parts = _stamp_parts(end)
    return {
        "START_DATE": start.replace("T", "_").replace("Z", ""),
        "END_DATE": end.replace("T", "_").replace("Z", ""),
        "INTERVAL_SECONDS": str(domain["boundary_interval_s"]),
        "E_WE": str(domain["e_we"]),
        "E_SN": str(domain["e_sn"]),
        "DX": str(domain["dx_m"]),
        "DY": str(domain["dy_m"]),
        "REF_LAT": str(domain["ref_lat"]),
        "REF_LON": str(domain["ref_lon"]),
        "TRUELAT1": str(domain["truelat1"]),
        "TRUELAT2": str(domain["truelat2"]),
        "STAND_LON": str(domain["stand_lon"]),
        "GEOG_DATA_PATH": geog,
        "RUN_HOURS": str(domain["run_hours"]),
        "START_YEAR": start_parts[0],
        "START_MONTH": start_parts[1],
        "START_DAY": start_parts[2],
        "START_HOUR": start_parts[3],
        "END_YEAR": end_parts[0],
        "END_MONTH": end_parts[1],
        "END_DAY": end_parts[2],
        "END_HOUR": end_parts[3],
        "HISTORY_INTERVAL": str(domain["history_interval_min"]),
        "TIME_STEP": str(domain["time_step_s"]),
        "E_VERT": str(domain["e_vert"]),
    }


def docker_command(image: str, work: Path, geog: Path, gfs: Path, output: Path, program: str) -> list[str]:
    return priority_prefix() + [
        "docker",
        "run",
        "--rm",
        "--user",
        "65534:65534",
        "-v",
        f"{work}:/work",
        "-v",
        f"{geog}:/geog:ro",
        "-v",
        f"{gfs}:/gfs:ro",
        "-v",
        f"{output}:/output",
        "-w",
        "/work",
        image,
        program,
    ]


def load_domain(path: Path) -> dict:
    domain = json.loads(path.read_text())
    nest = domain.get("nest_1km") or {}
    if nest.get("enabled"):
        raise SystemExit("1 km nest is not built")
    return domain


def run_cycle(env: dict[str, str], fixture: Path | None, output: Path | None) -> str:
    if env.get("WRF_NEST_1KM") == "1":
        raise SystemExit("1 km nest is not built")
    if not host_allowed(hostname(env), allowed_hosts(env)):
        raise SystemExit("WRF runs only on omarchibald or the Mac mini")
    if ci_busy(env):
        return "skipped: CI build is running"
    if env.get("WRF_SCHEDULE") == "1":
        print("WRF_SCHEDULE is ignored; this command runs one cycle and does not install a scheduler")
    domain_path = Path(env.get("WRF_DOMAIN") or ROOT / "config" / "wrf" / "domain.json")
    domain = load_domain(domain_path)
    dest = output or Path(env["WRF_OUTPUT_DIR"])
    if fixture is not None:
        write_product(fixture, list(EXAMPLE_STATIONS), dest / "latest.json")
        return "postprocess"
    geog = _required(env, "WRF_GEOG_DIR")
    work = _required(env, "WRF_WORK_DIR")
    gfs = _required(env, "WRF_GFS_DIR")
    image = env.get("WRF_IMAGE", "ncar/iwrf")
    _write_namelists(env, domain, geog, work)
    _fetch_gfs(domain, gfs, env)
    for stage in plan_stages(work):
        if stage == "postprocess":
            continue
        program = {"geogrid": "geogrid.exe", "ungrib": "ungrib.exe", "metgrid": "metgrid.exe", "real": "real.exe", "wrf": "wrf.exe"}[stage]
        subprocess.run(docker_command(image, work, geog, gfs, dest, program), check=True)
    print("postprocess expects a wrfout-shaped JSON export in the output directory")
    return "docker"


def _write_namelists(env: dict[str, str], domain: dict, geog: Path, work: Path) -> None:
    wps_path = Path(env.get("WRF_NAMELIST_WPS") or ROOT / "config" / "wrf" / "namelist.wps.template")
    input_path = Path(env.get("WRF_NAMELIST_INPUT") or ROOT / "config" / "wrf" / "namelist.input.template")
    start = env.get("WRF_START", "2026-11-18T00:00:00Z")
    end = env.get("WRF_END", "2026-11-20T00:00:00Z")
    values = namelist_values(domain, str(geog), start, end)
    work.mkdir(parents=True, exist_ok=True)
    (work / "namelist.wps").write_text(render_namelist(wps_path.read_text(), values))
    (work / "namelist.input").write_text(render_namelist(input_path.read_text(), values))


def _fetch_gfs(domain: dict, gfs_dir: Path, env: dict[str, str]) -> None:
    """Download public GFS files. Tests do not call this."""
    import urllib.request

    gfs_dir.mkdir(parents=True, exist_ok=True)
    ymd = env.get("WRF_GFS_YMD", "20261118")
    cycle = env.get("WRF_GFS_CYCLE", "00")
    for hour in forecast_hours(int(domain["run_hours"])):
        url = filter_url(ymd, cycle, hour)
        dest = gfs_dir / f"gfs.t{cycle}z.pgrb2.0p25.f{hour:03d}"
        if dest.exists() and dest.stat().st_size > 0:
            continue
        print(f"fetch {dest.name}")
        with urllib.request.urlopen(url, timeout=120) as response:
            dest.write_bytes(response.read())


def _required(env: dict[str, str], name: str) -> Path:
    value = env.get(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is required")
    return Path(value)


def _stamp_parts(stamp: str) -> tuple[str, str, str, str]:
    date, time = stamp.replace("Z", "").split("T")
    year, month, day = date.split("-")
    hour = time.split(":")[0]
    return year, month, day, hour


def _process_args() -> list[str]:
    try:
        completed = subprocess.run(["ps", "-eo", "args"], check=False, capture_output=True, text=True)
    except OSError:
        return []
    return completed.stdout.splitlines()


def check_config(env: dict[str, str]) -> int:
    domain_path = Path(env.get("WRF_DOMAIN") or ROOT / "config" / "wrf" / "domain.json")
    domain = load_domain(domain_path)
    nest = domain["nest_1km"]["enabled"]
    print(f"domain {domain['id']} nest_1km={nest}")
    for name in ("WRF_GEOG_DIR", "WRF_GFS_DIR", "WRF_WORK_DIR", "WRF_OUTPUT_DIR"):
        print(f"{name}={'set' if env.get(name) else 'unset'}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one local WRF cycle")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--fixture", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    env = dict(os.environ)
    if args.check:
        return check_config(env)
    print(run_cycle(env, args.fixture, args.output))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        print(f"WRF cycle failed: {exc.__class__.__name__}", file=sys.stderr)
        raise SystemExit(1) from exc

#!/usr/bin/env python3
"""Time WRF stages. `--fixture` times post-processing only and does not fetch."""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

from orchestrate import EXAMPLE_STATIONS, plan_stages
from postprocess import write_product


def peak_ram_kib() -> int | None:
    status = Path("/proc/self/status")
    if not status.exists():
        return None
    for line in status.read_text().splitlines():
        if line.startswith("VmHWM:"):
            return int(line.split()[1])
    return None


def run_benchmark(fixture: Path, output: Path, work: Path | None = None) -> dict:
    stages = []
    planned = plan_stages(work or Path("/nonexistent-wrf-work"))
    for name in ("fetch_gfs", *planned):
        if name != "postprocess":
            stages.append({"name": name, "status": "skipped", "wall_s": None})
            continue
        started = time.perf_counter()
        write_product(fixture, list(EXAMPLE_STATIONS), output / "latest.json")
        stages.append(
            {
                "name": name,
                "status": "ran",
                "wall_s": round(time.perf_counter() - started, 6),
            }
        )
    return {
        "cores": os.cpu_count(),
        "peak_ram_kib": peak_ram_kib(),
        "stages": stages,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Time one WRF post-process")
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = run_benchmark(args.fixture, args.output)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

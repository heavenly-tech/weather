"""EXAMPLE wrfout only. These tests do not call NOMADS or Docker."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

import benchmark  # noqa: E402
import gfs  # noqa: E402
import orchestrate  # noqa: E402
import postprocess  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "wrf" / "wrfout-example.json"
PRODUCT = ROOT / "tests" / "fixtures" / "wrf" / "latest.json"


class PostprocessTest(unittest.TestCase):
    def test_example_wrfout_picks_the_nearest_point(self) -> None:
        product = postprocess.postprocess(
            json.loads(FIXTURE.read_text()),
            [("SCEL", -33.393, -70.786), ("SCTB", -33.456, -70.546)],
        )
        scel = product["stations"]["SCEL"]["hours"][0]
        sctb = product["stations"]["SCTB"]["hours"][0]
        self.assertEqual(scel["tempC"], 12.5)
        self.assertEqual(scel["dewpointC"], 11.0)
        self.assertEqual(scel["windKt"], 10)
        self.assertEqual(scel["windDirDeg"], 270)
        self.assertEqual(scel["visKm"], 0.8)
        self.assertEqual(scel["fogGuidance"], "FG")
        self.assertEqual(scel["weatherCode"], 45)
        self.assertEqual(scel["precipMm"], 0.5)
        self.assertEqual(scel["ceilingFt"], 984.3)
        self.assertEqual(sctb["tempC"], 7.0)
        self.assertEqual(sctb["fogGuidance"], "BR")
        self.assertEqual(product["grid"]["rows"], 2)
        self.assertEqual(product["grid"]["cols"], 2)
        self.assertEqual(product["cycle"], "2026-11-18T00:00:00Z")

    def test_committed_product_matches_the_postprocessor(self) -> None:
        product = postprocess.postprocess(
            json.loads(FIXTURE.read_text()),
            list(orchestrate.EXAMPLE_STATIONS),
        )
        self.assertEqual(json.loads(PRODUCT.read_text()), product)


class OrchestratorTest(unittest.TestCase):
    def test_heavenly_is_refused(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            orchestrate.run_cycle({"WRF_HOST": "heavenly"}, FIXTURE, Path("/tmp/unused-wrf"))
        self.assertIn("omarchibald", str(raised.exception))

    def test_ci_build_skips_the_cycle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            flag = Path(tmp) / "ci-busy"
            flag.write_text("build\n")
            message = orchestrate.run_cycle(
                {"WRF_HOST": "omarchibald", "WRF_CI_BUSY_FILE": str(flag)},
                FIXTURE,
                Path(tmp),
            )
        self.assertEqual(message, "skipped: CI build is running")

    def test_fixture_does_not_download(self) -> None:
        called = {"fetch": False}

        def boom(*_args, **_kwargs):
            called["fetch"] = True
            raise AssertionError("NOMADS was called")

        original = orchestrate._fetch_gfs
        orchestrate._fetch_gfs = boom
        try:
            with tempfile.TemporaryDirectory() as tmp:
                message = orchestrate.run_cycle(
                    {"WRF_HOST": "mac-mini"},
                    FIXTURE,
                    Path(tmp),
                )
                self.assertEqual(message, "postprocess")
                self.assertTrue((Path(tmp) / "latest.json").is_file())
        finally:
            orchestrate._fetch_gfs = original
        self.assertFalse(called["fetch"])

    def test_nest_flag_is_not_built(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            orchestrate.run_cycle({"WRF_HOST": "omarchibald", "WRF_NEST_1KM": "1"}, None, None)
        self.assertIn("not built", str(raised.exception))

    def test_geogrid_is_cached(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            self.assertIn("geogrid", orchestrate.plan_stages(work))
            (work / "geo_em.d01.nc").write_text("cached\n")
            self.assertNotIn("geogrid", orchestrate.plan_stages(work))

    def test_namelist_uses_the_geog_dir_from_env(self) -> None:
        domain = json.loads((ROOT / "config" / "wrf" / "domain.json").read_text())
        template = (ROOT / "config" / "wrf" / "namelist.wps.template").read_text()
        text = orchestrate.render_namelist(
            template,
            orchestrate.namelist_values(
                domain,
                "/geog-example",
                "2026-11-18T00:00:00Z",
                "2026-11-20T00:00:00Z",
            ),
        )
        self.assertIn("geog_data_path = '/geog-example'", text)
        self.assertNotIn("{{", text)
        self.assertFalse(domain["nest_1km"]["enabled"])

    def test_gfs_url_is_the_public_filter(self) -> None:
        url = gfs.filter_url("20261118", "00", 0)
        self.assertTrue(url.startswith(gfs.NOMADS_FILTER))
        self.assertIn("gfs.t00z.pgrb2.0p25.f000", url)
        self.assertNotIn("token", url.lower())
        self.assertNotIn("password", url.lower())

    def test_docker_command_yields_and_uses_the_unprivileged_user(self) -> None:
        command = orchestrate.docker_command(
            "ncar/iwrf",
            Path("/work-example"),
            Path("/geog-example"),
            Path("/gfs-example"),
            Path("/output-example"),
            "wrf.exe",
        )
        self.assertEqual(command[:6], ["nice", "-n", "19", "ionice", "-c", "3"])
        self.assertIn("--user", command)
        self.assertIn("65534:65534", command)
        self.assertIn("ncar/iwrf", command)

    def test_check_does_not_require_the_host(self) -> None:
        self.assertEqual(orchestrate.check_config({"WRF_HOST": "cursor"}), 0)

    def test_image_is_alpine_and_unprivileged(self) -> None:
        text = (ROOT / "deploy" / "wrf" / "Dockerfile").read_text()
        self.assertIn("FROM alpine:3", text)
        self.assertIn("USER 65534:65534", text)


class BenchmarkTest(unittest.TestCase):
    def test_fixture_reports_wall_cores_and_peak(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report = benchmark.run_benchmark(FIXTURE, Path(tmp))
        names = [stage["name"] for stage in report["stages"]]
        self.assertIn("postprocess", names)
        ran = [stage for stage in report["stages"] if stage["status"] == "ran"]
        self.assertEqual([stage["name"] for stage in ran], ["postprocess"])
        self.assertGreaterEqual(ran[0]["wall_s"], 0.0)
        self.assertGreater(report["cores"], 0)
        self.assertIsInstance(report["peak_ram_kib"], int)
        self.assertNotIn("NOMADS", json.dumps(report))


if __name__ == "__main__":
    os.environ.pop("WRF_NEST_1KM", None)
    unittest.main()

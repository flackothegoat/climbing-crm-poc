from __future__ import annotations

import unittest
from datetime import datetime, timezone
from pathlib import Path

from live_stream_worker import (
    ClipJob,
    WorkerSettings,
    build_observation_request,
    load_worker_calibration,
    normalize_stream_url,
)


class LiveStreamWorkerTest(unittest.TestCase):
    def test_loads_route_independent_defaults_for_api_managed_routes(self) -> None:
        calibration = load_worker_calibration(
            Path(__file__).with_name("worker-defaults.json"),
            api_managed_routes=True,
        )

        self.assertEqual(calibration["analysis_resolution"], [640, 360])
        self.assertNotIn("route_id", calibration)
        self.assertNotIn("start_zones", calibration)

    def test_rejects_route_independent_defaults_in_legacy_mode(self) -> None:
        with self.assertRaisesRegex(ValueError, "route-specific calibration"):
            load_worker_calibration(
                Path(__file__).with_name("worker-defaults.json"),
                api_managed_routes=False,
            )

    def test_normalizes_wss_flv_for_ffmpeg(self) -> None:
        self.assertEqual(
            normalize_stream_url("wss://camera.example/live.flv?codec=H264"),
            "https://camera.example/live.flv?codec=H264",
        )

    def test_builds_stable_idempotent_observation_request(self) -> None:
        settings = WorkerSettings(
            stream_url="https://camera.example/live.flv",
            calibration_path=Path("calibration.json"),
            model_path=Path("model.pt"),
            output_path=Path("output"),
            record_fps=8,
            detection_fps=4,
            person_dwell_s=0.75,
            pre_roll_s=3,
            absent_finish_s=3,
            min_attempt_s=4,
            max_attempt_s=90,
            imgsz=640,
            api_url="http://api:3101/api",
            worker_token="worker-token-with-more-than-32-characters",
            route_id="route-1",
            route_version_id="version-1",
            wall_segment_id="segment-1",
            probe_seconds=0,
            max_attempts=0,
            route_refresh_s=30,
        )
        job = ClipJob(
            attempt_id="live-001",
            video_path=Path("live-001.mp4"),
            observed_at=datetime(2026, 8, 27, tzinfo=timezone.utc).isoformat(),
            duration_s=42,
        )
        analysis = {"outcome": "COMPLETED", "confidence": 0.7}
        first = build_observation_request(job, settings, analysis)
        second = build_observation_request(job, settings, analysis)
        self.assertEqual(first["requestKey"], second["requestKey"])
        self.assertEqual(first["routeVersionId"], "version-1")
        self.assertEqual(first["wallSegmentId"], "segment-1")


if __name__ == "__main__":
    unittest.main()

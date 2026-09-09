from __future__ import annotations

import os
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from live_stream_worker import (
    ClipJob,
    WorkerSettings,
    build_observation_request,
    discard_unassigned_attempt,
    file_sha256,
    has_confirmed_start,
    load_worker_calibration,
    normalize_stream_url,
    prune_stale_worker_files,
)


class LiveStreamWorkerTest(unittest.TestCase):
    def test_loads_route_independent_defaults_for_api_managed_routes(self) -> None:
        calibration = load_worker_calibration(
            Path(__file__).with_name("worker-defaults.json"),
            api_managed_routes=True,
        )

        self.assertEqual(calibration["analysis_resolution"], [640, 360])
        self.assertEqual(calibration["pose_visibility_threshold"], 0.45)
        self.assertEqual(calibration["start_dwell_seconds"], 0.8)
        self.assertEqual(calibration["start_confirmation_window_seconds"], 5.0)
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

    def test_discards_unassigned_video_and_analysis_artifacts(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "temporary-clips" / "live-001.mp4"
            output = root / "attempts" / "live-001"
            video.parent.mkdir(parents=True)
            output.mkdir(parents=True)
            video.write_bytes(b"temporary-video")
            (output / "summary.json").write_text("{}", encoding="utf-8")
            job = ClipJob(
                attempt_id="live-001",
                video_path=video,
                observed_at=datetime(2026, 8, 27, tzinfo=timezone.utc).isoformat(),
                duration_s=42,
            )

            discard_unassigned_attempt(job, output)

            self.assertFalse(video.exists())
            self.assertFalse(output.exists())

    def test_only_confirmed_start_can_be_published(self) -> None:
        self.assertFalse(has_confirmed_start({"result": {"started_at_s": None}}))
        self.assertTrue(has_confirmed_start({"result": {"started_at_s": 12.5}}))

    def test_calculates_video_checksum_without_loading_entire_file(self) -> None:
        with TemporaryDirectory() as directory:
            video = Path(directory) / "evidence.mp4"
            video.write_bytes(b"camera-evidence")

            self.assertEqual(
                file_sha256(video),
                "f5cee54fb1838c897dd490afc0f2eb07e1b69487179819a8a9331f082db19a0c",
            )

    def test_prunes_only_expired_temporary_files(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            clips = root / "temporary-clips"
            clips.mkdir()
            expired = clips / "expired.mp4"
            current = clips / "current.mp4"
            expired.write_bytes(b"expired")
            current.write_bytes(b"current")
            old_time = time.time() - 25 * 60 * 60
            os.utime(expired, (old_time, old_time))

            prune_stale_worker_files(root)

            self.assertFalse(expired.exists())
            self.assertTrue(current.exists())


if __name__ == "__main__":
    unittest.main()

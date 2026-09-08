from __future__ import annotations

import argparse
import hashlib
import json
import os
import queue
import shutil
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import cv2
import requests
from ultralytics import YOLO

from analyze_climb_video import (
    Rect,
    analyze,
    select_climber,
    to_observation_analysis,
)


@dataclass(frozen=True)
class WorkerSettings:
    stream_url: str
    calibration_path: Path
    model_path: Path
    output_path: Path
    record_fps: float
    detection_fps: float
    person_dwell_s: float
    pre_roll_s: float
    absent_finish_s: float
    min_attempt_s: float
    max_attempt_s: float
    imgsz: int
    api_url: str | None
    worker_token: str | None
    route_id: str | None
    route_version_id: str | None
    wall_segment_id: str | None
    probe_seconds: float
    max_attempts: int
    route_refresh_s: float


@dataclass(frozen=True)
class ClipJob:
    attempt_id: str
    video_path: Path
    observed_at: str
    duration_s: float


class AttemptRecorder:
    def __init__(
        self,
        output_path: Path,
        frame_size: tuple[int, int],
        fps: float,
        person_dwell_s: float,
        pre_roll_s: float,
        absent_finish_s: float,
        min_attempt_s: float,
        max_attempt_s: float,
    ) -> None:
        self.output_path = output_path
        self.frame_size = frame_size
        self.fps = fps
        self.person_dwell_s = person_dwell_s
        self.absent_finish_s = absent_finish_s
        self.min_attempt_s = min_attempt_s
        self.max_attempt_s = max_attempt_s
        self.pre_roll: deque[Any] = deque(maxlen=max(1, round(pre_roll_s * fps)))
        self.detected_since: float | None = None
        self.absent_since: float | None = None
        self.started_at: float | None = None
        self.observed_at: str | None = None
        self.attempt_id: str | None = None
        self.video_path: Path | None = None
        self.writer: cv2.VideoWriter | None = None
        self.written_frames = 0

    @property
    def active(self) -> bool:
        return self.writer is not None

    def push(
        self,
        frame: Any,
        climber_present: bool,
        monotonic_s: float,
        observed_at: datetime,
    ) -> ClipJob | None:
        if not self.active:
            self.pre_roll.append(frame.copy())
            if climber_present:
                self.detected_since = self.detected_since or monotonic_s
                if monotonic_s - self.detected_since >= self.person_dwell_s:
                    self._start(monotonic_s, observed_at)
            else:
                self.detected_since = None
            return None

        assert self.writer is not None and self.started_at is not None
        self.writer.write(frame)
        self.written_frames += 1
        if climber_present:
            self.absent_since = None
        else:
            self.absent_since = self.absent_since or monotonic_s

        elapsed = monotonic_s - self.started_at
        ended_for_absence = (
            self.absent_since is not None
            and elapsed >= self.min_attempt_s
            and monotonic_s - self.absent_since >= self.absent_finish_s
        )
        if ended_for_absence or elapsed >= self.max_attempt_s:
            return self._finish()
        return None

    def close(self) -> ClipJob | None:
        return self._finish() if self.active else None

    def _start(self, monotonic_s: float, observed_at: datetime) -> None:
        timestamp = observed_at.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.attempt_id = f"live-{timestamp}-{uuid.uuid4().hex[:8]}"
        clips_path = self.output_path / "temporary-clips"
        clips_path.mkdir(parents=True, exist_ok=True)
        self.video_path = clips_path / f"{self.attempt_id}.mp4"
        self.writer = cv2.VideoWriter(
            str(self.video_path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            self.fps,
            self.frame_size,
        )
        if not self.writer.isOpened():
            self.writer = None
            raise RuntimeError(f"无法创建尝试录像: {self.video_path}")
        for buffered in self.pre_roll:
            self.writer.write(buffered)
            self.written_frames += 1
        self.pre_roll.clear()
        self.started_at = monotonic_s
        self.observed_at = observed_at.astimezone(timezone.utc).isoformat()
        self.absent_since = None
        print(f"[{self.observed_at}] detected attempt {self.attempt_id}", flush=True)

    def _finish(self) -> ClipJob:
        assert self.writer is not None
        assert self.attempt_id and self.video_path and self.observed_at
        self.writer.release()
        job = ClipJob(
            attempt_id=self.attempt_id,
            video_path=self.video_path,
            observed_at=self.observed_at,
            duration_s=self.written_frames / self.fps,
        )
        print(
            f"[{datetime.now(timezone.utc).isoformat()}] queued {job.attempt_id} "
            f"({job.duration_s:.1f}s)",
            flush=True,
        )
        self.writer = None
        self.attempt_id = None
        self.video_path = None
        self.observed_at = None
        self.started_at = None
        self.detected_since = None
        self.absent_since = None
        self.written_frames = 0
        return job


def parse_args() -> WorkerSettings:
    parser = argparse.ArgumentParser(
        description="Continuously decode the WVP FLV stream and analyze segmented climbing attempts."
    )
    parser.add_argument(
        "--stream-url",
        default=os.getenv("CAMERA_HTTP_FLV_URL") or os.getenv("CAMERA_RESOURCE_URL"),
    )
    parser.add_argument(
        "--calibration",
        type=Path,
        default=Path(
            os.getenv(
                "CAMERA_WORKER_CALIBRATION_PATH",
                "worker-defaults.json",
            )
        ),
    )
    parser.add_argument("--model", type=Path, default=Path("models/yolo11n-pose.pt"))
    parser.add_argument("--output", type=Path, default=Path("output/live-worker"))
    parser.add_argument("--record-fps", type=float, default=8.0)
    parser.add_argument("--detection-fps", type=float, default=4.0)
    parser.add_argument("--person-dwell-s", type=float, default=0.75)
    parser.add_argument("--pre-roll-s", type=float, default=3.0)
    parser.add_argument("--absent-finish-s", type=float, default=3.0)
    parser.add_argument("--min-attempt-s", type=float, default=4.0)
    parser.add_argument("--max-attempt-s", type=float, default=600.0)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--api-url", default=os.getenv("CAMERA_WORKER_API_URL"))
    parser.add_argument("--worker-token", default=os.getenv("CAMERA_WORKER_TOKEN"))
    parser.add_argument("--route-id", default=os.getenv("CAMERA_ROUTE_ID"))
    parser.add_argument("--route-version-id", default=os.getenv("CAMERA_ROUTE_VERSION_ID"))
    parser.add_argument("--wall-segment-id", default=os.getenv("CAMERA_WALL_SEGMENT_ID"))
    parser.add_argument(
        "--probe-seconds",
        type=float,
        default=0,
        help="Decode only for this many seconds, print stream metadata, then exit.",
    )
    parser.add_argument("--max-attempts", type=int, default=0)
    parser.add_argument(
        "--route-refresh-s",
        type=float,
        default=float(os.getenv("CAMERA_ROUTE_REFRESH_SECONDS", "30")),
    )
    values = parser.parse_args()
    if not values.stream_url:
        parser.error("--stream-url or CAMERA_HTTP_FLV_URL/CAMERA_RESOURCE_URL is required")
    if values.record_fps <= 0 or values.detection_fps <= 0:
        parser.error("record and detection FPS must be positive")
    if values.max_attempt_s <= values.min_attempt_s or values.max_attempt_s > 600:
        parser.error("max attempt duration must be above the minimum and at most 600 seconds")
    if values.api_url and not values.worker_token:
        parser.error("API submission requires a worker token")
    if bool(values.route_id) != bool(values.route_version_id):
        parser.error("route id and route version id must be configured together")
    if values.route_refresh_s < 5:
        parser.error("route definition refresh interval must be at least 5 seconds")
    return WorkerSettings(
        stream_url=normalize_stream_url(values.stream_url),
        calibration_path=values.calibration,
        model_path=values.model,
        output_path=values.output,
        record_fps=values.record_fps,
        detection_fps=values.detection_fps,
        person_dwell_s=values.person_dwell_s,
        pre_roll_s=values.pre_roll_s,
        absent_finish_s=values.absent_finish_s,
        min_attempt_s=values.min_attempt_s,
        max_attempt_s=values.max_attempt_s,
        imgsz=values.imgsz,
        api_url=values.api_url,
        worker_token=values.worker_token,
        route_id=values.route_id,
        route_version_id=values.route_version_id,
        wall_segment_id=values.wall_segment_id,
        probe_seconds=values.probe_seconds,
        max_attempts=values.max_attempts,
        route_refresh_s=values.route_refresh_s,
    )


class RouteDefinitionProvider:
    """Caches user-confirmed route definitions without hiding API failures at startup."""

    def __init__(self, settings: WorkerSettings) -> None:
        self.api_url = settings.api_url
        self.worker_token = settings.worker_token
        self.enabled = bool(self.api_url and self.worker_token and not settings.route_id)
        self.refresh_s = settings.route_refresh_s
        self._definitions: list[dict[str, Any]] = []
        self._refreshed_at = 0.0
        self._lock = threading.Lock()

    def start(self) -> None:
        if not self.enabled:
            return
        definitions = self._fetch()
        if not definitions:
            raise RuntimeError("API 中还没有可供 Worker 监控的已发布线路定义")

    def get(self) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        with self._lock:
            stale = time.monotonic() - self._refreshed_at >= self.refresh_s
        if stale:
            try:
                self._fetch()
            except Exception as error:
                with self._lock:
                    if not self._definitions:
                        raise
                print(f"route definition refresh failed; using cache: {error}", flush=True)
        with self._lock:
            return list(self._definitions)

    @property
    def count(self) -> int:
        with self._lock:
            return len(self._definitions)

    def _fetch(self) -> list[dict[str, Any]]:
        assert self.api_url and self.worker_token
        definitions = fetch_route_definitions(self.api_url, self.worker_token)
        with self._lock:
            self._definitions = definitions
            self._refreshed_at = time.monotonic()
        return definitions


def normalize_stream_url(value: str) -> str:
    parts = urlsplit(value)
    scheme = {"wss": "https", "ws": "http"}.get(parts.scheme, parts.scheme)
    if scheme not in {"http", "https"}:
        raise ValueError("实时 Worker 需要 HTTP(S)-FLV 或可转换的 WS(S)-FLV 地址")
    return urlunsplit((scheme, parts.netloc, parts.path, parts.query, ""))


def main() -> None:
    settings = parse_args()
    route_definitions = RouteDefinitionProvider(settings)
    calibration = load_worker_calibration(
        settings.calibration_path,
        api_managed_routes=route_definitions.enabled,
    )
    resolution = calibration.get("analysis_resolution", [640, 360])
    target_size = (int(resolution[0]), int(resolution[1]))
    settings.output_path.mkdir(parents=True, exist_ok=True)
    prune_stale_worker_files(settings.output_path)

    if settings.probe_seconds > 0:
        probe_stream(settings.stream_url, target_size, settings.probe_seconds)
        return

    route_definitions.start()
    if route_definitions.enabled:
        print(
            f"loaded {route_definitions.count} published camera route definition(s)",
            flush=True,
        )

    detector = YOLO(str(settings.model_path))
    climber_roi = Rect.from_list(calibration["climber_roi"])
    recorder = AttemptRecorder(
        settings.output_path,
        target_size,
        settings.record_fps,
        settings.person_dwell_s,
        settings.pre_roll_s,
        settings.absent_finish_s,
        settings.min_attempt_s,
        settings.max_attempt_s,
    )
    jobs: queue.Queue[ClipJob | None] = queue.Queue(maxsize=4)
    analyzer = threading.Thread(
        target=analysis_loop,
        args=(jobs, settings, calibration, route_definitions),
        name="climbing-analysis",
        daemon=True,
    )
    analyzer.start()
    shutdown = threading.Event()
    signal.signal(signal.SIGTERM, lambda _signum, _frame: shutdown.set())

    submitted = 0
    try:
        while not shutdown.is_set() and (
            settings.max_attempts <= 0 or submitted < settings.max_attempts
        ):
            submitted += consume_stream(
                settings,
                detector,
                climber_roi,
                recorder,
                jobs,
                target_size,
                settings.max_attempts - submitted if settings.max_attempts else 0,
                shutdown,
                route_definitions,
            )
            if not shutdown.is_set() and (
                settings.max_attempts <= 0 or submitted < settings.max_attempts
            ):
                time.sleep(2)
    except KeyboardInterrupt:
        shutdown.set()
    finally:
        pending = recorder.close()
        if pending:
            jobs.put(pending)
        jobs.join()
        jobs.put(None)
        analyzer.join(timeout=5)


def load_worker_calibration(
    path: Path,
    *,
    api_managed_routes: bool,
) -> dict[str, Any]:
    """Load shared algorithm thresholds and reject incomplete legacy configuration."""
    if not path.is_file():
        raise FileNotFoundError(f"Worker calibration file does not exist: {path}")
    calibration = json.loads(path.read_text(encoding="utf-8"))
    required_shared_fields = {
        "analysis_resolution",
        "processing_fps",
        "reference_time_s",
        "climber_roi",
        "wall_roi",
        "pose_visibility_threshold",
        "start_dwell_seconds",
        "finish_dwell_seconds",
        "finish_hand_tolerance_seconds",
        "contact_dwell_seconds",
        "contact_radius_px",
        "off_route_contact_radius_px",
        "off_route_failure_ratio",
        "hand_extension_ratio",
        "fall_window_seconds",
        "fall_min_drop_normalized",
        "fall_min_hip_y",
    }
    missing = sorted(required_shared_fields.difference(calibration))
    if missing:
        raise ValueError(
            f"Worker calibration is missing shared fields: {', '.join(missing)}"
        )
    if not api_managed_routes:
        required_route_fields = {
            "wall_id",
            "route_id",
            "start_zones",
        }
        missing_route_fields = sorted(required_route_fields.difference(calibration))
        has_finish = bool(
            calibration.get("finish_zones") or calibration.get("finish_zone")
        )
        if missing_route_fields or not has_finish:
            details = missing_route_fields + ([] if has_finish else ["finish_zones"])
            raise ValueError(
                "Legacy single-route mode requires route-specific calibration fields: "
                + ", ".join(details)
            )
    return calibration


def probe_stream(stream_url: str, target_size: tuple[int, int], seconds: float) -> None:
    capture = cv2.VideoCapture(stream_url, cv2.CAP_FFMPEG)
    if not capture.isOpened():
        raise RuntimeError("FFmpeg/OpenCV 无法打开实时 FLV 地址")
    source = {
        "codec": "H264",
        "width": int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        "fps": round(float(capture.get(cv2.CAP_PROP_FPS)), 3),
    }
    started = time.monotonic()
    frames = 0
    while time.monotonic() - started < seconds:
        ok, frame = capture.read()
        if not ok:
            break
        cv2.resize(frame, target_size, interpolation=cv2.INTER_AREA)
        frames += 1
    elapsed = time.monotonic() - started
    capture.release()
    result = {
        "status": "ONLINE" if frames else "OFFLINE",
        "source": source,
        "analysisResolution": list(target_size),
        "decodedFrames": frames,
        "elapsedS": round(elapsed, 3),
        "decodeFps": round(frames / elapsed, 3) if elapsed else 0,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not frames:
        raise RuntimeError("连接已建立，但没有解码出视频帧")


def consume_stream(
    settings: WorkerSettings,
    detector: YOLO,
    climber_roi: Rect,
    recorder: AttemptRecorder,
    jobs: queue.Queue[ClipJob | None],
    target_size: tuple[int, int],
    remaining_attempts: int,
    shutdown: threading.Event,
    route_definitions: RouteDefinitionProvider,
) -> int:
    capture = cv2.VideoCapture(settings.stream_url, cv2.CAP_FFMPEG)
    if not capture.isOpened():
        report_status(
            settings,
            "OFFLINE",
            "无法打开实时流",
            route_definition_count=route_definitions.count,
        )
        return 0
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    report_status(
        settings,
        "ONLINE",
        "实时流已连接",
        route_definition_count=route_definitions.count,
    )
    last_recorded = 0.0
    last_detection = 0.0
    last_status = 0.0
    last_prune = 0.0
    reference_idle_since: float | None = None
    reference_path = settings.output_path / "live-reference.jpg"
    climber_present = False
    completed = 0
    consecutive_failures = 0
    record_interval = 1.0 / settings.record_fps
    detection_interval = 1.0 / settings.detection_fps
    try:
        while not shutdown.is_set() and (
            remaining_attempts <= 0 or completed < remaining_attempts
        ):
            ok, source_frame = capture.read()
            now = time.monotonic()
            if not ok:
                consecutive_failures += 1
                if consecutive_failures >= 15:
                    report_status(
                        settings,
                        "OFFLINE",
                        "连续读取视频帧失败",
                        route_definition_count=route_definitions.count,
                    )
                    break
                continue
            consecutive_failures = 0
            if now - last_recorded < record_interval:
                continue
            last_recorded = now
            frame = cv2.resize(source_frame, target_size, interpolation=cv2.INTER_AREA)
            if now - last_detection >= detection_interval:
                prediction = detector.predict(frame, imgsz=settings.imgsz, verbose=False)[0]
                climber_present = (
                    select_climber(
                        prediction, climber_roi, target_size[0], target_size[1]
                    )
                    is not None
                )
                last_detection = now
            if not reference_path.exists() and not recorder.active:
                if climber_present:
                    reference_idle_since = None
                else:
                    reference_idle_since = reference_idle_since or now
                    if now - reference_idle_since >= 2:
                        if not cv2.imwrite(str(reference_path), frame):
                            raise RuntimeError("无法保存实时空墙参考帧")
                        print(f"saved empty-wall reference {reference_path}", flush=True)
            job = recorder.push(frame, climber_present, now, datetime.now(timezone.utc))
            if job:
                jobs.put(job)
                completed += 1
            if now - last_status >= 5:
                route_definitions.get()
                report_status(
                    settings,
                    "ONLINE",
                    "尝试录制中" if recorder.active else "等待攀爬者进入",
                    active_attempt=recorder.attempt_id,
                    route_definition_count=route_definitions.count,
                )
                last_status = now
            if now - last_prune >= 5 * 60:
                prune_stale_worker_files(settings.output_path)
                last_prune = now
    finally:
        capture.release()
    return completed


def analysis_loop(
    jobs: queue.Queue[ClipJob | None],
    settings: WorkerSettings,
    calibration: dict[str, Any],
    route_definitions: RouteDefinitionProvider,
) -> None:
    pose_model = YOLO(str(settings.model_path))
    while True:
        job = jobs.get()
        try:
            if job is None:
                return
            analyze_job(job, settings, calibration, pose_model, route_definitions)
        except Exception as error:  # keep the long-running worker alive
            print(f"analysis failed: {error}", flush=True)
        finally:
            jobs.task_done()


def analyze_job(
    job: ClipJob,
    settings: WorkerSettings,
    calibration: dict[str, Any],
    pose_model: YOLO,
    route_definitions: RouteDefinitionProvider,
) -> None:
    output = settings.output_path / "attempts" / job.attempt_id
    output.mkdir(parents=True, exist_ok=True)
    definitions = route_definitions.get()
    if route_definitions.enabled:
        if not definitions:
            raise RuntimeError("API 中还没有可用的摄像头线路定义")
        analyze_multi_route_job(
            job, settings, calibration, definitions, output, pose_model
        )
        return
    attempt = {
        "id": job.attempt_id,
        "source_file": job.video_path.name,
        "start_s": 0.0,
        "end_s": job.duration_s,
    }
    result = analyze(
        job.video_path,
        settings.model_path,
        calibration,
        attempt,
        output,
        settings.imgsz,
        settings.output_path / "live-reference.jpg"
        if (settings.output_path / "live-reference.jpg").exists()
        else None,
        pose_model,
    )
    analysis = to_observation_analysis(result, settings.model_path, calibration)
    request = build_observation_request(job, settings, analysis)
    (output / "summary.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output / "observation-analysis.json").write_text(
        json.dumps(analysis, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output / "observation-request.json").write_text(
        json.dumps(request, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if settings.api_url and settings.worker_token:
        response = post_observation(settings.api_url, settings.worker_token, request)
        (output / "observation-response.json").write_text(
            json.dumps(response, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        upload_observation_evidence(
            settings.api_url,
            settings.worker_token,
            response["id"],
            job,
        )
        job.video_path.unlink(missing_ok=True)
        remove_rendered_videos(output)
    print(
        f"completed {job.attempt_id}: {analysis['outcome']} "
        f"confidence={analysis['confidence']}",
        flush=True,
    )


def analyze_multi_route_job(
    job: ClipJob,
    settings: WorkerSettings,
    base_calibration: dict[str, Any],
    definitions: list[dict[str, Any]],
    output: Path,
    pose_model: YOLO,
) -> None:
    candidates: list[tuple[float, dict[str, Any], dict[str, Any], dict[str, Any]]] = []
    all_holds = unique_holds(
        hold for definition in definitions for hold in definition["holds"]
    )
    for definition in definitions:
        calibration = calibration_from_definition(
            base_calibration, definition, all_holds
        )
        candidate_output = output / "candidates" / safe_path(
            definition["routeVersion"]["id"]
        )
        candidate_output.mkdir(parents=True, exist_ok=True)
        attempt = {
            "id": f"{job.attempt_id}-{definition['route']['code']}",
            "source_file": job.video_path.name,
            "start_s": 0.0,
            "end_s": job.duration_s,
        }
        result = analyze(
            job.video_path,
            settings.model_path,
            calibration,
            attempt,
            candidate_output,
            settings.imgsz,
            settings.output_path / "live-reference.jpg"
            if (settings.output_path / "live-reference.jpg").exists()
            else None,
            pose_model,
        )
        analysis = to_observation_analysis(result, settings.model_path, calibration)
        (candidate_output / "summary.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (candidate_output / "annotated.mp4").unlink(missing_ok=True)
        if result["result"]["started_at_s"] is None:
            continue
        score = float(result["result"].get("route_contact_ratio", 0)) + float(
            analysis["confidence"]
        )
        candidates.append((score, definition, result, analysis))

    if not candidates:
        discard_unassigned_attempt(job, output)
        print(f"unassigned {job.attempt_id}: no configured route start", flush=True)
        return

    _, definition, result, analysis = max(candidates, key=lambda item: item[0])
    request = build_observation_request(job, settings, analysis, definition)
    selected = {
        "definitionId": definition["id"],
        "revision": definition["revision"],
        "route": definition["route"],
        "routeVersion": definition["routeVersion"],
        "result": result["result"],
    }
    (output / "selected-route.json").write_text(
        json.dumps(selected, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output / "observation-request.json").write_text(
        json.dumps(request, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if settings.api_url and settings.worker_token:
        response = post_observation(settings.api_url, settings.worker_token, request)
        (output / "observation-response.json").write_text(
            json.dumps(response, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        upload_observation_evidence(
            settings.api_url,
            settings.worker_token,
            response["id"],
            job,
        )
        job.video_path.unlink(missing_ok=True)
        remove_rendered_videos(output)
    print(
        f"completed {job.attempt_id}: route={definition['route']['code']} "
        f"outcome={analysis['outcome']} confidence={analysis['confidence']}",
        flush=True,
    )


def build_observation_request(
    job: ClipJob,
    settings: WorkerSettings,
    analysis: dict[str, Any],
    definition: dict[str, Any] | None = None,
) -> dict[str, Any]:
    request: dict[str, Any] = {
        "requestKey": str(uuid.uuid5(uuid.NAMESPACE_URL, f"camera:{job.attempt_id}")),
        "routeId": definition["route"]["id"]
        if definition
        else settings.route_id or "CONFIGURE_CAMERA_ROUTE_ID",
        "routeVersionId": definition["routeVersion"]["id"]
        if definition
        else settings.route_version_id or "CONFIGURE_CAMERA_ROUTE_VERSION_ID",
        "observedAt": job.observed_at,
        "climberKey": job.attempt_id,
        "analysis": analysis,
    }
    wall_segment_id = (
        definition["wallSegment"]["id"] if definition else settings.wall_segment_id
    )
    if wall_segment_id:
        request["wallSegmentId"] = wall_segment_id
    return request


def fetch_route_definitions(
    api_url: str, worker_token: str
) -> list[dict[str, Any]]:
    request = urllib.request.Request(
        f"{api_url.rstrip('/')}/camera/worker/route-definitions",
        headers={"x-camera-worker-token": worker_token},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return list(payload.get("definitions", []))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"线路视觉定义读取失败 HTTP {error.code}: {detail}"
        ) from error


def calibration_from_definition(
    base: dict[str, Any],
    definition: dict[str, Any],
    all_holds: list[dict[str, Any]],
) -> dict[str, Any]:
    calibration = dict(base)
    roi = definition["roi"]
    route_holds = definition["holds"]
    route_positions = {hold_position_key(hold) for hold in route_holds}
    starts = [
        hold_rect(hold)
        for hold in route_holds
        if hold["id"] in definition["startHoldIds"]
    ]
    finishes = [
        hold_rect(hold)
        for hold in route_holds
        if hold["id"] in definition["finishHoldIds"]
    ]
    start_ids = set(definition["startHoldIds"])
    finish_ids = set(definition["finishHoldIds"])
    calibration.update(
        {
            "wall_id": f"{definition['cameraKey']}:{definition['id']}:r{definition['revision']}",
            "route_id": definition["route"]["id"],
            "climber_roi": [roi["x1"], roi["y1"], roi["x2"], roi["y2"]],
            "wall_roi": [roi["x1"], roi["y1"], roi["x2"], roi["y2"]],
            "start_zones": [
                {"id": f"start-{index}", "rect": rect}
                for index, rect in enumerate(starts)
            ],
            "finish_zones": [
                {"id": f"finish-{index}", "rect": rect}
                for index, rect in enumerate(finishes)
            ],
            "route_holds": route_holds,
            "start_holds": [hold for hold in route_holds if hold["id"] in start_ids],
            "finish_holds": [hold for hold in route_holds if hold["id"] in finish_ids],
            "forbidden_holds": [
                hold
                for hold in all_holds
                if hold_position_key(hold) not in route_positions
            ],
        }
    )
    return calibration


def hold_rect(hold: dict[str, Any], padding: float = 0.18) -> list[float]:
    half_width = float(hold["width"]) * (0.5 + padding)
    half_height = float(hold["height"]) * (0.5 + padding)
    return [
        max(0.0, float(hold["x"]) - half_width),
        max(0.0, float(hold["y"]) - half_height),
        min(1.0, float(hold["x"]) + half_width),
        min(1.0, float(hold["y"]) + half_height),
    ]


def unique_holds(holds: Any) -> list[dict[str, Any]]:
    result: dict[tuple[int, int], dict[str, Any]] = {}
    for hold in holds:
        result[hold_position_key(hold)] = hold
    return list(result.values())


def hold_position_key(hold: dict[str, Any]) -> tuple[int, int]:
    return (round(float(hold["x"]) * 10000), round(float(hold["y"]) * 10000))


def safe_path(value: str) -> str:
    return "".join(character if character.isalnum() or character in "-_" else "_" for character in value)


def post_observation(api_url: str, worker_token: str, payload: dict[str, Any]) -> Any:
    endpoint = f"{api_url.rstrip('/')}/camera/worker/observations"
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-camera-worker-token": worker_token,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"观察写入失败 HTTP {error.code}: {detail}") from error


def upload_observation_evidence(
    api_url: str,
    worker_token: str,
    observation_id: str,
    job: ClipJob,
) -> dict[str, Any]:
    evidence_path = transcode_evidence_video(job.video_path)
    size_bytes = evidence_path.stat().st_size
    checksum = file_sha256(evidence_path)
    endpoint = (
        f"{api_url.rstrip('/')}/camera/worker/observations/{observation_id}/evidence"
    )
    try:
        with evidence_path.open("rb") as video:
            response = requests.put(
                endpoint,
                data=video,
                headers={
                    "content-type": "video/mp4",
                    "content-length": str(size_bytes),
                    "x-camera-worker-token": worker_token,
                    "x-video-duration-ms": str(round(job.duration_s * 1000)),
                    "x-video-sha256": checksum,
                },
                timeout=(10, 120),
            )
    finally:
        evidence_path.unlink(missing_ok=True)
    if not response.ok:
        raise RuntimeError(
            f"识别录像上传失败 HTTP {response.status_code}: {response.text[:500]}"
        )
    return dict(response.json())


def transcode_evidence_video(source: Path) -> Path:
    target = source.with_name(f"{source.stem}.evidence.mp4")
    command = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "29",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(target),
    ]
    try:
        subprocess.run(command, check=True, timeout=300)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return target


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def discard_unassigned_attempt(job: ClipJob, output: Path) -> None:
    job.video_path.unlink(missing_ok=True)
    shutil.rmtree(output, ignore_errors=True)


def remove_rendered_videos(output: Path) -> None:
    for video in output.rglob("*.mp4"):
        video.unlink(missing_ok=True)


def prune_stale_worker_files(output_path: Path, max_age_s: float = 24 * 60 * 60) -> None:
    cutoff = time.time() - max_age_s
    temporary_clips = output_path / "temporary-clips"
    if temporary_clips.exists():
        for clip in temporary_clips.glob("*.mp4"):
            if clip.stat().st_mtime < cutoff:
                clip.unlink(missing_ok=True)
    attempts = output_path / "attempts"
    if attempts.exists():
        for attempt in attempts.iterdir():
            if attempt.is_dir() and attempt.stat().st_mtime < cutoff:
                shutil.rmtree(attempt, ignore_errors=True)


def report_status(
    settings: WorkerSettings,
    status: str,
    detail: str,
    *,
    active_attempt: str | None = None,
    route_definition_count: int = 0,
) -> None:
    checked_at = datetime.now(timezone.utc).isoformat()
    write_status(
        settings.output_path,
        status,
        detail,
        active_attempt=active_attempt,
        route_definition_count=route_definition_count,
        checked_at=checked_at,
    )
    if not settings.api_url or not settings.worker_token:
        return
    payload = {
        "status": status,
        "detail": detail,
        "activeAttempt": active_attempt,
        "routeDefinitionCount": route_definition_count,
        "checkedAt": checked_at,
    }
    try:
        post_worker_heartbeat(settings.api_url, settings.worker_token, payload)
    except Exception as error:
        print(f"worker heartbeat failed: {error}", flush=True)


def post_worker_heartbeat(
    api_url: str, worker_token: str, payload: dict[str, Any]
) -> None:
    request = urllib.request.Request(
        f"{api_url.rstrip('/')}/camera/worker/heartbeat",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-camera-worker-token": worker_token,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=2) as response:
            response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Worker 心跳失败 HTTP {error.code}: {detail}") from error


def write_status(
    output_path: Path,
    status: str,
    detail: str,
    *,
    active_attempt: str | None = None,
    route_definition_count: int = 0,
    checked_at: str | None = None,
) -> None:
    output_path.mkdir(parents=True, exist_ok=True)
    payload = {
        "status": status,
        "detail": detail,
        "activeAttempt": active_attempt,
        "routeDefinitionCount": route_definition_count,
        "checkedAt": checked_at or datetime.now(timezone.utc).isoformat(),
    }
    status_path = output_path / "status.json"
    temporary_path = output_path / "status.json.tmp"
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    temporary_path.replace(status_path)


if __name__ == "__main__":
    main()

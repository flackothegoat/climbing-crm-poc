from __future__ import annotations

import argparse
import json
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from ultralytics import YOLO


LEFT_ELBOW = 7
RIGHT_ELBOW = 8
LEFT_WRIST = 9
RIGHT_WRIST = 10
LEFT_HIP = 11
RIGHT_HIP = 12
LEFT_ANKLE = 15
RIGHT_ANKLE = 16

LIMBS = {
    "LEFT_HAND": (LEFT_ELBOW, LEFT_WRIST),
    "RIGHT_HAND": (RIGHT_ELBOW, RIGHT_WRIST),
    "LEFT_FOOT": (None, LEFT_ANKLE),
    "RIGHT_FOOT": (None, RIGHT_ANKLE),
}

POSE_CONNECTIONS = (
    (5, 6),
    (5, 7),
    (7, 9),
    (6, 8),
    (8, 10),
    (5, 11),
    (6, 12),
    (11, 12),
    (11, 13),
    (13, 15),
    (12, 14),
    (14, 16),
)


@dataclass(frozen=True)
class Rect:
    x1: float
    y1: float
    x2: float
    y2: float

    @classmethod
    def from_list(cls, values: list[float]) -> "Rect":
        return cls(*values)

    def contains(self, point: tuple[float, float]) -> bool:
        x, y = point
        return self.x1 <= x <= self.x2 and self.y1 <= y <= self.y2

    def pixel_points(self, width: int, height: int) -> tuple[tuple[int, int], tuple[int, int]]:
        return (
            (round(self.x1 * width), round(self.y1 * height)),
            (round(self.x2 * width), round(self.y2 * height)),
        )


@dataclass
class ContactCandidate:
    started_at_s: float | None = None
    emitted: bool = False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze a fixed-camera climbing attempt with explainable POC rules."
    )
    parser.add_argument("video", type=Path)
    parser.add_argument("--attempt", required=True)
    parser.add_argument(
        "--calibration",
        type=Path,
        default=Path("calibrations/yellow-route-camera.json"),
    )
    parser.add_argument("--model", type=Path, default=Path("models/yolo11n-pose.pt"))
    parser.add_argument("--output", type=Path, default=Path("output/yellow-route-camera"))
    parser.add_argument("--imgsz", type=int, default=640)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    calibration = json.loads(args.calibration.read_text(encoding="utf-8"))
    attempt = next(
        (item for item in calibration["attempts"] if item["id"] == args.attempt),
        None,
    )
    if attempt is None:
        raise ValueError(f"Unknown attempt id: {args.attempt}")
    if args.video.name != attempt["source_file"]:
        raise ValueError(
            f"Attempt {args.attempt} expects {attempt['source_file']}, got {args.video.name}"
        )

    output = args.output / args.attempt
    output.mkdir(parents=True, exist_ok=True)
    result = analyze(args.video, args.model, calibration, attempt, output, args.imgsz)
    observation_analysis = to_observation_analysis(result, args.model, calibration)
    observation_path = output / "observation-analysis.json"
    observation_path.write_text(
        json.dumps(observation_analysis, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    result["artifacts"]["observation_analysis"] = str(observation_path)
    (output / "summary.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


def analyze(
    video_path: Path,
    model_path: Path,
    calibration: dict[str, Any],
    attempt: dict[str, Any],
    output: Path,
    imgsz: int,
    reference_image_path: Path | None = None,
    pose_model: Any | None = None,
) -> dict[str, Any]:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")
    source_fps = float(capture.get(cv2.CAP_PROP_FPS))
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    start_s = float(attempt["start_s"])
    end_s = float(attempt["end_s"])
    sample_period_s = 1.0 / float(calibration["processing_fps"])

    reference = read_reference(
        capture,
        float(calibration["reference_time_s"]),
        reference_image_path,
        width,
        height,
    )
    route_mask, forbidden_mask = build_hold_masks(reference, calibration)
    cv2.imwrite(str(output / "route-mask.png"), route_mask)
    cv2.imwrite(str(output / "forbidden-mask.png"), forbidden_mask)
    cv2.imwrite(str(output / "reference.jpg"), reference)
    route_distance = distance_to_mask(route_mask)
    forbidden_distance = distance_to_mask(forbidden_mask)
    start_hold_distance = landmark_distance(reference, calibration.get("start_holds", []))
    finish_hold_distance = landmark_distance(reference, calibration.get("finish_holds", []))

    capture.set(cv2.CAP_PROP_POS_MSEC, start_s * 1000.0)
    output_fps = float(calibration["processing_fps"])
    writer = cv2.VideoWriter(
        str(output / "annotated.mp4"),
        cv2.VideoWriter_fourcc(*"mp4v"),
        output_fps,
        (width, height),
    )
    if not writer.isOpened():
        raise RuntimeError("Could not initialize annotated video writer")

    model = pose_model or YOLO(str(model_path))
    climber_roi = Rect.from_list(calibration["climber_roi"])
    start_zones = [Rect.from_list(item["rect"]) for item in calibration["start_zones"]]
    finish_items = calibration.get("finish_zones") or [calibration["finish_zone"]]
    finish_zones = [Rect.from_list(item["rect"]) for item in finish_items]
    visibility_threshold = float(calibration["pose_visibility_threshold"])
    start_dwell = float(calibration["start_dwell_seconds"])
    finish_dwell = float(calibration["finish_dwell_seconds"])
    finish_hand_tolerance = float(calibration["finish_hand_tolerance_seconds"])
    contact_dwell = float(calibration["contact_dwell_seconds"])
    contact_radius = float(calibration["contact_radius_px"])
    off_route_contact_radius = float(calibration["off_route_contact_radius_px"])
    off_route_failure_ratio = float(calibration["off_route_failure_ratio"])
    hand_extension = float(calibration["hand_extension_ratio"])
    fall_window = float(calibration["fall_window_seconds"])
    fall_min_drop = float(calibration["fall_min_drop_normalized"])
    fall_min_hip_y = float(calibration["fall_min_hip_y"])

    state = "WAITING_FOR_START"
    events: list[dict[str, Any]] = []
    records: list[dict[str, Any]] = []
    contact_candidates = {limb: ContactCandidate() for limb in LIMBS}
    last_finish_hit = {LEFT_WRIST: None, RIGHT_WRIST: None}
    hip_history: deque[tuple[float, float]] = deque()
    start_candidate_at: float | None = None
    finish_candidate_at: float | None = None
    started_at_s: float | None = None
    finished_at_s: float | None = None
    fall_at_s: float | None = None
    last_sample_at = start_s - sample_period_s
    processed_frames = 0
    detected_frames = 0
    limb_samples = 0
    route_contact_samples = 0
    off_route_samples = 0
    started_clock = time.perf_counter()

    while True:
        ok, frame = capture.read()
        if not ok:
            break
        timestamp_s = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        if timestamp_s <= 0:
            timestamp_s = capture.get(cv2.CAP_PROP_POS_FRAMES) / source_fps
        if timestamp_s > end_s:
            break
        if timestamp_s + 1e-6 < last_sample_at + sample_period_s:
            continue
        last_sample_at = timestamp_s
        processed_frames += 1

        prediction = model.predict(frame, imgsz=imgsz, conf=0.12, device="cpu", verbose=False)[0]
        person_index = select_climber(prediction, climber_roi, width, height)
        record: dict[str, Any] = {
            "timestamp_s": round(timestamp_s, 3),
            "pose_detected": person_index is not None,
            "state": state,
        }
        limb_points: dict[str, tuple[int, int]] = {}
        limb_contacts: dict[str, str] = {}

        if person_index is not None:
            detected_frames += 1
            xy = prediction.keypoints.xy[person_index].cpu().numpy()
            confidence = prediction.keypoints.conf[person_index].cpu().numpy()
            draw_pose(frame, xy, confidence, visibility_threshold)
            limb_points = resolve_limb_points(xy, confidence, visibility_threshold, hand_extension)
            wrists_normalized = [
                (float(xy[index][0] / width), float(xy[index][1] / height))
                for index in (LEFT_WRIST, RIGHT_WRIST)
                if confidence[index] >= visibility_threshold
            ]
            both_hands_at_start = len(wrists_normalized) == 2 and all(
                point_hits_landmark(
                    point,
                    start_hold_distance,
                    start_zones,
                    width,
                    height,
                    contact_radius,
                )
                for point in wrists_normalized
            )
            current_finish_hits: dict[int, bool] = {}
            for index in (LEFT_WRIST, RIGHT_WRIST):
                visible = confidence[index] >= visibility_threshold
                point = (float(xy[index][0] / width), float(xy[index][1] / height))
                current_finish_hits[index] = visible and point_hits_landmark(
                    point,
                    finish_hold_distance,
                    finish_zones,
                    width,
                    height,
                    contact_radius,
                )
                if current_finish_hits[index]:
                    last_finish_hit[index] = timestamp_s
            both_hands_at_finish = all(
                last_finish_hit[index] is not None
                and timestamp_s - float(last_finish_hit[index]) <= finish_hand_tolerance
                for index in (LEFT_WRIST, RIGHT_WRIST)
            ) and any(current_finish_hits.values())

            if state == "WAITING_FOR_START":
                start_candidate_at = update_dwell_candidate(
                    start_candidate_at, both_hands_at_start, timestamp_s
                )
                if start_candidate_at is not None and timestamp_s - start_candidate_at >= start_dwell:
                    started_at_s = start_candidate_at
                    state = "CLIMBING"
                    events.append(
                        event("STARTED", started_at_s, "两只手腕持续位于用户确认的线路起点区域", 0.7)
                    )
            elif state == "CLIMBING":
                finish_candidate_at = update_dwell_candidate(
                    finish_candidate_at, both_hands_at_finish, timestamp_s
                )
                if finish_candidate_at is not None and timestamp_s - finish_candidate_at >= finish_dwell:
                    finished_at_s = finish_candidate_at
                    state = "FINISH_REACHED"
                    events.append(
                        event("FINISH_REACHED", finished_at_s, "两只手腕持续位于用户确认的线路终点区域", 0.72)
                    )

            for limb, point in limb_points.items():
                route_gap = sample_distance(route_distance, point)
                forbidden_gap = sample_distance(forbidden_distance, point)
                contact = "NONE"
                if route_gap <= contact_radius and route_gap <= forbidden_gap:
                    contact = "ROUTE"
                elif forbidden_gap <= off_route_contact_radius:
                    contact = "OFF_ROUTE"
                limb_contacts[limb] = contact
                limb_samples += 1
                if contact == "ROUTE":
                    route_contact_samples += 1
                if contact == "OFF_ROUTE":
                    off_route_samples += 1
                candidate = contact_candidates[limb]
                active_climb = state in {"CLIMBING", "FINISH_REACHED"}
                if active_climb and contact == "OFF_ROUTE":
                    candidate.started_at_s = candidate.started_at_s or timestamp_s
                    if not candidate.emitted and timestamp_s - candidate.started_at_s >= contact_dwell:
                        candidate.emitted = True
                        confidence_score = round(
                            min(0.78, 0.45 + float(confidence[LIMBS[limb][1]]) * 0.3), 3
                        )
                        events.append(
                            event(
                                "OFF_ROUTE_CONTACT",
                                candidate.started_at_s,
                                f"{limb} 持续接近当前线路定义以外的岩点；单机位无法证明承重",
                                confidence_score,
                                limb=limb,
                            )
                        )
                else:
                    candidate.started_at_s = None

            if state == "CLIMBING":
                hip_y = mean_visible_y(
                    xy, confidence, (LEFT_HIP, RIGHT_HIP), visibility_threshold, height
                )
                if hip_y is not None:
                    hip_history.append((timestamp_s, hip_y))
                    while hip_history and timestamp_s - hip_history[0][0] > fall_window:
                        hip_history.popleft()
                    if (
                        len(hip_history) >= 2
                        and hip_y >= fall_min_hip_y
                        and hip_y - min(value for _, value in hip_history) >= fall_min_drop
                    ):
                        fall_at_s = timestamp_s
                        state = "FALL_DETECTED"
                        events.append(
                            event(
                                "FALL_BEFORE_FINISH",
                                timestamp_s,
                                "髋部在短时间内快速下移，且此前未确认双手终点",
                                0.68,
                            )
                        )

            record.update(
                {
                    "both_hands_at_start": both_hands_at_start,
                    "both_hands_at_finish": both_hands_at_finish,
                    "limb_contacts": limb_contacts,
                }
            )

        record["state"] = state
        records.append(record)
        draw_analysis_overlay(
            frame,
            route_mask,
            forbidden_mask,
            climber_roi,
            start_zones,
            finish_zones,
            limb_points,
            limb_contacts,
            state,
            timestamp_s,
        )
        writer.write(frame)

    capture.release()
    writer.release()
    elapsed_s = time.perf_counter() - started_clock

    off_route_events = [item for item in events if item["type"] == "OFF_ROUTE_CONTACT"]
    route_contact_ratio = route_contact_samples / limb_samples if limb_samples else 0.0
    off_route_exposure_ratio = off_route_samples / limb_samples if limb_samples else 0.0
    off_route_failure = (
        bool(off_route_events) and off_route_exposure_ratio >= off_route_failure_ratio
    )
    if started_at_s is None:
        outcome = "UNKNOWN"
        reasons = ["INVALID_OR_UNCONFIRMED_START"]
    elif finished_at_s is not None and off_route_failure:
        outcome = "FAILED"
        reasons = ["OFF_ROUTE_CONTACT"]
    elif finished_at_s is not None:
        outcome = "COMPLETED"
        reasons = []
    elif fall_at_s is not None:
        outcome = "FAILED"
        reasons = ["FALL_BEFORE_FINISH", "FINISH_NOT_CONFIRMED"]
    elif off_route_failure:
        outcome = "FAILED"
        reasons = ["OFF_ROUTE_CONTACT", "FINISH_NOT_CONFIRMED"]
    else:
        outcome = "FAILED"
        reasons = ["FINISH_NOT_CONFIRMED"]

    requires_review = outcome == "UNKNOWN" or bool(off_route_events)
    confidence = result_confidence(outcome, events)
    verification = {
        "expected_outcome": attempt.get("expected_outcome"),
        "expected_reason": attempt.get("expected_reason"),
        "matches_expected": outcome == attempt.get("expected_outcome")
        and (
            attempt.get("expected_reason") is None
            or attempt.get("expected_reason") in reasons
        ),
    }
    (output / "trajectory.json").write_text(
        json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {
        "schema_version": 1,
        "attempt_id": attempt["id"],
        "video": str(video_path),
        "route_id": calibration["route_id"],
        "window": {"start_s": start_s, "end_s": end_s},
        "source": {"width": width, "height": height, "fps": source_fps},
        "processing": {
            "model": str(model_path),
            "imgsz": imgsz,
            "target_fps": output_fps,
            "processed_frames": processed_frames,
            "pose_detection_rate": round(detected_frames / processed_frames, 4)
            if processed_frames
            else 0.0,
            "elapsed_s": round(elapsed_s, 3),
        },
        "result": {
            "outcome": outcome,
            "failure_reasons": reasons,
            "confidence": confidence,
            "requires_review": requires_review,
            "route_contact_ratio": round(route_contact_ratio, 4),
            "off_route_exposure_ratio": round(off_route_exposure_ratio, 4),
            "off_route_failure_threshold": off_route_failure_ratio,
            "started_at_s": round(started_at_s, 3) if started_at_s is not None else None,
            "finish_reached_at_s": round(finished_at_s, 3)
            if finished_at_s is not None
            else None,
            "fall_at_s": round(fall_at_s, 3) if fall_at_s is not None else None,
            "events": events,
        },
        "verification": verification,
        "limitations": [
            "Contacts are inferred from 2D keypoint proximity to color masks, not proven physical load.",
            "The current fixed-camera calibration is invalid after PTZ, zoom, or resolution changes.",
            "Low-confidence and off-route outcomes require human review in this POC.",
            "Automatic color candidates must be confirmed by a user before they become route truth.",
        ],
        "artifacts": {
            "annotated_video": str(output / "annotated.mp4"),
            "trajectory": str(output / "trajectory.json"),
            "reference": str(output / "reference.jpg"),
            "route_mask": str(output / "route-mask.png"),
            "forbidden_mask": str(output / "forbidden-mask.png"),
        },
    }


def read_reference(
    capture: cv2.VideoCapture,
    timestamp_s: float,
    reference_image_path: Path | None,
    width: int,
    height: int,
) -> np.ndarray:
    if reference_image_path is None:
        return read_frame_at(capture, timestamp_s)
    reference = cv2.imread(str(reference_image_path))
    if reference is None:
        raise RuntimeError(f"Could not read reference image: {reference_image_path}")
    if reference.shape[1] != width or reference.shape[0] != height:
        reference = cv2.resize(reference, (width, height), interpolation=cv2.INTER_AREA)
    return reference


def to_observation_analysis(
    result: dict[str, Any], model_path: Path, calibration: dict[str, Any]
) -> dict[str, Any]:
    analysis = result["result"]
    return {
        "schemaVersion": result["schema_version"],
        "attemptId": result["attempt_id"],
        "modelVersion": model_path.stem,
        "calibrationId": calibration["wall_id"],
        "outcome": analysis["outcome"],
        "failureReasons": analysis["failure_reasons"],
        "confidence": analysis["confidence"],
        "requiresReview": analysis["requires_review"],
        "startedAtS": analysis["started_at_s"],
        "finishReachedAtS": analysis["finish_reached_at_s"],
        "fallAtS": analysis["fall_at_s"],
        "events": [
            {
                "type": item["type"],
                "timestampS": item["timestamp_s"],
                "confidence": item["confidence"],
                "evidence": item["evidence"],
                **({"limb": item["limb"]} if "limb" in item else {}),
            }
            for item in analysis["events"]
        ],
    }


def read_frame_at(capture: cv2.VideoCapture, timestamp_s: float) -> np.ndarray:
    capture.set(cv2.CAP_PROP_POS_MSEC, timestamp_s * 1000.0)
    ok, frame = capture.read()
    if not ok:
        raise RuntimeError(f"Could not read reference frame at {timestamp_s}s")
    return frame


def build_hold_masks(
    reference: np.ndarray, calibration: dict[str, Any]
) -> tuple[np.ndarray, np.ndarray]:
    height, width = reference.shape[:2]
    if calibration.get("route_holds"):
        route_mask = holds_mask(reference, calibration["route_holds"])
        explicit_forbidden = holds_mask(reference, calibration.get("forbidden_holds", []))
        inferred_forbidden = infer_unconfigured_holds(reference, calibration)
        forbidden_source = cv2.bitwise_or(explicit_forbidden, inferred_forbidden)
        route_dilated = cv2.dilate(
            route_mask, np.ones((5, 5), dtype=np.uint8), iterations=1
        )
        return route_mask, cv2.bitwise_and(
            forbidden_source, cv2.bitwise_not(route_dilated)
        )
    wall_roi = Rect.from_list(calibration["wall_roi"])
    roi_mask = np.zeros((height, width), dtype=np.uint8)
    p1, p2 = wall_roi.pixel_points(width, height)
    cv2.rectangle(roi_mask, p1, p2, 255, -1)
    hsv = cv2.cvtColor(reference, cv2.COLOR_BGR2HSV)
    route_range = calibration["route_color_hsv"]
    hold_range = calibration["all_hold_hsv"]
    off_route_range = calibration.get("off_route_color_hsv")
    route_raw = cv2.inRange(
        hsv, np.array(route_range["lower"], dtype=np.uint8), np.array(route_range["upper"], dtype=np.uint8)
    )
    all_raw = cv2.inRange(
        hsv,
        np.array(hold_range["lower"], dtype=np.uint8),
        np.array(hold_range["upper"], dtype=np.uint8),
    )
    route_mask = filtered_components(cv2.bitwise_and(route_raw, roi_mask), 18, 9000)
    all_holds = filtered_components(cv2.bitwise_and(all_raw, roi_mask), 18, 12000)
    route_dilated = cv2.dilate(route_mask, np.ones((5, 5), dtype=np.uint8), iterations=1)
    if off_route_range:
        off_route_raw = cv2.inRange(
            hsv,
            np.array(off_route_range["lower"], dtype=np.uint8),
            np.array(off_route_range["upper"], dtype=np.uint8),
        )
        forbidden_source = filtered_components(
            cv2.bitwise_and(off_route_raw, roi_mask), 14, 12000
        )
    else:
        forbidden_source = all_holds
    forbidden_mask = cv2.bitwise_and(forbidden_source, cv2.bitwise_not(route_dilated))
    return route_mask, filtered_components(forbidden_mask, 14, 12000)


def holds_mask(reference: np.ndarray, holds: list[dict[str, Any]]) -> np.ndarray:
    height, width = reference.shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)
    for hold in holds:
        polygon = normalized_contour(hold.get("polygon"), width, height)
        if polygon is not None:
            cv2.fillPoly(mask, [polygon], 255)
            for hole in hold.get("holes", []):
                hole_contour = normalized_contour(hole, width, height)
                if hole_contour is not None:
                    cv2.fillPoly(mask, [hole_contour], 0)
            continue
        center = (round(float(hold["x"]) * width), round(float(hold["y"]) * height))
        axes = (
            max(2, round(float(hold["width"]) * width / 2)),
            max(2, round(float(hold["height"]) * height / 2)),
        )
        cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)
    return mask


def normalized_contour(
    points: Any, width: int, height: int
) -> np.ndarray | None:
    if not isinstance(points, list) or len(points) < 3:
        return None
    contour = np.array(
        [
            [
                round(float(point["x"]) * max(width - 1, 1)),
                round(float(point["y"]) * max(height - 1, 1)),
            ]
            for point in points
        ],
        dtype=np.int32,
    )
    return contour.reshape((-1, 1, 2))


def infer_unconfigured_holds(
    reference: np.ndarray, calibration: dict[str, Any]
) -> np.ndarray:
    """Find visually distinct colored and black holds on the known grey/white wall."""
    height, width = reference.shape[:2]
    roi = Rect.from_list(calibration["wall_roi"])
    roi_mask = np.zeros((height, width), dtype=np.uint8)
    p1, p2 = roi.pixel_points(width, height)
    cv2.rectangle(roi_mask, p1, p2, 255, -1)
    hsv = cv2.cvtColor(reference, cv2.COLOR_BGR2HSV)
    saturation_min = int(calibration.get("forbidden_saturation_min", 48))
    dark_value_max = int(calibration.get("forbidden_dark_value_max", 92))
    colored = cv2.inRange(
        hsv,
        np.array([0, saturation_min, 35], dtype=np.uint8),
        np.array([179, 255, 255], dtype=np.uint8),
    )
    dark = cv2.inRange(
        hsv,
        np.array([0, 0, 0], dtype=np.uint8),
        np.array([179, 255, dark_value_max], dtype=np.uint8),
    )
    candidates = cv2.bitwise_and(cv2.bitwise_or(colored, dark), roi_mask)
    return filtered_components(candidates, 14, 12000)


def landmark_distance(
    reference: np.ndarray, holds: list[dict[str, Any]]
) -> np.ndarray | None:
    if not holds:
        return None
    return distance_to_mask(holds_mask(reference, holds))


def point_hits_landmark(
    point: tuple[float, float],
    landmark_distance_map: np.ndarray | None,
    fallback_zones: list[Rect],
    width: int,
    height: int,
    tolerance_px: float,
) -> bool:
    if landmark_distance_map is None:
        return any(zone.contains(point) for zone in fallback_zones)
    pixel = (round(point[0] * width), round(point[1] * height))
    return sample_distance(landmark_distance_map, pixel) <= tolerance_px


def filtered_components(mask: np.ndarray, min_area: int, max_area: int) -> np.ndarray:
    opened = cv2.morphologyEx(
        mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    )
    count, labels, stats, _ = cv2.connectedComponentsWithStats(opened)
    result = np.zeros_like(mask)
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        width = int(stats[label, cv2.CC_STAT_WIDTH])
        height = int(stats[label, cv2.CC_STAT_HEIGHT])
        if min_area <= area <= max_area and width >= 4 and height >= 4:
            result[labels == label] = 255
    return result


def distance_to_mask(mask: np.ndarray) -> np.ndarray:
    return cv2.distanceTransform((mask == 0).astype(np.uint8), cv2.DIST_L2, 5)


def sample_distance(distance: np.ndarray, point: tuple[int, int]) -> float:
    x = max(0, min(distance.shape[1] - 1, point[0]))
    y = max(0, min(distance.shape[0] - 1, point[1]))
    return float(distance[y, x])


def select_climber(
    prediction: Any, roi: Rect, width: int, height: int
) -> int | None:
    if prediction.keypoints is None or len(prediction.keypoints.data) == 0:
        return None
    boxes = prediction.boxes.xyxy.cpu().numpy()
    candidates: list[tuple[float, int]] = []
    for index, box in enumerate(boxes):
        center = ((box[0] + box[2]) / (2 * width), (box[1] + box[3]) / (2 * height))
        if not roi.contains(center):
            continue
        area = float((box[2] - box[0]) * (box[3] - box[1]))
        candidates.append((area, index))
    return max(candidates)[1] if candidates else None


def resolve_limb_points(
    xy: np.ndarray,
    confidence: np.ndarray,
    threshold: float,
    hand_extension: float,
) -> dict[str, tuple[int, int]]:
    points: dict[str, tuple[int, int]] = {}
    for limb, (parent_index, endpoint_index) in LIMBS.items():
        if confidence[endpoint_index] < threshold:
            continue
        endpoint = xy[endpoint_index].astype(float)
        if parent_index is not None and confidence[parent_index] >= threshold:
            endpoint = endpoint + (endpoint - xy[parent_index]) * hand_extension
        points[limb] = (round(float(endpoint[0])), round(float(endpoint[1])))
    return points


def mean_visible_y(
    xy: np.ndarray,
    confidence: np.ndarray,
    indices: tuple[int, ...],
    threshold: float,
    frame_height: int,
) -> float | None:
    values = [float(xy[index][1]) for index in indices if confidence[index] >= threshold]
    if not values:
        return None
    return float(np.mean(values) / max(frame_height, 1))


def update_dwell_candidate(
    candidate_at: float | None, active: bool, timestamp_s: float
) -> float | None:
    if not active:
        return None
    return timestamp_s if candidate_at is None else candidate_at


def event(
    event_type: str,
    timestamp_s: float,
    evidence: str,
    confidence: float,
    **metadata: Any,
) -> dict[str, Any]:
    return {
        "type": event_type,
        "timestamp_s": round(timestamp_s, 3),
        "confidence": round(confidence, 3),
        "evidence": evidence,
        **metadata,
    }


def result_confidence(outcome: str, events: list[dict[str, Any]]) -> float:
    relevant = [
        item["confidence"]
        for item in events
        if item["type"] in {"STARTED", "FINISH_REACHED", "FALL_BEFORE_FINISH", "OFF_ROUTE_CONTACT"}
    ]
    if not relevant:
        return 0.2
    base = float(np.mean(relevant))
    if outcome == "UNKNOWN":
        base = min(base, 0.4)
    if any(item["type"] == "OFF_ROUTE_CONTACT" for item in events):
        base = min(base, 0.68)
    return round(base, 3)


def draw_pose(
    frame: np.ndarray, xy: np.ndarray, confidence: np.ndarray, threshold: float
) -> None:
    for start, end in POSE_CONNECTIONS:
        if confidence[start] < threshold or confidence[end] < threshold:
            continue
        cv2.line(
            frame,
            tuple(xy[start].astype(int)),
            tuple(xy[end].astype(int)),
            (80, 210, 255),
            2,
            cv2.LINE_AA,
        )


def draw_analysis_overlay(
    frame: np.ndarray,
    route_mask: np.ndarray,
    forbidden_mask: np.ndarray,
    climber_roi: Rect,
    start_zones: list[Rect],
    finish_zones: list[Rect],
    limb_points: dict[str, tuple[int, int]],
    limb_contacts: dict[str, str],
    state: str,
    timestamp_s: float,
) -> None:
    height, width = frame.shape[:2]
    overlay = frame.copy()
    overlay[route_mask > 0] = (0, 230, 255)
    overlay[forbidden_mask > 0] = (210, 90, 255)
    cv2.addWeighted(overlay, 0.2, frame, 0.8, 0, frame)
    draw_rect(frame, climber_roi, "CLIMBER ROI", (160, 160, 160), width, height)
    for zone in start_zones:
        draw_rect(frame, zone, "START", (0, 190, 255), width, height)
    for finish_zone in finish_zones:
        draw_rect(frame, finish_zone, "FINISH", (0, 230, 80), width, height)
    for limb, point in limb_points.items():
        contact = limb_contacts.get(limb, "NONE")
        color = (0, 230, 255) if contact == "ROUTE" else (40, 40, 255) if contact == "OFF_ROUTE" else (255, 255, 255)
        cv2.circle(frame, point, 7, color, -1, cv2.LINE_AA)
        cv2.putText(frame, limb.replace("_", " "), (point[0] + 7, point[1] - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.34, color, 1, cv2.LINE_AA)
    cv2.rectangle(frame, (10, 10), (370, 68), (5, 12, 10), -1)
    cv2.putText(frame, f"STATE: {state}", (22, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.64, (220, 245, 109), 2, cv2.LINE_AA)
    cv2.putText(frame, f"t={timestamp_s:06.2f}s", (22, 58), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 1, cv2.LINE_AA)


def draw_rect(
    frame: np.ndarray,
    rect: Rect,
    label: str,
    color: tuple[int, int, int],
    width: int,
    height: int,
) -> None:
    p1, p2 = rect.pixel_points(width, height)
    cv2.rectangle(frame, p1, p2, color, 1)
    cv2.putText(frame, label, (p1[0] + 3, max(15, p1[1] - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.36, color, 1, cv2.LINE_AA)


if __name__ == "__main__":
    main()

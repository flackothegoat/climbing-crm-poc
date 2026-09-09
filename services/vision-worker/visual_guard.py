from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np


CORE_KEYPOINTS = (5, 6, 11, 12)
LOWER_BODY_KEYPOINTS = (13, 14, 15, 16)

REASON_LABELS = {
    "TOO_DARK": "画面过暗",
    "EXCESSIVE_DARKNESS": "暗部过多",
    "EXCESSIVE_GLARE": "强光过曝",
    "INSUFFICIENT_CONTRAST": "画面对比度不足",
    "REFERENCE_SCENE_MISMATCH": "当前画面与无人墙面基准差异过大",
}


@dataclass(frozen=True)
class GuardResult:
    accepted: bool
    reasons: tuple[str, ...]
    metrics: dict[str, float | int]


def describe_guard_reasons(reasons: tuple[str, ...]) -> str:
    return "、".join(REASON_LABELS.get(reason, reason) for reason in reasons)


def assess_image_quality(
    frame: np.ndarray,
    roi: Any,
    *,
    min_mean_luma: float,
    max_dark_ratio: float,
    max_bright_ratio: float,
    min_luma_std: float,
) -> GuardResult:
    crop = crop_normalized(frame, roi)
    if crop.size == 0:
        return GuardResult(False, ("EMPTY_ROI",), {})

    luma = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    mean_luma = float(np.mean(luma))
    luma_std = float(np.std(luma))
    dark_ratio = float(np.mean(luma <= 32))
    bright_ratio = float(np.mean(luma >= 245))
    reasons: list[str] = []
    if mean_luma < min_mean_luma:
        reasons.append("TOO_DARK")
    if dark_ratio > max_dark_ratio:
        reasons.append("EXCESSIVE_DARKNESS")
    if bright_ratio > max_bright_ratio:
        reasons.append("EXCESSIVE_GLARE")
    if luma_std < min_luma_std:
        reasons.append("INSUFFICIENT_CONTRAST")
    return GuardResult(
        not reasons,
        tuple(reasons),
        {
            "mean_luma": round(mean_luma, 3),
            "luma_std": round(luma_std, 3),
            "dark_ratio": round(dark_ratio, 4),
            "bright_ratio": round(bright_ratio, 4),
        },
    )


def assess_pose_candidate(
    prediction: Any,
    person_index: int,
    width: int,
    height: int,
    *,
    detection_confidence_threshold: float,
    visibility_threshold: float,
    min_visible_body_keypoints: int,
    min_visible_core_keypoints: int,
    min_visible_lower_body_keypoints: int,
    min_box_area_ratio: float,
    max_box_area_ratio: float,
    min_box_height_ratio: float,
) -> GuardResult:
    box = prediction.boxes.xyxy.cpu().numpy()[person_index]
    box_width = max(0.0, float(box[2] - box[0]))
    box_height = max(0.0, float(box[3] - box[1]))
    frame_area = max(float(width * height), 1.0)
    area_ratio = box_width * box_height / frame_area
    height_ratio = box_height / max(float(height), 1.0)
    detection_confidence = prediction_box_confidence(prediction, person_index)

    confidence = prediction.keypoints.conf[person_index].cpu().numpy()
    visible = confidence >= visibility_threshold
    visible_body = int(np.count_nonzero(visible))
    visible_core = int(np.count_nonzero(visible[list(CORE_KEYPOINTS)]))
    visible_lower = int(np.count_nonzero(visible[list(LOWER_BODY_KEYPOINTS)]))

    reasons: list[str] = []
    if detection_confidence < detection_confidence_threshold:
        reasons.append("LOW_DETECTION_CONFIDENCE")
    if visible_body < min_visible_body_keypoints:
        reasons.append("INCOMPLETE_BODY")
    if visible_core < min_visible_core_keypoints:
        reasons.append("INCOMPLETE_TORSO")
    if visible_lower < min_visible_lower_body_keypoints:
        reasons.append("INCOMPLETE_LOWER_BODY")
    if area_ratio < min_box_area_ratio:
        reasons.append("PERSON_TOO_SMALL")
    if area_ratio > max_box_area_ratio:
        reasons.append("PERSON_BOX_TOO_LARGE")
    if height_ratio < min_box_height_ratio:
        reasons.append("PERSON_TOO_SHORT")

    return GuardResult(
        not reasons,
        tuple(reasons),
        {
            "detection_confidence": round(detection_confidence, 4),
            "visible_body_keypoints": visible_body,
            "visible_core_keypoints": visible_core,
            "visible_lower_body_keypoints": visible_lower,
            "box_area_ratio": round(area_ratio, 4),
            "box_height_ratio": round(height_ratio, 4),
        },
    )


def assess_foreground_presence(
    frame: np.ndarray,
    reference: np.ndarray | None,
    normalized_box: tuple[float, float, float, float],
    *,
    difference_threshold: int,
    min_changed_ratio: float,
    max_changed_ratio: float,
    min_component_ratio: float,
) -> GuardResult:
    if reference is None:
        return GuardResult(False, ("REFERENCE_MISSING",), {})
    if reference.shape[:2] != frame.shape[:2]:
        reference = cv2.resize(
            reference, (frame.shape[1], frame.shape[0]), interpolation=cv2.INTER_AREA
        )

    current_crop = crop_normalized(frame, normalized_box)
    reference_crop = crop_normalized(reference, normalized_box)
    if current_crop.size == 0 or reference_crop.size == 0:
        return GuardResult(False, ("EMPTY_PERSON_BOX",), {})

    current_blurred = cv2.GaussianBlur(current_crop, (5, 5), 0)
    reference_blurred = cv2.GaussianBlur(reference_crop, (5, 5), 0)
    difference = np.max(
        cv2.absdiff(current_blurred, reference_blurred), axis=2
    )
    changed = (difference >= difference_threshold).astype(np.uint8) * 255
    changed = cv2.morphologyEx(
        changed,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
    )
    changed = cv2.morphologyEx(
        changed,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
    )
    changed_ratio = float(np.mean(changed > 0))
    component_ratio = largest_component_ratio(changed)
    reasons: list[str] = []
    if changed_ratio < min_changed_ratio or component_ratio < min_component_ratio:
        reasons.append("NO_FOREGROUND_PERSON")
    if changed_ratio > max_changed_ratio:
        reasons.append("REFERENCE_SCENE_MISMATCH")
    return GuardResult(
        not reasons,
        tuple(reasons),
        {
            "foreground_changed_ratio": round(changed_ratio, 4),
            "foreground_component_ratio": round(component_ratio, 4),
        },
    )


def prediction_box_confidence(prediction: Any, person_index: int) -> float:
    confidence = getattr(prediction.boxes, "conf", None)
    if confidence is None:
        return 1.0
    value = confidence[person_index]
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "numpy"):
        value = value.numpy()
    return float(np.asarray(value).reshape(-1)[0])


def crop_normalized(frame: np.ndarray, roi: Any) -> np.ndarray:
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = normalized_bounds(roi)
    left = max(0, min(width, round(x1 * width)))
    top = max(0, min(height, round(y1 * height)))
    right = max(left, min(width, round(x2 * width)))
    bottom = max(top, min(height, round(y2 * height)))
    return frame[top:bottom, left:right]


def normalized_bounds(roi: Any) -> tuple[float, float, float, float]:
    if all(hasattr(roi, name) for name in ("x1", "y1", "x2", "y2")):
        return float(roi.x1), float(roi.y1), float(roi.x2), float(roi.y2)
    values = tuple(float(value) for value in roi)
    if len(values) != 4:
        raise ValueError("normalized ROI must contain four values")
    return values  # type: ignore[return-value]


def largest_component_ratio(mask: np.ndarray) -> float:
    if mask.size == 0:
        return 0.0
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    if count <= 1:
        return 0.0
    largest = int(np.max(stats[1:, cv2.CC_STAT_AREA]))
    return largest / float(mask.shape[0] * mask.shape[1])

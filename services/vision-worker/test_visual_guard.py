from __future__ import annotations

import unittest

import cv2
import numpy as np

from visual_guard import (
    assess_foreground_presence,
    assess_image_quality,
    assess_pose_candidate,
)


class FakeTensor:
    def __init__(self, value: np.ndarray) -> None:
        self.value = value

    def __getitem__(self, index: int) -> "FakeTensor":
        return FakeTensor(np.asarray(self.value[index]))

    def cpu(self) -> "FakeTensor":
        return self

    def numpy(self) -> np.ndarray:
        return self.value


class FakeBoxes:
    def __init__(self, box: np.ndarray, confidence: float) -> None:
        self.xyxy = FakeTensor(np.array([box], dtype=float))
        self.conf = FakeTensor(np.array([confidence], dtype=float))


class FakeKeypoints:
    def __init__(self, confidence: np.ndarray) -> None:
        self.conf = FakeTensor(np.array([confidence], dtype=float))


class FakePrediction:
    def __init__(self, confidence: float, keypoints: np.ndarray) -> None:
        self.boxes = FakeBoxes(np.array([20, 10, 80, 95], dtype=float), confidence)
        self.keypoints = FakeKeypoints(keypoints)


class VisualGuardTest(unittest.TestCase):
    def test_rejects_dark_frame_before_pose_inference(self) -> None:
        frame = np.full((100, 100, 3), 12, dtype=np.uint8)

        result = assess_image_quality(
            frame,
            (0, 0, 1, 1),
            min_mean_luma=42,
            max_dark_ratio=0.72,
            max_bright_ratio=0.28,
            min_luma_std=12,
        )

        self.assertFalse(result.accepted)
        self.assertIn("TOO_DARK", result.reasons)
        self.assertIn("EXCESSIVE_DARKNESS", result.reasons)

    def test_rejects_pose_hallucination_without_complete_body(self) -> None:
        keypoints = np.full(17, 0.1, dtype=float)
        keypoints[9] = 0.9
        keypoints[10] = 0.9
        prediction = FakePrediction(0.91, keypoints)

        result = assess_pose_candidate(
            prediction,
            0,
            100,
            100,
            detection_confidence_threshold=0.45,
            visibility_threshold=0.45,
            min_visible_body_keypoints=8,
            min_visible_core_keypoints=3,
            min_visible_lower_body_keypoints=2,
            min_box_area_ratio=0.012,
            max_box_area_ratio=0.55,
            min_box_height_ratio=0.16,
        )

        self.assertFalse(result.accepted)
        self.assertIn("INCOMPLETE_BODY", result.reasons)
        self.assertIn("INCOMPLETE_TORSO", result.reasons)

    def test_rejects_static_wall_even_when_pose_model_claims_a_person(self) -> None:
        reference = textured_wall()
        frame = reference.copy()

        result = assess_foreground_presence(
            frame,
            reference,
            (0.1, 0.1, 0.9, 0.9),
            difference_threshold=28,
            min_changed_ratio=0.04,
            max_changed_ratio=0.68,
            min_component_ratio=0.02,
        )

        self.assertFalse(result.accepted)
        self.assertIn("NO_FOREGROUND_PERSON", result.reasons)

    def test_accepts_connected_person_sized_foreground(self) -> None:
        reference = textured_wall()
        frame = reference.copy()
        cv2.rectangle(frame, (35, 18), (65, 88), (30, 40, 50), -1)

        result = assess_foreground_presence(
            frame,
            reference,
            (0.2, 0.1, 0.8, 0.95),
            difference_threshold=28,
            min_changed_ratio=0.04,
            max_changed_ratio=0.68,
            min_component_ratio=0.02,
        )

        self.assertTrue(result.accepted)
        self.assertGreater(result.metrics["foreground_component_ratio"], 0.02)

    def test_rejects_whole_scene_lighting_change_as_stale_reference(self) -> None:
        reference = textured_wall()
        frame = np.clip(reference.astype(np.int16) - 90, 0, 255).astype(np.uint8)

        result = assess_foreground_presence(
            frame,
            reference,
            (0.1, 0.1, 0.9, 0.9),
            difference_threshold=28,
            min_changed_ratio=0.04,
            max_changed_ratio=0.68,
            min_component_ratio=0.02,
        )

        self.assertFalse(result.accepted)
        self.assertIn("REFERENCE_SCENE_MISMATCH", result.reasons)


def textured_wall() -> np.ndarray:
    x = np.linspace(90, 180, 100, dtype=np.uint8)
    plane = np.tile(x, (100, 1))
    return cv2.merge((plane, plane, plane))


if __name__ == "__main__":
    unittest.main()

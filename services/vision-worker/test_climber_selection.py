from __future__ import annotations

import unittest

import numpy as np

from analyze_climb_video import Rect, select_climber


class FakeTensor:
    def __init__(self, value: np.ndarray) -> None:
        self.value = value

    def __getitem__(self, index: int) -> "FakeTensor":
        return FakeTensor(self.value[index])

    def __len__(self) -> int:
        return len(self.value)

    def cpu(self) -> "FakeTensor":
        return self

    def numpy(self) -> np.ndarray:
        return self.value


class FakeKeypoints:
    def __init__(self, xy: np.ndarray, confidence: np.ndarray) -> None:
        self.data = FakeTensor(xy)
        self.xy = FakeTensor(xy)
        self.conf = FakeTensor(confidence)


class FakeBoxes:
    def __init__(self, boxes: np.ndarray) -> None:
        self.xyxy = FakeTensor(boxes)


class FakePrediction:
    def __init__(
        self, boxes: np.ndarray, xy: np.ndarray, confidence: np.ndarray
    ) -> None:
        self.boxes = FakeBoxes(boxes)
        self.keypoints = FakeKeypoints(xy, confidence)


class ClimberSelectionTest(unittest.TestCase):
    def prediction(self) -> FakePrediction:
        boxes = np.array(
            [
                [10, 10, 40, 90],
                [45, 5, 98, 98],
            ],
            dtype=float,
        )
        xy = np.zeros((2, 17, 2), dtype=float)
        xy[0, 9] = [20, 80]
        xy[0, 10] = [22, 82]
        xy[1, 9] = [70, 50]
        xy[1, 10] = [75, 50]
        confidence = np.full((2, 17), 0.9, dtype=float)
        return FakePrediction(boxes, xy, confidence)

    def test_start_pose_beats_a_larger_bystander(self) -> None:
        selected = select_climber(
            self.prediction(),
            Rect(0, 0, 1, 1),
            100,
            100,
            start_zones=[Rect(0.15, 0.75, 0.25, 0.85)],
        )

        self.assertEqual(selected, 0)

    def test_locked_track_is_not_replaced_by_larger_person(self) -> None:
        selected = select_climber(
            self.prediction(),
            Rect(0, 0, 1, 1),
            100,
            100,
            tracked_box=(0.1, 0.1, 0.4, 0.9),
        )

        self.assertEqual(selected, 0)

    def test_track_loss_returns_none_instead_of_switching_person(self) -> None:
        selected = select_climber(
            self.prediction(),
            Rect(0, 0, 1, 1),
            100,
            100,
            tracked_box=(0.0, 0.0, 0.05, 0.05),
            track_max_center_distance=0.05,
        )

        self.assertIsNone(selected)


if __name__ == "__main__":
    unittest.main()

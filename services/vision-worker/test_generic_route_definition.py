import unittest

import numpy as np

from analyze_climb_video import build_hold_masks, holds_mask
from live_stream_worker import calibration_from_definition


class GenericRouteDefinitionTest(unittest.TestCase):
    def test_definition_builds_route_and_forbidden_masks(self) -> None:
        base = {
            "wall_id": "base",
            "route_id": "base",
            "finish_zone": {"rect": [0.7, 0.1, 0.8, 0.2]},
        }
        route_holds = [
            {
                "id": "start",
                "x": 0.2,
                "y": 0.8,
                "width": 0.1,
                "height": 0.1,
                "colorHex": "#F0C020",
                "colorCluster": "hue-1",
            },
            {
                "id": "finish",
                "x": 0.7,
                "y": 0.2,
                "width": 0.1,
                "height": 0.1,
                "colorHex": "#F0C020",
                "colorCluster": "hue-1",
            },
        ]
        other = {
            "id": "other",
            "x": 0.5,
            "y": 0.5,
            "width": 0.1,
            "height": 0.1,
            "colorHex": "#8B45C7",
            "colorCluster": "hue-9",
        }
        definition = {
            "id": "definition-1",
            "cameraKey": "gym-wall-primary",
            "revision": 1,
            "route": {"id": "route-1", "code": "R1"},
            "routeVersion": {"id": "version-1"},
            "wallSegment": {"id": "wall-1"},
            "roi": {"x1": 0.1, "y1": 0.1, "x2": 0.9, "y2": 0.9},
            "holds": route_holds,
            "startHoldIds": ["start"],
            "finishHoldIds": ["finish"],
        }
        calibration = calibration_from_definition(
            base, definition, [*route_holds, other]
        )
        route_mask, forbidden_mask = build_hold_masks(
            np.zeros((100, 100, 3), dtype=np.uint8), calibration
        )

        self.assertGreater(route_mask[80, 20], 0)
        self.assertGreater(route_mask[20, 70], 0)
        self.assertEqual(route_mask[50, 50], 0)
        self.assertGreater(forbidden_mask[50, 50], 0)
        self.assertEqual(len(calibration["start_zones"]), 1)
        self.assertEqual(len(calibration["finish_zones"]), 1)
        self.assertEqual([item["id"] for item in calibration["start_holds"]], ["start"])
        self.assertEqual([item["id"] for item in calibration["finish_holds"]], ["finish"])

    def test_polygon_and_hole_are_preserved_in_worker_mask(self) -> None:
        hold = {
            "id": "hold-1",
            "x": 0.5,
            "y": 0.5,
            "width": 0.8,
            "height": 0.8,
            "polygon": [
                {"x": 0.2, "y": 0.2},
                {"x": 0.8, "y": 0.2},
                {"x": 0.5, "y": 0.8},
            ],
            "holes": [
                [
                    {"x": 0.45, "y": 0.4},
                    {"x": 0.55, "y": 0.4},
                    {"x": 0.5, "y": 0.55},
                ]
            ],
        }
        mask = holds_mask(np.zeros((100, 100, 3), dtype=np.uint8), [hold])
        self.assertGreater(mask[30, 50], 0)
        self.assertEqual(mask[45, 50], 0)
        self.assertEqual(mask[75, 20], 0)


if __name__ == "__main__":
    unittest.main()

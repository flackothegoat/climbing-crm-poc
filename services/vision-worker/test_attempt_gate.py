from __future__ import annotations

import unittest

from attempt_gate import (
    CLIMBING,
    START_CANDIDATE,
    WAITING_FOR_START,
    AttemptGate,
    AttemptGateConfig,
    AttemptSignal,
)


class AttemptGateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.gate = AttemptGate(
            AttemptGateConfig(
                start_dwell_s=0.8,
                confirmation_window_s=5.0,
                min_hip_rise=0.055,
                track_loss_tolerance_s=0.5,
            )
        )

    def signal(
        self,
        timestamp_s: float,
        *,
        hands: bool = True,
        hip_y: float = 0.8,
        foot: bool = False,
        progress: bool = False,
    ) -> AttemptSignal:
        return AttemptSignal(
            timestamp_s=timestamp_s,
            track_present=True,
            both_hands_at_start=hands,
            torso_on_wall=True,
            hip_y=hip_y,
            foot_on_route=foot,
            progress_hold_reached=progress,
        )

    def test_standing_gesture_never_becomes_a_climb(self) -> None:
        self.gate.update(self.signal(0.0))
        dwell = self.gate.update(self.signal(0.8))
        self.assertEqual(dwell.state, START_CANDIDATE)

        for timestamp_s in (1.5, 2.5, 4.0):
            decision = self.gate.update(
                self.signal(timestamp_s, hands=False, hip_y=0.79)
            )
            self.assertFalse(decision.confirmed_now)

        expired = self.gate.update(self.signal(5.1, hands=False, hip_y=0.79))
        self.assertTrue(expired.reset_now)
        self.assertEqual(expired.state, WAITING_FOR_START)

    def test_confirms_same_person_after_support_rise_and_progress(self) -> None:
        self.gate.update(self.signal(0.0))
        dwell = self.gate.update(self.signal(0.8, foot=True))
        self.assertEqual(dwell.state, START_CANDIDATE)

        confirmed = self.gate.update(
            self.signal(1.5, hands=False, hip_y=0.73, progress=True)
        )

        self.assertTrue(confirmed.confirmed_now)
        self.assertEqual(confirmed.state, CLIMBING)
        self.assertEqual(confirmed.started_at_s, 0.0)
        self.assertAlmostEqual(confirmed.hip_rise, 0.07)

    def test_progress_without_foot_support_is_not_enough(self) -> None:
        self.gate.update(self.signal(0.0))
        self.gate.update(self.signal(0.8))

        decision = self.gate.update(
            self.signal(1.5, hands=False, hip_y=0.72, progress=True)
        )

        self.assertFalse(decision.confirmed_now)
        self.assertEqual(decision.state, START_CANDIDATE)

    def test_lost_person_resets_candidate_instead_of_switching_tracks(self) -> None:
        self.gate.update(self.signal(0.0))
        self.gate.update(self.signal(0.8, foot=True))

        self.gate.update(AttemptSignal(timestamp_s=1.0, track_present=False))
        lost = self.gate.update(AttemptSignal(timestamp_s=1.6, track_present=False))

        self.assertTrue(lost.reset_now)
        self.assertEqual(lost.state, WAITING_FOR_START)


if __name__ == "__main__":
    unittest.main()

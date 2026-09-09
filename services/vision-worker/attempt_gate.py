from __future__ import annotations

from dataclasses import dataclass


WAITING_FOR_START = "WAITING_FOR_START"
START_CANDIDATE = "START_CANDIDATE"
CLIMBING = "CLIMBING"


@dataclass(frozen=True)
class AttemptGateConfig:
    start_dwell_s: float
    confirmation_window_s: float
    min_hip_rise: float
    track_loss_tolerance_s: float


@dataclass(frozen=True)
class AttemptSignal:
    timestamp_s: float
    track_present: bool
    both_hands_at_start: bool = False
    torso_on_wall: bool = False
    hip_y: float | None = None
    foot_on_route: bool = False
    progress_hold_reached: bool = False


@dataclass(frozen=True)
class GateDecision:
    state: str
    started_at_s: float | None = None
    confirmed_now: bool = False
    reset_now: bool = False
    hip_rise: float = 0.0


class AttemptGate:
    """Confirm a climb only after a stable start develops into upward movement."""

    def __init__(self, config: AttemptGateConfig) -> None:
        self.config = config
        self.state = WAITING_FOR_START
        self.candidate_at_s: float | None = None
        self.start_pose_confirmed_at_s: float | None = None
        self.baseline_hip_y: float | None = None
        self.minimum_hip_y: float | None = None
        self.track_missing_at_s: float | None = None
        self.foot_support_seen = False
        self.progress_seen = False

    @property
    def engaged(self) -> bool:
        return self.candidate_at_s is not None

    def update(self, signal: AttemptSignal) -> GateDecision:
        if self.state == CLIMBING:
            return self._decision()

        if not signal.track_present:
            return self._handle_missing_track(signal.timestamp_s)

        self.track_missing_at_s = None
        if not self.engaged:
            if not self._valid_start_pose(signal):
                return self._decision()
            self._begin_candidate(signal)
            return self._decision()

        assert self.candidate_at_s is not None

        if self.start_pose_confirmed_at_s is None:
            if not self._valid_start_pose(signal):
                return self._reset_decision()
            self._update_start_evidence(signal)
            if signal.timestamp_s - self.candidate_at_s >= self.config.start_dwell_s:
                self.start_pose_confirmed_at_s = signal.timestamp_s
                self.state = START_CANDIDATE
        else:
            self._update_progress_evidence(signal)

        if signal.timestamp_s - self.candidate_at_s > self.config.confirmation_window_s:
            return self._reset_decision()

        hip_rise = self._hip_rise()
        if (
            self.state == START_CANDIDATE
            and hip_rise >= self.config.min_hip_rise
            and self.foot_support_seen
            and self.progress_seen
        ):
            started_at_s = self.candidate_at_s
            self.state = CLIMBING
            return GateDecision(
                state=self.state,
                started_at_s=started_at_s,
                confirmed_now=True,
                hip_rise=hip_rise,
            )

        return self._decision()

    def _valid_start_pose(self, signal: AttemptSignal) -> bool:
        return (
            signal.both_hands_at_start
            and signal.torso_on_wall
            and signal.hip_y is not None
        )

    def _begin_candidate(self, signal: AttemptSignal) -> None:
        assert signal.hip_y is not None
        self.candidate_at_s = signal.timestamp_s
        self.baseline_hip_y = signal.hip_y
        self.minimum_hip_y = signal.hip_y
        self._update_start_evidence(signal)

    def _update_start_evidence(self, signal: AttemptSignal) -> None:
        if signal.hip_y is not None:
            if self.baseline_hip_y is None:
                self.baseline_hip_y = signal.hip_y
            else:
                self.baseline_hip_y = max(self.baseline_hip_y, signal.hip_y)
            if self.minimum_hip_y is None:
                self.minimum_hip_y = signal.hip_y
            else:
                self.minimum_hip_y = min(self.minimum_hip_y, signal.hip_y)
        self.foot_support_seen = self.foot_support_seen or signal.foot_on_route

    def _update_progress_evidence(self, signal: AttemptSignal) -> None:
        if signal.hip_y is not None:
            if self.minimum_hip_y is None:
                self.minimum_hip_y = signal.hip_y
            else:
                self.minimum_hip_y = min(self.minimum_hip_y, signal.hip_y)
        self.foot_support_seen = self.foot_support_seen or signal.foot_on_route
        self.progress_seen = self.progress_seen or signal.progress_hold_reached

    def _handle_missing_track(self, timestamp_s: float) -> GateDecision:
        if not self.engaged:
            return self._decision()
        if self.track_missing_at_s is None:
            self.track_missing_at_s = timestamp_s
        if timestamp_s - self.track_missing_at_s > self.config.track_loss_tolerance_s:
            return self._reset_decision()
        return self._decision()

    def _hip_rise(self) -> float:
        if self.baseline_hip_y is None or self.minimum_hip_y is None:
            return 0.0
        return max(0.0, self.baseline_hip_y - self.minimum_hip_y)

    def _decision(self) -> GateDecision:
        return GateDecision(state=self.state, hip_rise=self._hip_rise())

    def _reset_decision(self) -> GateDecision:
        self.state = WAITING_FOR_START
        self.candidate_at_s = None
        self.start_pose_confirmed_at_s = None
        self.baseline_hip_y = None
        self.minimum_hip_y = None
        self.track_missing_at_s = None
        self.foot_support_seen = False
        self.progress_seen = False
        return GateDecision(state=self.state, reset_now=True)

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import worker_healthcheck


class WorkerHealthcheckTest(unittest.TestCase):
    def status(self, payload: dict[str, object]) -> int:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "status.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with patch.object(worker_healthcheck.sys, "argv", ["healthcheck", str(path)]):
                return worker_healthcheck.main()

    def test_accepts_fresh_online_status_with_routes(self) -> None:
        self.assertEqual(
            self.status(
                {
                    "status": "ONLINE",
                    "detail": "等待攀爬者进入",
                    "routeDefinitionCount": 1,
                    "checkedAt": datetime.now(timezone.utc).isoformat(),
                }
            ),
            0,
        )

    def test_rejects_offline_stale_or_unconfigured_status(self) -> None:
        now = datetime.now(timezone.utc)
        cases = [
            {"status": "OFFLINE", "routeDefinitionCount": 1, "checkedAt": now.isoformat()},
            {
                "status": "ONLINE",
                "routeDefinitionCount": 1,
                "checkedAt": (now - timedelta(minutes=2)).isoformat(),
            },
            {"status": "ONLINE", "routeDefinitionCount": 0, "checkedAt": now.isoformat()},
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                self.assertEqual(self.status(payload), 1)


if __name__ == "__main__":
    unittest.main()

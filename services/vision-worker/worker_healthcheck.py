from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


MAX_HEARTBEAT_AGE_SECONDS = 30


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "output/live-worker/status.json")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        checked_at = datetime.fromisoformat(str(payload["checkedAt"]).replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - checked_at.astimezone(timezone.utc)).total_seconds()
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"invalid worker status: {error}")
        return 1
    if payload.get("status") != "ONLINE":
        print(f"worker is {payload.get('status', 'UNKNOWN')}: {payload.get('detail', '')}")
        return 1
    if age < 0 or age > MAX_HEARTBEAT_AGE_SECONDS:
        print(f"worker heartbeat is stale: {age:.1f}s")
        return 1
    if int(payload.get("routeDefinitionCount", 0)) < 1:
        print("worker has no published route definitions")
        return 1
    print(
        f"worker online; routes={payload['routeDefinitionCount']}; heartbeat={age:.1f}s"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Thread-safe in-process state for the local LiDAR Ink Studio server."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock, RLock
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_workspace() -> dict[str, Any]:
    return {
        "project": {"name": None},
        "scene": {"loaded": False, "name": None},
        "scan": {"status": "idle", "scan_id": None},
    }


class StudioState:
    """Single-user local application state with a reusable operation gate.

    The operation gate is intentionally separate from the state lock. Short state
    reads/writes can continue while a future expensive operation (for example a
    LiDAR scan) owns the operation gate.
    """

    def __init__(self) -> None:
        now = _utc_now()
        self._state_lock = RLock()
        self._operation_lock = Lock()
        self._active_operation: str | None = None
        self._started_at = now
        self._updated_at = now
        self._revision = 0
        self._reset_count = 0
        self._workspace = _empty_workspace()

    def snapshot(self) -> dict[str, Any]:
        with self._state_lock:
            return {
                "revision": self._revision,
                "reset_count": self._reset_count,
                "started_at": self._started_at,
                "updated_at": self._updated_at,
                "busy": self._active_operation is not None,
                "active_operation": self._active_operation,
                "workspace": deepcopy(self._workspace),
            }

    def reset(self) -> dict[str, Any]:
        with self._state_lock:
            self._workspace = _empty_workspace()
            self._revision += 1
            self._reset_count += 1
            self._updated_at = _utc_now()
            return self.snapshot()

    def try_begin_operation(self, name: str) -> bool:
        if not self._operation_lock.acquire(blocking=False):
            return False
        with self._state_lock:
            self._active_operation = name
            self._updated_at = _utc_now()
        return True

    def end_operation(self) -> None:
        with self._state_lock:
            self._active_operation = None
            self._updated_at = _utc_now()
        self._operation_lock.release()

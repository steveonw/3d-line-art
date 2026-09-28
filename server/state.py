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
    """Single-user local application state with a reusable operation gate."""

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

        # Runtime-only objects stay outside the JSON snapshot.
        self._scene_object: Any = None
        self._scan_metadata: dict[str, Any] | None = None
        self._scan_channels: dict[str, bytes] = {}

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
            self._scene_object = None
            self._scan_metadata = None
            self._scan_channels = {}
            self._revision += 1
            self._reset_count += 1
            self._updated_at = _utc_now()
            return self.snapshot()

    def set_scene(self, scene_object: Any, info: dict[str, Any]) -> dict[str, Any]:
        with self._state_lock:
            self._scene_object = scene_object
            self._scan_metadata = None
            self._scan_channels = {}
            self._workspace["scene"] = {"loaded": True, **deepcopy(info)}
            self._workspace["scan"] = {"status": "idle", "scan_id": None}
            self._revision += 1
            self._updated_at = _utc_now()
            return deepcopy(self._workspace["scene"])

    def get_scene_object(self) -> Any:
        with self._state_lock:
            return self._scene_object

    def set_scan(
        self,
        scan_id: str,
        metadata: dict[str, Any],
        channels: dict[str, bytes],
    ) -> dict[str, Any]:
        with self._state_lock:
            self._scan_metadata = deepcopy(metadata)
            self._scan_channels = dict(channels)
            self._workspace["scan"] = {
                "status": "ready",
                "scan_id": scan_id,
                "width": metadata.get("width"),
                "height": metadata.get("height"),
                "coverage": metadata.get("coverage"),
            }
            self._revision += 1
            self._updated_at = _utc_now()
            return deepcopy(self._workspace["scan"])

    def get_scan(self) -> dict[str, Any] | None:
        with self._state_lock:
            if self._scan_metadata is None:
                return None
            return {
                "metadata": deepcopy(self._scan_metadata),
                "channels": tuple(self._scan_channels.keys()),
            }

    def get_scan_channel(self, name: str) -> bytes | None:
        with self._state_lock:
            return self._scan_channels.get(name)

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

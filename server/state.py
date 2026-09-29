"""Thread-safe in-process state for the local LiDAR Ink Studio server."""

from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock, RLock
from typing import Any


DEFAULT_SCAN_CACHE_LIMIT_BYTES = 256 * 1024 * 1024
DEFAULT_SCAN_CACHE_MAX_ENTRIES = 16


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

    def __init__(
        self,
        *,
        scan_cache_limit_bytes: int = DEFAULT_SCAN_CACHE_LIMIT_BYTES,
        scan_cache_max_entries: int = DEFAULT_SCAN_CACHE_MAX_ENTRIES,
    ) -> None:
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
        self._scan_evidence: bytes | None = None

        # Phase 11 bounded in-memory LRU. Keys are stable sensor-result keys,
        # never art settings. Current scan bytes remain independently available
        # even if their cache entry is later evicted.
        self._scan_cache_limit_bytes = max(1, int(scan_cache_limit_bytes))
        self._scan_cache_max_entries = max(1, int(scan_cache_max_entries))
        self._scan_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._scan_cache_bytes = 0
        self._scan_cache_hits = 0
        self._scan_cache_misses = 0
        self._scan_cache_evictions = 0

    @staticmethod
    def _channels_size(channels: dict[str, bytes]) -> int:
        return sum(len(payload) for payload in channels.values())

    @staticmethod
    def _evidence_size(evidence: bytes | None) -> int:
        return len(evidence) if evidence else 0

    def _cache_summary_locked(self) -> dict[str, Any]:
        return {
            "entries": len(self._scan_cache),
            "bytes": self._scan_cache_bytes,
            "limit_bytes": self._scan_cache_limit_bytes,
            "max_entries": self._scan_cache_max_entries,
            "hits": self._scan_cache_hits,
            "misses": self._scan_cache_misses,
            "evictions": self._scan_cache_evictions,
        }

    def snapshot(self) -> dict[str, Any]:
        with self._state_lock:
            workspace = deepcopy(self._workspace)
            workspace["scan_cache"] = self._cache_summary_locked()
            return {
                "revision": self._revision,
                "reset_count": self._reset_count,
                "started_at": self._started_at,
                "updated_at": self._updated_at,
                "busy": self._active_operation is not None,
                "active_operation": self._active_operation,
                "workspace": workspace,
            }

    def reset(self) -> dict[str, Any]:
        with self._state_lock:
            self._workspace = _empty_workspace()
            self._scene_object = None
            self._scan_metadata = None
            self._scan_channels = {}
            self._scan_evidence = None
            self._scan_cache.clear()
            self._scan_cache_bytes = 0
            self._scan_cache_hits = 0
            self._scan_cache_misses = 0
            self._scan_cache_evictions = 0
            self._revision += 1
            self._reset_count += 1
            self._updated_at = _utc_now()
            return self.snapshot()

    def set_scene(self, scene_object: Any, info: dict[str, Any]) -> dict[str, Any]:
        with self._state_lock:
            self._scene_object = scene_object
            self._scan_metadata = None
            self._scan_channels = {}
            self._scan_evidence = None
            self._workspace["scene"] = {"loaded": True, **deepcopy(info)}
            self._workspace["scan"] = {"status": "idle", "scan_id": None}
            # Do not clear the cache here. Every entry is namespaced by the
            # model content fingerprint, so switching back to a known model can
            # safely reuse its prior sensor result.
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
        evidence: bytes | None = None,
    ) -> dict[str, Any]:
        with self._state_lock:
            self._scan_metadata = deepcopy(metadata)
            self._scan_channels = dict(channels)
            self._scan_evidence = evidence
            self._workspace["scan"] = {
                "status": "ready",
                "scan_id": scan_id,
                "width": metadata.get("width"),
                "height": metadata.get("height"),
                "coverage": metadata.get("coverage"),
                "cache_hit": bool(metadata.get("cache_hit")),
                "cache_key": metadata.get("cache_key"),
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

    def get_scan_by_id(self, scan_id: str) -> dict[str, Any] | None:
        with self._state_lock:
            if (
                self._scan_metadata is not None
                and str(self._scan_metadata.get("scan_id") or "") == scan_id
            ):
                return {
                    "metadata": deepcopy(self._scan_metadata),
                    "channels": dict(self._scan_channels),
                    "evidence": self._scan_evidence,
                }

            for cache_key, entry in list(self._scan_cache.items()):
                if str(entry["metadata"].get("scan_id") or "") != scan_id:
                    continue
                self._scan_cache.move_to_end(cache_key)
                return {
                    "metadata": deepcopy(entry["metadata"]),
                    "channels": dict(entry["channels"]),
                    "evidence": entry.get("evidence"),
                }
            return None

    def get_scan_channel_for(self, scan_id: str, name: str) -> bytes | None:
        scan = self.get_scan_by_id(scan_id)
        if scan is None:
            return None
        return scan["channels"].get(name)

    def get_cached_scan(self, cache_key: str) -> dict[str, Any] | None:
        with self._state_lock:
            entry = self._scan_cache.get(cache_key)
            if entry is None:
                self._scan_cache_misses += 1
                return None
            self._scan_cache.move_to_end(cache_key)
            self._scan_cache_hits += 1
            return {
                "metadata": deepcopy(entry["metadata"]),
                "channels": dict(entry["channels"]),
                "evidence": entry.get("evidence"),
                "bytes": entry["bytes"],
            }

    def put_cached_scan(
        self,
        cache_key: str,
        metadata: dict[str, Any],
        channels: dict[str, bytes],
        evidence: bytes | None = None,
    ) -> dict[str, Any]:
        with self._state_lock:
            stored_channels = dict(channels)
            size = self._channels_size(stored_channels) + self._evidence_size(evidence)

            previous = self._scan_cache.pop(cache_key, None)
            if previous is not None:
                self._scan_cache_bytes -= int(previous["bytes"])

            self._scan_cache[cache_key] = {
                "metadata": deepcopy(metadata),
                "channels": stored_channels,
                "evidence": evidence,
                "bytes": size,
            }
            self._scan_cache_bytes += size

            while (
                len(self._scan_cache) > self._scan_cache_max_entries
                or self._scan_cache_bytes > self._scan_cache_limit_bytes
            ):
                oldest_key, oldest = self._scan_cache.popitem(last=False)
                # A single result larger than the byte cap remains usable as the
                # newest/current cache entry. Evict older entries first rather
                # than immediately discarding the only result.
                if not self._scan_cache and oldest_key == cache_key:
                    self._scan_cache[oldest_key] = oldest
                    break
                self._scan_cache_bytes -= int(oldest["bytes"])
                self._scan_cache_evictions += 1

            self._updated_at = _utc_now()
            return self._cache_summary_locked()

    def scan_cache_stats(self) -> dict[str, Any]:
        with self._state_lock:
            return deepcopy(self._cache_summary_locked())

    def clear_scan_cache(self) -> None:
        with self._state_lock:
            self._scan_cache.clear()
            self._scan_cache_bytes = 0
            self._scan_cache_hits = 0
            self._scan_cache_misses = 0
            self._scan_cache_evictions = 0
            self._updated_at = _utc_now()

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

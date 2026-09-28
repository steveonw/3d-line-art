"""Private error logging with short public error IDs."""

from __future__ import annotations

import json
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any


_REDACTIONS = (
    re.compile(r"(?i)(authorization\s*[:=]\s*)([^\s,;]+)"),
    re.compile(r"(?i)(api[_-]?key\s*[:=]\s*)([^\s,;]+)"),
    re.compile(r"(?i)(bearer\s+)([^\s,;]+)"),
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def safe_error_message(message: str, limit: int = 500) -> str:
    cleaned = str(message).replace("\r", " ").replace("\n", " ")
    for pattern in _REDACTIONS:
        cleaned = pattern.sub(r"\1[redacted]", cleaned)
    if len(cleaned) > limit:
        cleaned = cleaned[: limit - 1] + "…"
    return cleaned


class ErrorRecorder:
    def __init__(self, log_path: Path) -> None:
        self.log_path = Path(log_path)
        self._lock = Lock()

    def record(
        self,
        error: BaseException,
        *,
        method: str,
        path: str,
        status: int = 500,
        extra: dict[str, Any] | None = None,
    ) -> str:
        now = _utc_now()
        error_id = f"ERR-{now:%Y%m%d-%H%M%S}-{secrets.token_hex(4).upper()}"
        payload: dict[str, Any] = {
            "error_id": error_id,
            "timestamp": now.isoformat(),
            "method": method,
            "path": path,
            "status": status,
            "type": type(error).__name__,
            "message": safe_error_message(str(error)),
        }
        if extra:
            payload["extra"] = extra

        with self._lock:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(payload, sort_keys=True) + "\n")

        return error_id

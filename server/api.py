"""Local HTTP server and JSON API for LiDAR Ink Studio."""

from __future__ import annotations

import json
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from .errors import ErrorRecorder
from .state import StudioState

HOST = "127.0.0.1"
PORT = 8777
APP_NAME = "LiDAR Ink Studio"
SERVER_VERSION = "0.1-phase2"
API_VERSION = 1

_ALLOWED_HOSTS = {"127.0.0.1", "localhost"}


class StudioHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(
        self,
        server_address: tuple[str, int],
        frontend_dir: Path,
        state: StudioState,
        error_recorder: ErrorRecorder,
    ) -> None:
        self.frontend_dir = Path(frontend_dir).resolve()
        self.state = state
        self.error_recorder = error_recorder
        super().__init__(server_address, StudioRequestHandler)


class StudioRequestHandler(BaseHTTPRequestHandler):
    server: StudioHTTPServer
    server_version = "LidarInk"
    sys_version = ""

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[server] {self.address_string()} - {fmt % args}")

    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_HEAD(self) -> None:
        self._dispatch("HEAD")

    def do_POST(self) -> None:
        self._dispatch("POST")

    def _dispatch(self, method: str) -> None:
        try:
            if not self._host_is_allowed():
                self._send_json(
                    HTTPStatus.FORBIDDEN,
                    {"ok": False, "error": "host not allowed", "code": "host_not_allowed"},
                    head_only=method == "HEAD",
                )
                return

            parsed = urlsplit(self.path)
            path = unquote(parsed.path)

            if path.startswith("/api/"):
                self._handle_api(method, path)
                return

            if method not in {"GET", "HEAD"}:
                self._send_json(
                    HTTPStatus.METHOD_NOT_ALLOWED,
                    {"ok": False, "error": "method not allowed", "code": "method_not_allowed"},
                )
                return

            self._serve_static(path, head_only=method == "HEAD")
        except Exception as error:
            error_id = self.server.error_recorder.record(
                error,
                method=method,
                path=self.path,
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {
                    "ok": False,
                    "error": "internal server error",
                    "error_id": error_id,
                },
                head_only=method == "HEAD",
            )

    def _handle_api(self, method: str, path: str) -> None:
        if method == "GET" and path == "/api/health":
            snapshot = self.server.state.snapshot()
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "app": APP_NAME,
                    "server_version": SERVER_VERSION,
                    "api_version": API_VERSION,
                    "revision": snapshot["revision"],
                    "busy": snapshot["busy"],
                },
            )
            return

        if method == "GET" and path == "/api/state":
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "state": self.server.state.snapshot()},
            )
            return

        if method == "POST" and path == "/api/reset":
            if not self.server.state.try_begin_operation("reset"):
                self._send_json(
                    HTTPStatus.CONFLICT,
                    {
                        "ok": False,
                        "error": "studio is busy",
                        "code": "busy",
                        "state": self.server.state.snapshot(),
                    },
                )
                return
            try:
                state = self.server.state.reset()
            finally:
                self.server.state.end_operation()
            state = self.server.state.snapshot()
            self._send_json(HTTPStatus.OK, {"ok": True, "state": state})
            return

        if path in {"/api/health", "/api/state", "/api/reset"}:
            self._send_json(
                HTTPStatus.METHOD_NOT_ALLOWED,
                {"ok": False, "error": "method not allowed", "code": "method_not_allowed"},
            )
            return

        self._send_json(
            HTTPStatus.NOT_FOUND,
            {"ok": False, "error": "API route not found", "code": "not_found"},
        )

    def _serve_static(self, request_path: str, *, head_only: bool) -> None:
        frontend_root = self.server.frontend_dir
        relative = request_path.lstrip("/") or "index.html"
        candidate = (frontend_root / relative).resolve()

        try:
            candidate.relative_to(frontend_root)
        except ValueError:
            self._send_text(HTTPStatus.NOT_FOUND, "Not found\n", head_only=head_only)
            return

        if candidate.is_dir():
            candidate = candidate / "index.html"

        if not candidate.is_file():
            self._send_text(HTTPStatus.NOT_FOUND, "Not found\n", head_only=head_only)
            return

        content_type, _ = mimetypes.guess_type(candidate.name)
        content_type = content_type or "application/octet-stream"
        body = candidate.read_bytes()
        self._send_bytes(
            HTTPStatus.OK,
            body,
            content_type,
            cache_control="no-cache",
            head_only=head_only,
        )

    def _host_is_allowed(self) -> bool:
        raw_host = self.headers.get("Host", "")
        if not raw_host:
            return False
        if raw_host.startswith("["):
            host = raw_host.split("]", 1)[0] + "]"
        else:
            host = raw_host.split(":", 1)[0]
        return host.lower() in _ALLOWED_HOSTS

    def _send_json(
        self,
        status: int,
        payload: dict[str, Any],
        *,
        head_only: bool = False,
    ) -> None:
        body = (json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
        self._send_bytes(
            status,
            body,
            "application/json; charset=utf-8",
            cache_control="no-store",
            head_only=head_only,
        )

    def _send_text(self, status: int, text: str, *, head_only: bool = False) -> None:
        self._send_bytes(
            status,
            text.encode("utf-8"),
            "text/plain; charset=utf-8",
            cache_control="no-store",
            head_only=head_only,
        )

    def _send_bytes(
        self,
        status: int,
        body: bytes,
        content_type: str,
        *,
        cache_control: str,
        head_only: bool,
    ) -> None:
        self.send_response(int(status))
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        if not head_only:
            self.wfile.write(body)


def create_server(
    frontend_dir: Path,
    *,
    host: str = HOST,
    port: int = PORT,
    state: StudioState | None = None,
    error_recorder: ErrorRecorder | None = None,
) -> StudioHTTPServer:
    frontend_dir = Path(frontend_dir).resolve()
    if not frontend_dir.is_dir():
        raise FileNotFoundError(f"Frontend directory not found: {frontend_dir}")
    if host != HOST:
        raise ValueError(f"Phase 2 server is local-only and must bind to {HOST}")

    state = state or StudioState()
    error_recorder = error_recorder or ErrorRecorder(
        frontend_dir.parent / ".lidar-ink" / "errors.jsonl"
    )
    return StudioHTTPServer((host, int(port)), frontend_dir, state, error_recorder)

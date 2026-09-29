"""Local HTTP server and JSON API for LiDAR Ink Studio."""

from __future__ import annotations

import json
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

from .errors import ErrorRecorder
from .lidar_bridge import LidarBridge, LidarUnavailableError, ScanIdMismatchError
from .state import StudioState

HOST = "127.0.0.1"
PORT = 8777
APP_NAME = "LiDAR Ink Studio"
SERVER_VERSION = "0.6-phase17"
API_VERSION = 9

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_JSON_BYTES = 64 * 1024
MAX_INK3D_JSON_BYTES = 4 * 1024 * 1024
_ALLOWED_HOSTS = {"127.0.0.1", "localhost"}
_JSON_POST_PATHS = {
    "/api/reset",
    "/api/lidar/scan",
    "/api/lidar/multiview",
    "/api/lidar/auto",
    "/api/lidar/fusion",
    "/api/ink3d/project",
    "/api/scene/generate",
}
_UPLOAD_POST_PATHS = {"/api/scene/upload"}
_MUTATING_API_PATHS = _JSON_POST_PATHS | _UPLOAD_POST_PATHS


class PayloadTooLarge(ValueError):
    pass


class StudioHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(
        self,
        server_address: tuple[str, int],
        frontend_dir: Path,
        state: StudioState,
        error_recorder: ErrorRecorder,
        lidar_bridge: Any | None = None,
    ) -> None:
        self.frontend_dir = Path(frontend_dir).resolve()
        self.state = state
        self.error_recorder = error_recorder
        self.lidar = lidar_bridge or LidarBridge(state)
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

            if (
                method == "POST"
                and path in _MUTATING_API_PATHS
                and not self._origin_is_allowed()
            ):
                self._send_json(
                    HTTPStatus.FORBIDDEN,
                    {
                        "ok": False,
                        "error": "origin not allowed",
                        "code": "origin_not_allowed",
                    },
                )
                return

            if path.startswith("/api/"):
                self._handle_api(method, path, parsed.query)
                return

            if method not in {"GET", "HEAD"}:
                self._send_json(
                    HTTPStatus.METHOD_NOT_ALLOWED,
                    {"ok": False, "error": "method not allowed", "code": "method_not_allowed"},
                )
                return

            self._serve_static(path, head_only=method == "HEAD")
        except PayloadTooLarge as error:
            self._send_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"ok": False, "error": str(error), "code": "payload_too_large"},
                head_only=method == "HEAD",
            )
        except LidarUnavailableError as error:
            self._send_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"ok": False, "error": str(error), "code": "lidar_unavailable"},
                head_only=method == "HEAD",
            )
        except ScanIdMismatchError as error:
            self._send_json(
                HTTPStatus.CONFLICT,
                {"ok": False, "error": str(error), "code": "scan_mismatch"},
                head_only=method == "HEAD",
            )
        except (ValueError, json.JSONDecodeError) as error:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": str(error), "code": "bad_request"},
                head_only=method == "HEAD",
            )
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

    def _busy(self) -> None:
        self._send_json(
            HTTPStatus.CONFLICT,
            {
                "ok": False,
                "error": "studio is busy",
                "code": "busy",
                "state": self.server.state.snapshot(),
            },
        )

    def _handle_api(self, method: str, path: str, query: str) -> None:
        if method == "POST" and path in _JSON_POST_PATHS:
            if not self._content_type_is("application/json"):
                self._send_json(
                    HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                    {
                        "ok": False,
                        "error": "Content-Type must be application/json",
                        "code": "unsupported_media_type",
                    },
                )
                return

        if method == "POST" and path in _UPLOAD_POST_PATHS:
            if not self._content_type_is("application/octet-stream"):
                self._send_json(
                    HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                    {
                        "ok": False,
                        "error": "Content-Type must be application/octet-stream",
                        "code": "unsupported_media_type",
                    },
                )
                return

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
                self._busy()
                return
            try:
                self.server.state.reset()
                clear_fusion = getattr(self.server.lidar, "clear_fusion_cache", None)
                if callable(clear_fusion):
                    clear_fusion()
            finally:
                self.server.state.end_operation()
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "state": self.server.state.snapshot()},
            )
            return

        if method == "POST" and path == "/api/scene/upload":
            params = parse_qs(query, keep_blank_values=True)
            filename = (params.get("filename") or [""])[0].strip()
            raw = self._read_body(MAX_UPLOAD_BYTES)
            if not self.server.state.try_begin_operation("scene-upload"):
                self._busy()
                return
            try:
                info = self.server.lidar.upload_scene(filename, raw)
            finally:
                self.server.state.end_operation()
            self._send_json(HTTPStatus.OK, {"ok": True, "scene": info})
            return

        if method == "POST" and path == "/api/scene/generate":
            spec = self._read_json(MAX_JSON_BYTES)
            if not self.server.state.try_begin_operation("scene-generate"):
                self._busy()
                return
            try:
                info = self.server.lidar.generate_scene(spec)
            finally:
                self.server.state.end_operation()
            self._send_json(HTTPStatus.OK, {"ok": True, "scene": info})
            return

        if method == "POST" and path == "/api/lidar/scan":
            options = self._read_json(MAX_JSON_BYTES)
            if not self.server.state.try_begin_operation("lidar-scan"):
                self._busy()
                return
            try:
                scan = self.server.lidar.scan(options)
            finally:
                self.server.state.end_operation()
            self._send_json(HTTPStatus.OK, {"ok": True, "scan": scan})
            return

        if method == "POST" and path == "/api/lidar/multiview":
            options = self._read_json(MAX_JSON_BYTES)
            if not self.server.state.try_begin_operation("lidar-multiview"):
                self._busy()
                return
            try:
                multiview = self.server.lidar.scan_fixed_views(options)
            finally:
                self.server.state.end_operation()
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "multiview": multiview},
            )
            return

        if method == "POST" and path == "/api/lidar/auto":
            options = self._read_json(MAX_JSON_BYTES)
            if not self.server.state.try_begin_operation("lidar-auto"):
                self._busy()
                return
            try:
                multiview = self.server.lidar.scan_auto_views(options)
            finally:
                self.server.state.end_operation()
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "multiview": multiview},
            )
            return

        if method == "POST" and path == "/api/lidar/fusion":
            options = self._read_json(MAX_JSON_BYTES)
            scan_ids = options.get("scan_ids")
            if not isinstance(scan_ids, list):
                raise ValueError("scan_ids must be an array")
            if not self.server.state.try_begin_operation("lidar-fusion"):
                self._busy()
                return
            try:
                fusion = self.server.lidar.fuse_scan_confidence(scan_ids)
            finally:
                self.server.state.end_operation()
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "fusion": fusion},
            )
            return

        if method == "POST" and path == "/api/ink3d/project":
            payload = self._read_json(MAX_INK3D_JSON_BYTES)
            if not self.server.state.try_begin_operation("ink3d-project"):
                self._busy()
                return
            try:
                ink = self.server.lidar.project_ink3d(payload)
            finally:
                self.server.state.end_operation()
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "ink3d": ink},
            )
            return

        if method == "GET" and path.startswith("/api/lidar/fusion/") and path.endswith(".png"):
            channel = path.rsplit("/", 1)[-1][:-4]
            params = parse_qs(query, keep_blank_values=True)
            fusion_id = (params.get("fusion_id") or [""])[0]
            scan_id = (params.get("scan_id") or [""])[0]
            payload = self.server.lidar.fusion_png(
                fusion_id,
                scan_id,
                channel,
            )
            self._send_bytes(
                HTTPStatus.OK,
                payload,
                "image/png",
                cache_control="no-store",
                head_only=False,
            )
            return

        if method == "GET" and path == "/api/inspection/scene":
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "inspection": self.server.lidar.inspection_scene()},
            )
            return

        if method == "GET" and path == "/api/inspection/scan":
            params = parse_qs(query, keep_blank_values=True)
            scan_id = (params.get("scan_id") or [None])[0]
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "inspection": self.server.lidar.inspection_scan(scan_id=scan_id),
                },
            )
            return

        if method == "GET" and path == "/api/lidar/maps":
            params = parse_qs(query, keep_blank_values=True)
            scan_id = (params.get("scan_id") or [None])[0]
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "scan": self.server.lidar.maps_summary(scan_id=scan_id),
                },
            )
            return

        if method == "GET" and path.startswith("/api/lidar/maps/") and path.endswith(".png"):
            channel = path.rsplit("/", 1)[-1][:-4]
            params = parse_qs(query, keep_blank_values=True)
            scan_id = (params.get("scan_id") or [None])[0]
            payload = self.server.lidar.channel_png(channel, scan_id=scan_id)
            self._send_bytes(
                HTTPStatus.OK,
                payload,
                "image/png",
                cache_control="no-store",
                head_only=False,
            )
            return

        known_paths = {
            "/api/health",
            "/api/state",
            "/api/reset",
            "/api/scene/upload",
            "/api/lidar/scan",
            "/api/lidar/multiview",
            "/api/lidar/auto",
            "/api/lidar/fusion",
            "/api/lidar/maps",
            "/api/ink3d/project",
            "/api/scene/generate",
            "/api/inspection/scene",
            "/api/inspection/scan",
        }
        if (
            path in known_paths
            or path.startswith("/api/lidar/maps/")
            or path.startswith("/api/lidar/fusion/")
        ):
            self._send_json(
                HTTPStatus.METHOD_NOT_ALLOWED,
                {"ok": False, "error": "method not allowed", "code": "method_not_allowed"},
            )
            return

        self._send_json(
            HTTPStatus.NOT_FOUND,
            {"ok": False, "error": "API route not found", "code": "not_found"},
        )

    def _read_body(self, max_bytes: int) -> bytes:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            return b""
        try:
            length = int(raw_length)
        except ValueError as error:
            raise ValueError("invalid Content-Length") from error
        if length < 0:
            raise ValueError("invalid Content-Length")
        if length > max_bytes:
            raise PayloadTooLarge(f"request exceeds {max_bytes // (1024 * 1024)} MB limit")
        return self.rfile.read(length)

    def _read_json(self, max_bytes: int) -> dict[str, Any]:
        raw = self._read_body(max_bytes)
        if not raw:
            return {}
        try:
            payload = json.loads(raw.decode("utf-8"))
        except RecursionError as error:
            raise ValueError("JSON nesting is too deep") from error
        if not isinstance(payload, dict):
            raise ValueError("JSON body must be an object")
        return payload

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

    def _origin_is_allowed(self) -> bool:
        raw_origin = self.headers.get("Origin")
        if raw_origin is None:
            # Non-browser local clients and the test harness may omit Origin.
            # Browser requests that carry Origin must be same-loopback-origin.
            return True
        try:
            parsed = urlsplit(raw_origin)
            port = parsed.port
        except ValueError:
            return False
        if parsed.scheme.lower() != "http":
            return False
        if (parsed.hostname or "").lower() not in _ALLOWED_HOSTS:
            return False
        return port == int(self.server.server_address[1])

    def _content_type_is(self, expected: str) -> bool:
        raw = self.headers.get("Content-Type", "")
        media_type = raw.split(";", 1)[0].strip().lower()
        return media_type == expected

    def _send_json(
        self,
        status: int,
        payload: dict[str, Any],
        *,
        head_only: bool = False,
    ) -> None:
        body = (
            json.dumps(
                payload,
                separators=(",", ":"),
                sort_keys=True,
                allow_nan=False,
            )
            + "\n"
        ).encode("utf-8")
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
    lidar_bridge: Any | None = None,
) -> StudioHTTPServer:
    frontend_dir = Path(frontend_dir).resolve()
    if not frontend_dir.is_dir():
        raise FileNotFoundError(f"Frontend directory not found: {frontend_dir}")
    if host != HOST:
        raise ValueError(f"LiDAR Ink Studio is local-only and must bind to {HOST}")

    state = state or StudioState()
    error_recorder = error_recorder or ErrorRecorder(
        frontend_dir.parent / ".lidar-ink" / "errors.jsonl"
    )
    return StudioHTTPServer(
        (host, int(port)),
        frontend_dir,
        state,
        error_recorder,
        lidar_bridge=lidar_bridge,
    )

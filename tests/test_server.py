from __future__ import annotations

import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server.api import HOST, create_server
from server.errors import ErrorRecorder
from server.state import StudioState


PNG = b"\x89PNG\r\n\x1a\nphase4-test"
CHANNELS = ("shaded", "depth", "edge", "variance", "confidence")


class FakeLidarBridge:
    def __init__(self, state: StudioState) -> None:
        self.state = state

    def upload_scene(self, filename: str, raw: bytes) -> dict:
        if not filename:
            raise ValueError("filename is required")
        if not raw:
            raise ValueError("uploaded model is empty")
        info = {
            "name": filename,
            "format": Path(filename).suffix.lower().lstrip("."),
            "triangles": 12,
            "vertices": 8,
            "normalized": True,
        }
        self.state.set_scene(object(), info)
        return info

    def scan(self, options: dict | None = None) -> dict:
        if self.state.get_scene_object() is None:
            raise ValueError("no 3D model is loaded")
        options = options or {}
        metadata = {
            "scan_id": "fake123",
            "width": int(options.get("width", 320)),
            "height": int(options.get("height", 240)),
            "rays_per_pixel": int(options.get("rays_per_pixel", 2)),
            "seed": int(options.get("seed", 42)),
            "smart_sampling": bool(options.get("smart_sampling", False)),
            "coverage": 0.75,
            "camera": {
                "yaw_deg": float(options.get("yaw_deg", 45)),
                "elevation_deg": float(options.get("elevation_deg", 20)),
                "distance_scale": float(options.get("distance_scale", 3.0)),
                "fov_deg": float(options.get("fov_deg", 55)),
            },
            "scene": {"name": self.state.snapshot()["workspace"]["scene"]["name"]},
        }
        self.state.set_scan(
            "fake123",
            metadata,
            {name: PNG for name in CHANNELS},
        )
        return self.maps_summary()

    def maps_summary(self) -> dict:
        scan = self.state.get_scan()
        if scan is None:
            raise ValueError("no LiDAR scan is available")
        metadata = dict(scan["metadata"])
        metadata["channels"] = {
            name: f"/api/lidar/maps/{name}.png?scan_id=fake123"
            for name in CHANNELS
        }
        return metadata

    def channel_png(self, channel: str) -> bytes:
        if channel not in set(CHANNELS):
            raise ValueError("unknown LiDAR channel")
        payload = self.state.get_scan_channel(channel)
        if payload is None:
            raise ValueError("no LiDAR scan is available")
        return payload


class ServerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.frontend = root / "frontend"
        self.frontend.mkdir()
        (self.frontend / "index.html").write_text(
            "<!doctype html><title>Phase 4 Test</title>",
            encoding="utf-8",
        )
        (self.frontend / "app.js").write_text(
            "window.phase4Test = true;",
            encoding="utf-8",
        )
        (root / "secret.txt").write_text("outside frontend", encoding="utf-8")

        self.state = StudioState()
        recorder = ErrorRecorder(root / "errors.jsonl")
        self.lidar = FakeLidarBridge(self.state)
        self.server = create_server(
            self.frontend,
            host=HOST,
            port=0,
            state=self.state,
            error_recorder=recorder,
            lidar_bridge=self.lidar,
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://{HOST}:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()

    def request(
        self,
        path: str,
        *,
        method: str = "GET",
        body: bytes | None = None,
        content_type: str | None = None,
    ) -> tuple[int, bytes, str]:
        headers = {}
        if content_type:
            headers["Content-Type"] = content_type
        request = Request(self.base + path, data=body, headers=headers, method=method)
        try:
            with urlopen(request, timeout=2) as response:
                return (
                    response.status,
                    response.read(),
                    response.headers.get("Content-Type", ""),
                )
        except HTTPError as error:
            return error.code, error.read(), error.headers.get("Content-Type", "")

    def json_request(
        self,
        path: str,
        *,
        method: str = "GET",
        body: bytes | None = None,
        content_type: str | None = None,
    ) -> tuple[int, dict]:
        status, payload, _ = self.request(
            path,
            method=method,
            body=body,
            content_type=content_type,
        )
        return status, json.loads(payload.decode("utf-8"))

    def upload_fake_scene(self) -> dict:
        status, payload = self.json_request(
            "/api/scene/upload?filename=cube.obj",
            method="POST",
            body=b"fake obj bytes",
            content_type="application/octet-stream",
        )
        self.assertEqual(status, 200)
        return payload

    def test_health(self) -> None:
        status, payload = self.json_request("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["server_version"], "0.3-phase4")
        self.assertEqual(payload["api_version"], 3)

    def test_state_and_reset(self) -> None:
        status, before = self.json_request("/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(before["state"]["revision"], 0)
        self.assertEqual(before["state"]["reset_count"], 0)

        status, after = self.json_request("/api/reset", method="POST")
        self.assertEqual(status, 200)
        self.assertEqual(after["state"]["revision"], 1)
        self.assertEqual(after["state"]["reset_count"], 1)
        self.assertFalse(after["state"]["busy"])

    def test_busy_write_returns_conflict(self) -> None:
        self.assertTrue(self.state.try_begin_operation("test-operation"))
        try:
            status, payload = self.json_request("/api/reset", method="POST")
        finally:
            self.state.end_operation()

        self.assertEqual(status, 409)
        self.assertEqual(payload["code"], "busy")
        self.assertEqual(payload["state"]["active_operation"], "test-operation")

    def test_static_frontend_is_served(self) -> None:
        status, body, content_type = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn(b"Phase 4 Test", body)
        self.assertIn("text/html", content_type)

        status, body, content_type = self.request("/app.js")
        self.assertEqual(status, 200)
        self.assertIn(b"phase4Test", body)
        self.assertIn("javascript", content_type)

    def test_scene_upload_updates_state(self) -> None:
        payload = self.upload_fake_scene()
        self.assertTrue(payload["scene"]["normalized"])

        status, state = self.json_request("/api/state")
        self.assertEqual(status, 200)
        self.assertTrue(state["state"]["workspace"]["scene"]["loaded"])
        self.assertEqual(state["state"]["workspace"]["scene"]["name"], "cube.obj")

    def test_scan_requires_scene(self) -> None:
        status, payload = self.json_request(
            "/api/lidar/scan",
            method="POST",
            body=b"{}",
            content_type="application/json",
        )
        self.assertEqual(status, 400)
        self.assertEqual(payload["code"], "bad_request")

    def test_scan_options_and_map_endpoints(self) -> None:
        self.upload_fake_scene()
        options = {
            "width": 160,
            "height": 120,
            "smart_sampling": True,
            "yaw_deg": 120,
            "elevation_deg": 35,
            "distance_scale": 2.8,
            "fov_deg": 48,
        }
        status, payload = self.json_request(
            "/api/lidar/scan",
            method="POST",
            body=json.dumps(options).encode("utf-8"),
            content_type="application/json",
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["scan"]["scan_id"], "fake123")
        self.assertEqual(payload["scan"]["width"], 160)
        self.assertTrue(payload["scan"]["smart_sampling"])
        self.assertEqual(payload["scan"]["camera"]["yaw_deg"], 120.0)

        status, maps = self.json_request("/api/lidar/maps")
        self.assertEqual(status, 200)
        self.assertEqual(set(maps["scan"]["channels"]), set(CHANNELS))

        for channel in CHANNELS:
            status, body, content_type = self.request(f"/api/lidar/maps/{channel}.png")
            self.assertEqual(status, 200)
            self.assertEqual(body, PNG)
            self.assertEqual(content_type, "image/png")

    def test_reset_discards_scene_and_scan(self) -> None:
        self.upload_fake_scene()
        self.json_request(
            "/api/lidar/scan",
            method="POST",
            body=b"{}",
            content_type="application/json",
        )
        status, _ = self.json_request("/api/reset", method="POST")
        self.assertEqual(status, 200)
        self.assertIsNone(self.state.get_scene_object())
        self.assertIsNone(self.state.get_scan())

    def test_unknown_api_is_json_404(self) -> None:
        status, payload = self.json_request("/api/nope")
        self.assertEqual(status, 404)
        self.assertEqual(payload["code"], "not_found")

    def test_path_traversal_is_blocked(self) -> None:
        status, body, _ = self.request("/%2e%2e/secret.txt")
        self.assertEqual(status, 404)
        self.assertNotIn(b"outside frontend", body)


if __name__ == "__main__":
    unittest.main()

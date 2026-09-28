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
from server.lidar_bridge import FIXED_VIEW_ORDER, FIXED_VIEWS
from server.state import StudioState


PNG = b"\x89PNG\r\n\x1a\nphase4-test"
CHANNELS = ("shaded", "depth", "edge", "variance", "confidence")


class FakeLidarBridge:
    def __init__(self, state: StudioState) -> None:
        self.state = state
        self.scans: dict[str, dict] = {}

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
            "cache_hit": False,
            "cache_key": "fake-cache-key",
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
            metadata["scan_id"],
            metadata,
            {name: PNG for name in CHANNELS},
        )
        self.scans[metadata["scan_id"]] = {
            "metadata": dict(metadata),
            "channels": {name: PNG for name in CHANNELS},
        }
        return self.maps_summary()

    def scan_fixed_views(self, options: dict | None = None) -> dict:
        if self.state.get_scene_object() is None:
            raise ValueError("no 3D model is loaded")
        base = dict(options or {})
        views = {}
        for name in FIXED_VIEW_ORDER:
            descriptor = FIXED_VIEWS[name]
            metadata = {
                "scan_id": f"fake-{name}",
                "cache_hit": False,
                "cache_key": f"fake-cache-{name}",
                "width": int(base.get("width", 320)),
                "height": int(base.get("height", 240)),
                "rays_per_pixel": int(base.get("rays_per_pixel", 2)),
                "seed": int(base.get("seed", 42)),
                "smart_sampling": bool(base.get("smart_sampling", False)),
                "coverage": 0.70,
                "camera": {
                    "yaw_deg": descriptor["yaw_deg"],
                    "elevation_deg": descriptor["elevation_deg"],
                    "distance_scale": float(base.get("distance_scale", 3.0)),
                    "fov_deg": float(base.get("fov_deg", 55)),
                },
                "scene": {"name": self.state.snapshot()["workspace"]["scene"]["name"]},
                "view": {
                    "name": name,
                    "label": descriptor["label"],
                    "yaw_deg": descriptor["yaw_deg"],
                    "elevation_deg": descriptor["elevation_deg"],
                },
            }
            channels = {channel: PNG + name.encode("ascii") for channel in CHANNELS}
            self.scans[metadata["scan_id"]] = {
                "metadata": dict(metadata),
                "channels": channels,
            }
            self.state.set_scan(metadata["scan_id"], metadata, channels)
            view = dict(metadata)
            view["channels"] = {
                channel: f"/api/lidar/maps/{channel}.png?scan_id={metadata['scan_id']}"
                for channel in CHANNELS
            }
            view["cache"] = self.state.scan_cache_stats()
            views[name] = view
        return {
            "order": list(FIXED_VIEW_ORDER),
            "views": views,
            "current_view": FIXED_VIEW_ORDER[-1],
            "cache": self.state.scan_cache_stats(),
        }

    def scan_auto_views(self, options: dict | None = None) -> dict:
        if self.state.get_scene_object() is None:
            raise ValueError("no 3D model is loaded")
        base = dict(options or {})
        descriptors = [
            ("auto_low_000", "Low 0°", 0.0, 20.0, 0.78),
            ("auto_low_180", "Low 180°", 180.0, 20.0, 0.81),
            ("auto_high_090", "High 90°", 90.0, 70.0, 0.74),
        ]
        views = {}
        order = []
        for name, label, yaw, elevation, quality in descriptors:
            metadata = {
                "scan_id": f"fake-{name}",
                "cache_hit": False,
                "cache_key": f"fake-cache-{name}",
                "width": int(base.get("width", 320)),
                "height": int(base.get("height", 240)),
                "rays_per_pixel": int(base.get("rays_per_pixel", 2)),
                "seed": int(base.get("seed", 42)),
                "smart_sampling": bool(base.get("smart_sampling", False)),
                "coverage": 0.70,
                "mean_confidence": quality,
                "quality_score": quality,
                "camera": {
                    "yaw_deg": yaw,
                    "elevation_deg": elevation,
                    "distance_scale": float(base.get("distance_scale", 3.0)),
                    "fov_deg": float(base.get("fov_deg", 55)),
                },
                "scene": {"name": self.state.snapshot()["workspace"]["scene"]["name"]},
                "view": {
                    "name": name,
                    "label": label,
                    "yaw_deg": yaw,
                    "elevation_deg": elevation,
                    "quality_score": quality,
                    "kind": "auto",
                },
            }
            channels = {channel: PNG + name.encode("ascii") for channel in CHANNELS}
            self.scans[metadata["scan_id"]] = {
                "metadata": dict(metadata),
                "channels": channels,
            }
            self.state.set_scan(metadata["scan_id"], metadata, channels)
            view = dict(metadata)
            view["channels"] = {
                channel: f"/api/lidar/maps/{channel}.png?scan_id={metadata['scan_id']}"
                for channel in CHANNELS
            }
            view["cache"] = self.state.scan_cache_stats()
            views[name] = view
            order.append(name)
        return {
            "mode": "auto",
            "order": order,
            "views": views,
            "current_view": order[0],
            "planner": {
                "metric": "quality-weighted view-space coverage",
                "coverage_score": 0.76,
                "target": 0.72,
                "stop_reason": "target_reached",
                "steps": [],
            },
            "cache": self.state.scan_cache_stats(),
        }

    def maps_summary(self, scan_id: str | None = None) -> dict:
        if scan_id:
            stored = self.scans.get(scan_id)
            if stored is None:
                from server.lidar_bridge import ScanIdMismatchError
                raise ScanIdMismatchError("requested scan is not available")
            metadata = dict(stored["metadata"])
        else:
            scan = self.state.get_scan()
            if scan is None:
                raise ValueError("no LiDAR scan is available")
            metadata = dict(scan["metadata"])
        resolved = metadata["scan_id"]
        metadata["channels"] = {
            name: f"/api/lidar/maps/{name}.png?scan_id={resolved}"
            for name in CHANNELS
        }
        metadata["cache"] = self.state.scan_cache_stats()
        return metadata

    def channel_png(self, channel: str, scan_id: str | None = None) -> bytes:
        if channel not in set(CHANNELS):
            raise ValueError("unknown LiDAR channel")
        if scan_id:
            stored = self.scans.get(scan_id)
            if stored is None:
                from server.lidar_bridge import ScanIdMismatchError
                raise ScanIdMismatchError("requested scan is not available")
            return stored["channels"][channel]
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
        self.assertEqual(payload["server_version"], "0.4-phase13")
        self.assertEqual(payload["api_version"], 5)

    def test_state_and_reset(self) -> None:
        status, before = self.json_request("/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(before["state"]["revision"], 0)
        self.assertEqual(before["state"]["reset_count"], 0)
        self.assertEqual(before["state"]["workspace"]["scan_cache"]["entries"], 0)
        self.assertIn("limit_bytes", before["state"]["workspace"]["scan_cache"])

        status, after = self.json_request("/api/reset", method="POST")
        self.assertEqual(status, 200)
        self.assertEqual(after["state"]["revision"], 1)
        self.assertEqual(after["state"]["reset_count"], 1)
        self.assertFalse(after["state"]["busy"])
        self.assertEqual(after["state"]["workspace"]["scan_cache"]["entries"], 0)

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
        self.assertFalse(payload["scan"]["cache_hit"])
        self.assertEqual(payload["scan"]["cache_key"], "fake-cache-key")
        self.assertEqual(payload["scan"]["width"], 160)
        self.assertTrue(payload["scan"]["smart_sampling"])
        self.assertEqual(payload["scan"]["camera"]["yaw_deg"], 120.0)

        status, maps = self.json_request("/api/lidar/maps")
        self.assertEqual(status, 200)
        self.assertEqual(set(maps["scan"]["channels"]), set(CHANNELS))

        for channel in CHANNELS:
            status, body, content_type = self.request(
                f"/api/lidar/maps/{channel}.png?scan_id=fake123"
            )
            self.assertEqual(status, 200)
            self.assertEqual(body, PNG)
            self.assertEqual(content_type, "image/png")

        status, payload = self.json_request(
            "/api/lidar/maps/depth.png?scan_id=stale999"
        )
        self.assertEqual(status, 409)
        self.assertEqual(payload["code"], "scan_mismatch")

    def test_fixed_multiview_endpoint_and_archived_channels(self) -> None:
        self.upload_fake_scene()
        options = {
            "width": 160,
            "height": 120,
            "rays_per_pixel": 1,
            "smart_sampling": False,
            "distance_scale": 3.2,
            "fov_deg": 50,
        }
        status, payload = self.json_request(
            "/api/lidar/multiview",
            method="POST",
            body=json.dumps(options).encode("utf-8"),
            content_type="application/json",
        )
        self.assertEqual(status, 200)
        multiview = payload["multiview"]
        self.assertEqual(multiview["order"], list(FIXED_VIEW_ORDER))
        self.assertEqual(set(multiview["views"]), set(FIXED_VIEW_ORDER))

        for name in FIXED_VIEW_ORDER:
            scan = multiview["views"][name]
            descriptor = FIXED_VIEWS[name]
            self.assertEqual(scan["view"]["name"], name)
            self.assertEqual(scan["camera"]["yaw_deg"], descriptor["yaw_deg"])
            self.assertEqual(
                scan["camera"]["elevation_deg"],
                descriptor["elevation_deg"],
            )

        front_id = multiview["views"]["front"]["scan_id"]
        top_id = multiview["views"]["top"]["scan_id"]
        self.assertNotEqual(front_id, top_id)

        status, maps = self.json_request(
            f"/api/lidar/maps?scan_id={front_id}"
        )
        self.assertEqual(status, 200)
        self.assertEqual(maps["scan"]["scan_id"], front_id)

        status, body, content_type = self.request(
            f"/api/lidar/maps/depth.png?scan_id={front_id}"
        )
        self.assertEqual(status, 200)
        self.assertTrue(body.endswith(b"front"))
        self.assertEqual(content_type, "image/png")

    def test_auto_multiview_endpoint(self) -> None:
        self.upload_fake_scene()
        status, payload = self.json_request(
            "/api/lidar/auto",
            method="POST",
            body=json.dumps({
                "width": 160,
                "height": 120,
                "rays_per_pixel": 1,
                "distance_scale": 3.2,
                "fov_deg": 50,
            }).encode("utf-8"),
            content_type="application/json",
        )
        self.assertEqual(status, 200)
        multiview = payload["multiview"]
        self.assertEqual(multiview["mode"], "auto")
        self.assertEqual(len(multiview["order"]), 3)
        self.assertEqual(multiview["planner"]["stop_reason"], "target_reached")
        first = multiview["views"][multiview["order"][0]]
        self.assertEqual(first["view"]["kind"], "auto")

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

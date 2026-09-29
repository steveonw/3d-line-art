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

    def generate_scene(self, spec: dict | None = None) -> dict:
        spec = dict(spec or {})
        kind = str(spec.get("type") or "sphere")
        if kind not in {"sphere", "box", "cylinder", "lathe", "heightfield"}:
            raise ValueError("type must be sphere, box, cylinder, lathe, or heightfield")
        info = {
            "name": f"generated-{kind}.obj",
            "format": "obj",
            "triangles": 48,
            "vertices": 26,
            "normalized": True,
            "sha256": (kind[0] * 64),
            "generator": {"type": kind, **{k: v for k, v in spec.items() if k != "type"}},
        }
        self.state.set_scene(object(), info)
        return info

    def transform_scene(self, spec: dict | None = None) -> dict:
        current = self.state.snapshot()["workspace"]["scene"]
        if not current.get("loaded"):
            raise ValueError("no 3D model is loaded")
        spec = dict(spec or {})
        transform = {
            "position": {
                "x": float((spec.get("position") or {}).get("x", 0)),
                "y": float((spec.get("position") or {}).get("y", 0)),
                "z": float((spec.get("position") or {}).get("z", 0)),
            },
            "rotation": {
                "x": float((spec.get("rotation") or {}).get("x", 0)),
                "y": float((spec.get("rotation") or {}).get("y", 0)),
                "z": float((spec.get("rotation") or {}).get("z", 0)),
            },
            "scale": float(spec.get("scale", 1)),
        }
        info = {
            **current,
            "transform": transform,
            "geometry_sha256": "f" * 64,
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
            "current_view": order[-1],
            "planner": {
                "metric": "quality-weighted view-space coverage",
                "coverage_score": 0.76,
                "target": 0.72,
                "stop_reason": "target_reached",
                "steps": [],
            },
            "cache": self.state.scan_cache_stats(),
        }

    def inspection_scene(self) -> dict:
        scene = self.state.snapshot()["workspace"]["scene"]
        if not scene.get("loaded"):
            raise ValueError("no 3D model is loaded")
        return {
            "scene": {
                "name": scene.get("name"),
                "sha256": scene.get("sha256"),
                "triangles": scene.get("triangles", 12),
                "vertices": scene.get("vertices", 8),
                "bounds_min": [-1.0, 0.0, -1.0],
                "bounds_max": [1.0, 2.0, 1.0],
            },
            "preview": {
                "triangle_count": 2,
                "source_triangle_count": 12,
                "positions": [
                    -1.0, 0.0, -1.0, 1.0, 0.0, -1.0, 1.0, 2.0, -1.0,
                    -1.0, 0.0, -1.0, 1.0, 2.0, -1.0, -1.0, 2.0, -1.0,
                ],
                "center": [0.0, 1.0, 0.0],
                "radius": 1.732,
            },
        }

    def inspection_scan(self, scan_id: str | None = None) -> dict:
        requested = scan_id or self.state.snapshot()["workspace"]["scan"].get("scan_id")
        if not requested or requested not in self.scans:
            from server.lidar_bridge import ScanIdMismatchError
            raise ScanIdMismatchError("requested inspection scan is not available")
        return {
            "scan_id": requested,
            "scene_sha256": None,
            "camera": {
                "position": [0.0, 2.0, -6.0],
                "target": [0.0, 1.0, 0.0],
                "fov_deg": 55.0,
                "width": 160,
                "height": 120,
                "yaw_deg": 0.0,
                "elevation_deg": 20.0,
            },
            "points": {
                "source_count": 2,
                "preview_count": 2,
                "positions": [0.0, 0.5, 0.0, 0.5, 1.0, 0.0],
                "confidence": [180, 230],
            },
            "rays": {
                "kind": "cached-hit-rays",
                "count": 2,
                "positions": [
                    0.0, 2.0, -6.0, 0.0, 0.5, 0.0,
                    0.0, 2.0, -6.0, 0.5, 1.0, 0.0,
                ],
            },
        }

    def project_ink3d(self, payload: dict) -> dict:
        scan_id = str(payload.get("scan_id") or "")
        if scan_id not in self.scans:
            from server.lidar_bridge import ScanIdMismatchError
            raise ScanIdMismatchError("requested 3D Ink scan is not available")
        return {
            "format": "lidar-ink-3d-strokes",
            "version": 1,
            "scene_sha256": None,
            "scan_id": scan_id,
            "source_stroke_count": 1,
            "stroke_count": 1,
            "point_count": 2,
            "ray_count": 2,
            "hit_count": 2,
            "miss_count": 0,
            "positions": [0.0, 0.5, -1.0, 0.5, 0.5, -1.0],
            "normals": [0.0, 0.0, -1.0, 0.0, 0.0, -1.0],
            "tangents": [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            "depth": [5.0, 5.0],
            "confidence": [210, 220],
            "material_rgb": [180, 180, 190, 180, 180, 190],
            "piece_ids": [1000, 1000],
            "stroke_offsets": [0],
            "stroke_counts": [2],
            "stroke_widths": [1.0],
            "stroke_rgba": [12, 12, 12, 220],
            "source_stroke_indices": [0],
            "metadata": {
                "coordinate_space": "normalized-world",
                "normal_convention": "camera-facing-visible-surface",
                "tangent_convention": "projected-polyline-surface-tangent",
                "depth_convention": "camera-ray-distance-to-real-mesh",
                "confidence_source": "selected-scan-cached-confidence",
                "material_source": "real-mesh-hit-color-and-piece-id",
            },
        }

    def clear_fusion_cache(self) -> None:
        pass

    def fuse_scan_confidence(self, scan_ids: list[str]) -> dict:
        if len(scan_ids) < 2:
            raise ValueError("confidence fusion requires at least two distinct scans")
        views = {
            scan_id: {
                "scan_id": scan_id,
                "mean_confidence": 0.82,
                "overlap_fraction": 0.65,
                "max_support": len(scan_ids),
                "width": 160,
                "height": 120,
                "confidence": (
                    f"/api/lidar/fusion/confidence.png?fusion_id=fakefusion"
                    f"&scan_id={scan_id}"
                ),
                "support": (
                    f"/api/lidar/fusion/support.png?fusion_id=fakefusion"
                    f"&scan_id={scan_id}"
                ),
            }
            for scan_id in scan_ids
        }
        return {
            "fusion_id": "fakefusion",
            "cache_hit": False,
            "source_count": len(scan_ids),
            "scan_ids": list(scan_ids),
            "metric": "world-space reprojected confidence agreement",
            "views": views,
        }

    def fusion_png(self, fusion_id: str, scan_id: str, channel: str) -> bytes:
        if fusion_id != "fakefusion" or channel not in {"confidence", "support"}:
            from server.lidar_bridge import ScanIdMismatchError
            raise ScanIdMismatchError("fusion result is not available")
        return PNG + f"{scan_id}-{channel}".encode("ascii")

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
        headers: dict[str, str] | None = None,
    ) -> tuple[int, bytes, str]:
        request_headers = dict(headers or {})
        if content_type:
            request_headers["Content-Type"] = content_type
        request = Request(
            self.base + path,
            data=body,
            headers=request_headers,
            method=method,
        )
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
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict]:
        status, payload, _ = self.request(
            path,
            method=method,
            body=body,
            content_type=content_type,
            headers=headers,
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
        self.assertEqual(payload["server_version"], "0.6-post-v05-transform")
        self.assertEqual(payload["api_version"], 10)

    def test_state_and_reset(self) -> None:
        status, before = self.json_request("/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(before["state"]["revision"], 0)
        self.assertEqual(before["state"]["reset_count"], 0)
        self.assertEqual(before["state"]["workspace"]["scan_cache"]["entries"], 0)
        self.assertIn("limit_bytes", before["state"]["workspace"]["scan_cache"])

        status, after = self.json_request(
            "/api/reset",
            method="POST",
            body=b"{}",
            content_type="application/json",
        )
        self.assertEqual(status, 200)
        self.assertEqual(after["state"]["revision"], 1)
        self.assertEqual(after["state"]["reset_count"], 1)
        self.assertFalse(after["state"]["busy"])
        self.assertEqual(after["state"]["workspace"]["scan_cache"]["entries"], 0)

    def test_busy_write_returns_conflict(self) -> None:
        self.assertTrue(self.state.try_begin_operation("test-operation"))
        try:
            status, payload = self.json_request(
                "/api/reset",
                method="POST",
                body=b"{}",
                content_type="application/json",
            )
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

    def test_scene_transform_endpoint_updates_authoritative_scene(self) -> None:
        self.upload_fake_scene()
        status, payload = self.json_request(
            "/api/scene/transform",
            method="POST",
            body=json.dumps({
                "position": {"x": 2, "y": 1, "z": -3},
                "rotation": {"x": 90, "y": 0, "z": 15},
                "scale": 1.25,
            }).encode("utf-8"),
            content_type="application/json",
        )
        self.assertEqual(status, 200)
        scene = payload["scene"]
        self.assertEqual(scene["transform"]["position"]["x"], 2.0)
        self.assertEqual(scene["transform"]["rotation"]["x"], 90.0)
        self.assertEqual(scene["transform"]["scale"], 1.25)
        self.assertEqual(scene["geometry_sha256"], "f" * 64)

        status, state = self.json_request("/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(
            state["state"]["workspace"]["scene"]["transform"]["position"]["z"],
            -3.0,
        )
        self.assertEqual(
            state["state"]["workspace"]["scan"]["status"],
            "idle",
        )

    def test_scene_transform_requires_loaded_scene(self) -> None:
        status, payload = self.json_request(
            "/api/scene/transform",
            method="POST",
            body=b"{}",
            content_type="application/json",
        )
        self.assertEqual(status, 400)
        self.assertEqual(payload["code"], "bad_request")

    def test_generated_scene_endpoint_updates_standard_scene_state(self) -> None:
        status, payload = self.json_request(
            "/api/scene/generate",
            method="POST",
            body=json.dumps({
                "type": "heightfield",
                "pattern": "ripple",
                "grid": 12,
            }).encode("utf-8"),
            content_type="application/json",
        )
        self.assertEqual(status, 200)
        scene = payload["scene"]
        self.assertEqual(scene["name"], "generated-heightfield.obj")
        self.assertEqual(scene["format"], "obj")
        self.assertEqual(scene["generator"]["type"], "heightfield")

        status, state = self.json_request("/api/state")
        self.assertEqual(status, 200)
        stored = state["state"]["workspace"]["scene"]
        self.assertTrue(stored["loaded"])
        self.assertEqual(stored["generator"]["type"], "heightfield")

        scan_status, scan_payload = self.json_request(
            "/api/lidar/scan",
            method="POST",
            body=json.dumps({"width": 160, "height": 120}).encode("utf-8"),
            content_type="application/json",
        )
        self.assertEqual(scan_status, 200)
        self.assertEqual(scan_payload["scan"]["scan_id"], "fake123")

    def test_generated_scene_rejects_unknown_type(self) -> None:
        status, payload = self.json_request(
            "/api/scene/generate",
            method="POST",
            body=json.dumps({"type": "torus"}).encode("utf-8"),
            content_type="application/json",
        )
        self.assertEqual(status, 400)
        self.assertEqual(payload["code"], "bad_request")

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
        self.assertEqual(multiview["current_view"], multiview["order"][-1])
        first = multiview["views"][multiview["order"][0]]
        self.assertEqual(first["view"]["kind"], "auto")

    def test_inspection_scene_and_scan_endpoints(self) -> None:
        self.upload_fake_scene()
        status, scene_payload = self.json_request("/api/inspection/scene")
        self.assertEqual(status, 200)
        self.assertEqual(scene_payload["inspection"]["preview"]["triangle_count"], 2)

        scan_status, scan_payload = self.json_request(
            "/api/lidar/scan",
            method="POST",
            body=json.dumps({"width": 160, "height": 120}).encode("utf-8"),
            content_type="application/json",
        )
        self.assertEqual(scan_status, 200)
        scan_id = scan_payload["scan"]["scan_id"]

        status, inspection_payload = self.json_request(
            f"/api/inspection/scan?scan_id={scan_id}"
        )
        self.assertEqual(status, 200)
        inspection = inspection_payload["inspection"]
        self.assertEqual(inspection["scan_id"], scan_id)
        self.assertEqual(inspection["points"]["preview_count"], 2)
        self.assertEqual(inspection["rays"]["count"], 2)

    def test_3d_ink_projection_endpoint(self) -> None:
        self.upload_fake_scene()
        scan_status, scan_payload = self.json_request(
            "/api/lidar/scan",
            method="POST",
            body=json.dumps({"width": 160, "height": 120}).encode("utf-8"),
            content_type="application/json",
        )
        self.assertEqual(scan_status, 200)
        scan_id = scan_payload["scan"]["scan_id"]
        body = {
            "scan_id": scan_id,
            "width": 160,
            "height": 120,
            "point_counts": [2],
            "points": [70.0, 60.0, 90.0, 60.0],
            "widths": [1.0],
            "rgba": [12, 12, 12, 220],
        }
        status, payload = self.json_request(
            "/api/ink3d/project",
            method="POST",
            body=json.dumps(body).encode("utf-8"),
            content_type="application/json",
        )
        self.assertEqual(status, 200)
        ink = payload["ink3d"]
        self.assertEqual(ink["format"], "lidar-ink-3d-strokes")
        self.assertEqual(ink["scan_id"], scan_id)
        self.assertEqual(ink["stroke_count"], 1)
        self.assertEqual(ink["point_count"], 2)
        self.assertEqual(
            ink["metadata"]["coordinate_space"],
            "normalized-world",
        )

    def test_confidence_fusion_endpoint_and_pngs(self) -> None:
        self.upload_fake_scene()
        fixed_status, fixed_payload = self.json_request(
            "/api/lidar/multiview",
            method="POST",
            body=json.dumps({
                "width": 160,
                "height": 120,
                "rays_per_pixel": 1,
            }).encode("utf-8"),
            content_type="application/json",
        )
        self.assertEqual(fixed_status, 200)
        multiview = fixed_payload["multiview"]
        scan_ids = [
            multiview["views"][name]["scan_id"]
            for name in multiview["order"][:3]
        ]

        status, payload = self.json_request(
            "/api/lidar/fusion",
            method="POST",
            body=json.dumps({"scan_ids": scan_ids}).encode("utf-8"),
            content_type="application/json",
        )
        self.assertEqual(status, 200)
        fusion = payload["fusion"]
        self.assertEqual(fusion["source_count"], 3)
        self.assertEqual(fusion["scan_ids"], scan_ids)
        first = fusion["views"][scan_ids[0]]
        self.assertIn("confidence.png", first["confidence"])
        self.assertIn("support.png", first["support"])

        status, body, content_type = self.request(
            first["confidence"]
        )
        self.assertEqual(status, 200)
        self.assertTrue(body.startswith(PNG))
        self.assertEqual(content_type, "image/png")

    def test_cross_origin_mutation_is_rejected(self) -> None:
        status, payload = self.json_request(
            "/api/reset",
            method="POST",
            body=b"{}",
            content_type="application/json",
            headers={"Origin": "https://evil.example"},
        )
        self.assertEqual(status, 403)
        self.assertEqual(payload["code"], "origin_not_allowed")
        self.assertEqual(self.state.snapshot()["reset_count"], 0)

    def test_same_origin_mutation_is_allowed(self) -> None:
        status, payload = self.json_request(
            "/api/reset",
            method="POST",
            body=b"{}",
            content_type="application/json; charset=utf-8",
            headers={"Origin": self.base},
        )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])

    def test_wrong_post_content_type_is_rejected(self) -> None:
        status, payload = self.json_request(
            "/api/reset",
            method="POST",
            body=b"{}",
            content_type="text/plain",
        )
        self.assertEqual(status, 415)
        self.assertEqual(payload["code"], "unsupported_media_type")
        self.assertEqual(self.state.snapshot()["reset_count"], 0)

        status, payload = self.json_request(
            "/api/scene/upload?filename=cube.obj",
            method="POST",
            body=b"fake obj bytes",
            content_type="text/plain",
        )
        self.assertEqual(status, 415)
        self.assertEqual(payload["code"], "unsupported_media_type")

    def test_deep_json_returns_bad_request_not_internal_error(self) -> None:
        deeply_nested = ('{"x":' * 1200 + "0" + "}" * 1200).encode("utf-8")
        status, payload = self.json_request(
            "/api/lidar/scan",
            method="POST",
            body=deeply_nested,
            content_type="application/json",
        )
        self.assertEqual(status, 400)
        self.assertEqual(payload["code"], "bad_request")

    def test_reset_discards_scene_and_scan(self) -> None:
        self.upload_fake_scene()
        self.json_request(
            "/api/lidar/scan",
            method="POST",
            body=b"{}",
            content_type="application/json",
        )
        status, _ = self.json_request(
            "/api/reset",
            method="POST",
            body=b"{}",
            content_type="application/json",
        )
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

from __future__ import annotations

import io
import types
import unittest
from unittest import mock

import numpy as np
from PIL import Image

from server.lidar_bridge import (
    FIXED_VIEW_ORDER,
    FIXED_VIEWS,
    LidarBridge,
    ScanIdMismatchError,
    _confidence_map,
    _float_option,
    _int_option,
    _load_engine,
    _normalized_scan_options,
    _orient_hit_normals_against_rays,
    _scan_cache_key,
)
from server.state import StudioState


CUBE_OBJ = b"""v -1 -1 -1
v  1 -1 -1
v  1  1 -1
v -1  1 -1
v -1 -1  1
v  1 -1  1
v  1  1  1
v -1  1  1
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 2 6 7 3
f 3 7 8 4
f 5 1 4 8
"""


class ConfidenceMapTest(unittest.TestCase):
    engine = types.SimpleNamespace(np=np)

    def confidence(self, hits, beam, variance, rays_per_pixel, valid=None):
        channels = {
            "hit_count": np.array(hits, dtype=np.float64),
            "beam_coherence": np.array(beam, dtype=np.float64),
            "depth_variance": np.array(variance, dtype=np.float64),
        }
        if valid is not None:
            channels["return_valid_stats"] = np.array(valid, dtype=np.float64)
        return _confidence_map(self.engine, channels, rays_per_pixel)

    def test_unmeasured_coherence_is_neutral_not_zero(self) -> None:
        conf = self.confidence(
            [2, 2], [0.0, 0.0], [0.0, 0.0], rays_per_pixel=2, valid=[0, 0]
        )
        np.testing.assert_allclose(conf, [np.sqrt(0.5)] * 2, rtol=1e-9)

    def test_engine_validity_signal_controls_coherence_measurement(self) -> None:
        conf = self.confidence(
            [4, 4], [0.0, 1.0], [0.0, 0.0], rays_per_pixel=4, valid=[0, 1]
        )
        np.testing.assert_allclose(conf, [1.0, 1.0], atol=1e-9)

    def test_measured_incoherence_still_lowers_confidence(self) -> None:
        conf = self.confidence(
            [4, 4], [0.0, 1.0], [0.0, 0.0], rays_per_pixel=4, valid=[1, 1]
        )
        np.testing.assert_allclose(conf, [0.0, 1.0], atol=1e-9)

    def test_support_grows_with_return_evidence(self) -> None:
        conf = self.confidence(
            [1, 2, 4, 8], [0, 0, 1, 1], [0, 0, 0, 0], rays_per_pixel=1,
            valid=[0, 0, 1, 1],
        )
        self.assertTrue(np.all(np.diff(conf) >= 0))
        self.assertAlmostEqual(float(conf[0]), 0.5)
        self.assertAlmostEqual(float(conf[-1]), 1.0)

    def test_constant_variance_is_not_penalized(self) -> None:
        conf = self.confidence(
            [4, 4], [1.0, 1.0], [0.3, 0.3], rays_per_pixel=4, valid=[1, 1]
        )
        np.testing.assert_allclose(conf, [1.0, 1.0], atol=1e-9)

    def test_varying_variance_still_penalizes_unstable_pixels(self) -> None:
        conf = self.confidence(
            [4, 4, 4], [1, 1, 1], [0.0, 0.0, 5.0], rays_per_pixel=4,
            valid=[1, 1, 1],
        )
        self.assertLess(float(conf[2]), float(conf[0]))

    def test_pixels_without_hits_have_zero_confidence(self) -> None:
        conf = self.confidence(
            [0, 3], [0.0, 0.0], [0.0, 0.0], rays_per_pixel=2, valid=[0, 0]
        )
        self.assertEqual(float(conf[0]), 0.0)
        self.assertGreater(float(conf[1]), 0.0)


class LidarBridgeIntegrationTest(unittest.TestCase):
    def test_obj_to_configurable_lidar_maps(self) -> None:
        state = StudioState()
        bridge = LidarBridge(state)

        scene = bridge.upload_scene("cube.obj", CUBE_OBJ)
        self.assertEqual(scene["triangles"], 12)
        self.assertEqual(scene["vertices"], 8)
        self.assertTrue(state.snapshot()["workspace"]["scene"]["loaded"])
        self.assertEqual(len(scene["sha256"]), 64)

        scan = bridge.scan(
            {
                "width": 64,
                "height": 64,
                "rays_per_pixel": 1,
                "seed": 7,
                "smart_sampling": True,
                "yaw_deg": 25,
                "elevation_deg": 30,
                "distance_scale": 3.4,
                "fov_deg": 50,
            }
        )
        self.assertEqual(scan["width"], 64)
        self.assertEqual(scan["height"], 64)
        self.assertTrue(scan["smart_sampling"])
        self.assertEqual(scan["camera"]["yaw_deg"], 25.0)
        self.assertEqual(scan["camera"]["elevation_deg"], 30.0)
        self.assertEqual(scan["camera"]["distance_scale"], 3.4)
        self.assertEqual(scan["camera"]["fov_deg"], 50.0)
        self.assertGreater(scan["coverage"], 0)
        self.assertEqual(
            set(scan["channels"]),
            {"shaded", "depth", "edge", "variance", "confidence"},
        )

        for channel in ("shaded", "depth", "edge", "variance", "confidence"):
            payload = bridge.channel_png(channel, scan_id=scan["scan_id"])
            self.assertTrue(payload.startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertGreater(len(payload), 32)

        with self.assertRaises(ScanIdMismatchError):
            bridge.channel_png("depth", scan_id="stale-scan")

        shaded = Image.open(
            io.BytesIO(bridge.channel_png("shaded", scan_id=scan["scan_id"]))
        ).convert("RGB")
        object_pixels = [
            pixel for pixel in shaded.getdata()
            if pixel != (255, 255, 255)
        ]
        self.assertGreater(len(object_pixels), 0)
        self.assertGreater(
            len(set(object_pixels)),
            2,
            "sample cube shading collapsed to a flat winding-dependent tone",
        )

    def test_generated_shapes_cross_the_standard_scene_boundary(self) -> None:
        bridge = LidarBridge(StudioState())
        specs = [
            {"type": "sphere", "segments": 12, "rings": 6},
            {"type": "box", "width": 2, "height": 3, "depth": 1.5},
            {"type": "cylinder", "segments": 12, "height": 2.5},
            {
                "type": "lathe",
                "segments": 12,
                "profile": [[0, -1], [0.8, -0.8], [1, 0], [0.6, 0.8], [0, 1]],
            },
            {
                "type": "heightfield",
                "grid": 8,
                "pattern": "ripple",
                "amplitude": 0.5,
                "frequency": 2,
            },
        ]

        hashes = {}
        for spec in specs:
            with self.subTest(kind=spec["type"]):
                scene = bridge.generate_scene(spec)
                self.assertEqual(scene["format"], "obj")
                self.assertTrue(scene["normalized"])
                self.assertEqual(scene["generator"]["type"], spec["type"])
                self.assertEqual(scene["name"], f"generated-{spec['type']}.obj")
                self.assertEqual(len(scene["sha256"]), 64)
                self.assertGreater(scene["triangles"], 0)
                self.assertGreater(scene["vertices"], 0)
                hashes[spec["type"]] = scene["sha256"]

        sphere_again = bridge.generate_scene(specs[0])
        self.assertEqual(sphere_again["sha256"], hashes["sphere"])

    def test_generated_heightfield_scans_and_inspects_normally(self) -> None:
        state = StudioState()
        bridge = LidarBridge(state)
        scene = bridge.generate_scene({
            "type": "heightfield",
            "grid": 10,
            "pattern": "waves",
            "width": 3,
            "depth": 3,
            "amplitude": 0.55,
            "frequency": 2,
        })
        scan = bridge.scan({
            "width": 64,
            "height": 64,
            "rays_per_pixel": 1,
            "smart_sampling": False,
            "seed": 19,
            "yaw_deg": 35,
            "elevation_deg": 30,
        })
        inspection = bridge.inspection_scene()
        scan_inspection = bridge.inspection_scan(scan["scan_id"])

        self.assertEqual(scan["scene"]["sha256"], scene["sha256"])
        self.assertGreater(scan["coverage"], 0)
        self.assertGreater(inspection["preview"]["triangle_count"], 0)
        self.assertGreater(scan_inspection["points"]["preview_count"], 0)

    def test_confidence_is_meaningful_at_default_ray_count(self) -> None:
        results = {}
        for rays in (1, 2, 4):
            bridge = LidarBridge(StudioState())
            bridge.upload_scene("cube.obj", CUBE_OBJ)
            scan = bridge.scan({
                "width": 64,
                "height": 64,
                "rays_per_pixel": rays,
                "smart_sampling": False,
                "seed": 7,
            })
            results[rays] = scan["mean_confidence"]
        self.assertGreater(results[2], 0.3, results)
        self.assertLessEqual(results[1], results[2] + 1e-9, results)
        self.assertLessEqual(results[2], results[4] + 1e-9, results)

    def test_sensor_float_canonicalization_matches_cache_and_camera(self) -> None:
        a = _normalized_scan_options({
            "yaw_deg": 360.0,
            "distance_scale": 3.00000041,
            "elevation_deg": 20.00000041,
            "fov_deg": 55.00000041,
        })
        b = _normalized_scan_options({
            "yaw_deg": 0.0,
            "distance_scale": 3.00000049,
            "elevation_deg": 20.00000049,
            "fov_deg": 55.00000049,
        })
        self.assertEqual(a, b)
        self.assertEqual(a["yaw_deg"], 0.0)
        scene = {"sha256": "a" * 64}
        self.assertEqual(_scan_cache_key(scene, a), _scan_cache_key(scene, b))

        c = _normalized_scan_options({"distance_scale": 3.0000014})
        d = _normalized_scan_options({"distance_scale": 3.0000024})
        self.assertNotEqual(c["distance_scale"], d["distance_scale"])
        self.assertNotEqual(_scan_cache_key(scene, c), _scan_cache_key(scene, d))

    def test_two_sided_normal_orientation_faces_camera(self) -> None:
        engine = _load_engine()
        np = engine.np
        burst = types.SimpleNamespace(
            depths=np.asarray([1.0, 2.0, engine.INF], dtype=np.float64),
            dirs=np.asarray(
                [[0.0, 0.0, 1.0], [0.0, 0.0, 1.0], [0.0, 0.0, 1.0]],
                dtype=np.float64,
            ),
            normals=np.asarray(
                [[0.0, 0.0, 1.0], [0.0, 0.0, -1.0], [0.0, 0.0, 1.0]],
                dtype=np.float64,
            ),
        )

        flipped = _orient_hit_normals_against_rays(engine, burst)

        self.assertEqual(flipped, 1)
        self.assertLessEqual(float(np.dot(burst.normals[0], burst.dirs[0])), 0.0)
        self.assertLessEqual(float(np.dot(burst.normals[1], burst.dirs[1])), 0.0)
        self.assertEqual(burst.normals[2].tolist(), [0.0, 0.0, 1.0])

    def test_rejects_nonfinite_and_degenerate_meshes(self) -> None:
        state = StudioState()
        bridge = LidarBridge(state)

        bad_nan = b"""v nan 0 0
v 1 0 0
v 0 1 0
f 1 2 3
"""
        with self.assertRaisesRegex(ValueError, "non-finite"):
            bridge.upload_scene("bad.obj", bad_nan)
        self.assertIsNone(state.get_scene_object())

        degenerate = b"""v 1 1 1
v 1 1 1
v 1 1 1
f 1 2 3
"""
        with self.assertRaisesRegex(ValueError, "near-zero"):
            bridge.upload_scene("flat.obj", degenerate)
        self.assertIsNone(state.get_scene_object())

    def test_invalid_upload_preserves_previous_scene(self) -> None:
        state = StudioState()
        bridge = LidarBridge(state)
        bridge.upload_scene("cube.obj", CUBE_OBJ)
        previous = state.snapshot()["workspace"]["scene"]

        with self.assertRaisesRegex(ValueError, "non-finite"):
            bridge.upload_scene(
                "bad.obj",
                b"v nan 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
            )

        current = state.snapshot()["workspace"]["scene"]
        self.assertEqual(current["name"], previous["name"])
        self.assertEqual(current["sha256"], previous["sha256"])
        self.assertIsNotNone(state.get_scene_object())

    def test_fixed_multiview_uses_named_cached_single_view_scans(self) -> None:
        state = StudioState()
        bridge = LidarBridge(state)
        bridge.upload_scene("cube.obj", CUBE_OBJ)
        options = {
            "width": 64,
            "height": 64,
            "rays_per_pixel": 1,
            "seed": 19,
            "smart_sampling": False,
            "distance_scale": 3.0,
            "fov_deg": 55,
        }

        first = bridge.scan_fixed_views(options)
        self.assertEqual(first["order"], list(FIXED_VIEW_ORDER))
        self.assertEqual(set(first["views"]), set(FIXED_VIEW_ORDER))
        self.assertEqual(state.scan_cache_stats()["entries"], 5)

        first_ids = {}
        for name in FIXED_VIEW_ORDER:
            scan = first["views"][name]
            descriptor = FIXED_VIEWS[name]
            first_ids[name] = scan["scan_id"]
            self.assertFalse(scan["cache_hit"])
            self.assertEqual(scan["view"]["name"], name)
            self.assertEqual(scan["camera"]["yaw_deg"], descriptor["yaw_deg"])
            self.assertEqual(
                scan["camera"]["elevation_deg"],
                descriptor["elevation_deg"],
            )

        # The final current scan is Top, but earlier fixed views must remain
        # independently inspectable from the bounded Phase 11 cache.
        front_depth = bridge.channel_png(
            "depth",
            scan_id=first["views"]["front"]["scan_id"],
        )
        self.assertTrue(front_depth.startswith(b"\x89PNG\r\n\x1a\n"))
        front_summary = bridge.maps_summary(
            scan_id=first["views"]["front"]["scan_id"]
        )
        self.assertEqual(front_summary["scan_id"], first["views"]["front"]["scan_id"])

        with mock.patch(
            "server.lidar_bridge._load_engine",
            side_effect=AssertionError(
                "repeat fixed multi-view should come entirely from scan cache"
            ),
        ):
            second = bridge.scan_fixed_views(options)

        for name in FIXED_VIEW_ORDER:
            self.assertTrue(second["views"][name]["cache_hit"])
            self.assertEqual(second["views"][name]["scan_id"], first_ids[name])

        stats = state.scan_cache_stats()
        self.assertEqual(stats["entries"], 5)
        self.assertEqual(stats["misses"], 5)
        self.assertEqual(stats["hits"], 5)

    def test_inspection_snapshots_use_loaded_mesh_and_cached_scan_without_engine(self) -> None:
        state = StudioState()
        bridge = LidarBridge(state)
        bridge.upload_scene("cube.obj", CUBE_OBJ)
        scan = bridge.scan({
            "width": 64,
            "height": 64,
            "rays_per_pixel": 1,
            "seed": 29,
            "smart_sampling": False,
            "yaw_deg": 35,
            "elevation_deg": 25,
            "distance_scale": 3.0,
            "fov_deg": 55,
        })

        with mock.patch(
            "server.lidar_bridge._load_engine",
            side_effect=AssertionError(
                "inspection must use the normalized scene and cached scan evidence"
            ),
        ):
            scene_snapshot = bridge.inspection_scene()
            scan_snapshot = bridge.inspection_scan(scan["scan_id"])

        self.assertEqual(scene_snapshot["scene"]["name"], "cube.obj")
        self.assertGreater(scene_snapshot["preview"]["triangle_count"], 0)
        self.assertLessEqual(
            scene_snapshot["preview"]["triangle_count"],
            scene_snapshot["preview"]["source_triangle_count"],
        )
        self.assertEqual(scan_snapshot["scan_id"], scan["scan_id"])
        self.assertGreater(scan_snapshot["points"]["source_count"], 0)
        self.assertGreater(scan_snapshot["points"]["preview_count"], 0)
        self.assertGreater(scan_snapshot["rays"]["count"], 0)

    def test_3d_ink_projects_existing_strokes_without_firing_new_lidar(self) -> None:
        state = StudioState()
        bridge = LidarBridge(state)
        bridge.upload_scene("cube.obj", CUBE_OBJ)
        scan = bridge.scan({
            "width": 64,
            "height": 64,
            "rays_per_pixel": 1,
            "seed": 37,
            "smart_sampling": False,
            "yaw_deg": 0,
            "elevation_deg": 20,
            "distance_scale": 3.0,
            "fov_deg": 55,
        })
        payload = {
            "scan_id": scan["scan_id"],
            "width": 64,
            "height": 64,
            "max_segment_pixels": 2.0,
            "point_counts": [3],
            "points": [27.0, 32.0, 32.0, 32.0, 37.0, 32.0],
            "widths": [1.0],
            "rgba": [12, 12, 12, 220],
        }

        with mock.patch(
            "vendor.lidar_engine.fire_burst",
            side_effect=AssertionError("3D Ink must not fire LiDAR"),
        ), mock.patch(
            "vendor.lidar_engine.scout_then_fill",
            side_effect=AssertionError("3D Ink must not run smart LiDAR sampling"),
        ):
            ink = bridge.project_ink3d(payload)

        self.assertEqual(ink["scan_id"], scan["scan_id"])
        self.assertGreater(ink["stroke_count"], 0)
        self.assertGreater(ink["point_count"], 2)
        self.assertEqual(ink["metadata"]["coordinate_space"], "normalized-world")
        self.assertEqual(
            ink["metadata"]["confidence_source"],
            "selected-scan-cached-confidence",
        )

    def test_confidence_fusion_rebuilds_from_cached_scan_evidence_without_engine(self) -> None:
        state = StudioState()
        bridge = LidarBridge(state)
        bridge.upload_scene("cube.obj", CUBE_OBJ)
        multiview = bridge.scan_fixed_views({
            "width": 64,
            "height": 64,
            "rays_per_pixel": 2,
            "seed": 31,
            "smart_sampling": False,
            "distance_scale": 3.0,
            "fov_deg": 55,
        })
        scan_ids = [multiview["views"][name]["scan_id"] for name in multiview["order"]]

        first = bridge.fuse_scan_confidence(scan_ids)
        self.assertEqual(first["source_count"], 5)
        self.assertFalse(first["cache_hit"])
        self.assertEqual(set(first["views"]), set(scan_ids))
        for scan_id in scan_ids:
            view = first["views"][scan_id]
            self.assertGreaterEqual(view["mean_confidence"], 0)
            self.assertLessEqual(view["mean_confidence"], 1)
            confidence = bridge.fusion_png(first["fusion_id"], scan_id, "confidence")
            support = bridge.fusion_png(first["fusion_id"], scan_id, "support")
            self.assertTrue(confidence.startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertTrue(support.startswith(b"\x89PNG\r\n\x1a\n"))

        bridge.clear_fusion_cache()
        with mock.patch(
            "server.lidar_bridge._load_engine",
            side_effect=AssertionError(
                "confidence fusion must rebuild from cached evidence without LiDAR engine"
            ),
        ):
            second = bridge.fuse_scan_confidence(scan_ids)

        self.assertFalse(second["cache_hit"])
        self.assertEqual(second["fusion_id"], first["fusion_id"])
        self.assertEqual(second["scan_ids"], first["scan_ids"])

        third = bridge.fuse_scan_confidence(scan_ids)
        self.assertTrue(third["cache_hit"])

    def test_scan_cache_byte_accounting_includes_fusion_evidence(self) -> None:
        state = StudioState(scan_cache_limit_bytes=10_000, scan_cache_max_entries=2)
        state.put_cached_scan(
            "key",
            {"scan_id": "scan"},
            {"shaded": b"a" * 100},
            b"e" * 250,
        )
        self.assertEqual(state.scan_cache_stats()["bytes"], 350)

    def test_auto_views_are_deterministic_inspectable_and_cache_reusable(self) -> None:
        state = StudioState()
        bridge = LidarBridge(state)
        bridge.upload_scene("cube.obj", CUBE_OBJ)
        options = {
            "width": 64,
            "height": 64,
            "rays_per_pixel": 1,
            "seed": 23,
            "smart_sampling": False,
            "distance_scale": 3.0,
            "fov_deg": 55,
            "auto_target": 0.98,
            "auto_min_views": 3,
            "auto_max_views": 4,
            "auto_min_gain": 0.0,
        }

        first = bridge.scan_auto_views(options)
        self.assertEqual(first["mode"], "auto")
        self.assertEqual(len(first["order"]), 4)
        self.assertEqual(first["planner"]["stop_reason"], "max_views")
        self.assertGreater(first["planner"]["coverage_score"], 0)
        self.assertEqual(len(first["planner"]["steps"]), 4)
        self.assertEqual(first["current_view"], first["order"][-1])
        self.assertGreater(first["planner"]["steps"][0]["expected_gain"], 0)

        current_scan = state.get_scan()
        self.assertIsNotNone(current_scan)
        self.assertEqual(
            current_scan["metadata"]["scan_id"],
            first["views"][first["current_view"]]["scan_id"],
        )

        first_ids = [first["views"][name]["scan_id"] for name in first["order"]]
        self.assertEqual(len(set(first_ids)), 4)
        for name in first["order"]:
            scan = first["views"][name]
            self.assertEqual(scan["view"]["kind"], "auto")
            self.assertGreaterEqual(scan["view"]["quality_score"], 0)
            self.assertLessEqual(scan["view"]["quality_score"], 1)
            depth = bridge.channel_png("depth", scan_id=scan["scan_id"])
            self.assertTrue(depth.startswith(b"\x89PNG\r\n\x1a\n"))

        with mock.patch(
            "server.lidar_bridge._load_engine",
            side_effect=AssertionError(
                "repeat auto-view scan should come entirely from scan cache"
            ),
        ):
            second = bridge.scan_auto_views(options)

        self.assertEqual(second["order"], first["order"])
        for index, name in enumerate(second["order"]):
            self.assertTrue(second["views"][name]["cache_hit"])
            self.assertEqual(second["views"][name]["scan_id"], first_ids[index])

    def test_identical_scan_reuses_cache_without_engine(self) -> None:
        state = StudioState()
        bridge = LidarBridge(state)
        bridge.upload_scene("cube.obj", CUBE_OBJ)
        options = {
            "width": 64,
            "height": 64,
            "rays_per_pixel": 1,
            "seed": 17,
            "smart_sampling": False,
            "yaw_deg": 35,
            "elevation_deg": 25,
            "distance_scale": 3.1,
            "fov_deg": 52,
        }

        first = bridge.scan(options)
        first_channels = {
            name: bridge.channel_png(name, scan_id=first["scan_id"])
            for name in ("shaded", "depth", "edge", "variance", "confidence")
        }
        self.assertFalse(first["cache_hit"])

        with mock.patch(
            "server.lidar_bridge._load_engine",
            side_effect=AssertionError("cache hit should not load or run the LiDAR engine"),
        ):
            second = bridge.scan(options)

        self.assertTrue(second["cache_hit"])
        self.assertEqual(second["scan_id"], first["scan_id"])
        self.assertEqual(second["cache_key"], first["cache_key"])
        for name, payload in first_channels.items():
            self.assertEqual(
                bridge.channel_png(name, scan_id=second["scan_id"]),
                payload,
            )

        stats = state.scan_cache_stats()
        self.assertEqual(stats["entries"], 1)
        self.assertEqual(stats["hits"], 1)
        self.assertEqual(stats["misses"], 1)

    def test_every_sensor_input_changes_cache_key(self) -> None:
        state = StudioState()
        bridge = LidarBridge(state)
        scene = bridge.upload_scene("cube.obj", CUBE_OBJ)

        base = _normalized_scan_options({
            "width": 160,
            "height": 120,
            "rays_per_pixel": 2,
            "seed": 42,
            "smart_sampling": False,
            "yaw_deg": 45,
            "elevation_deg": 20,
            "distance_scale": 3.0,
            "fov_deg": 55,
        })
        base_key = _scan_cache_key(scene, base)

        variants = {
            "width": 200,
            "height": 160,
            "rays_per_pixel": 4,
            "seed": 43,
            "smart_sampling": True,
            "yaw_deg": 46,
            "elevation_deg": 21,
            "distance_scale": 3.2,
            "fov_deg": 56,
        }
        for name, value in variants.items():
            changed = dict(base)
            changed[name] = value
            self.assertNotEqual(
                _scan_cache_key(scene, changed),
                base_key,
                f"{name} did not change the scan cache key",
            )

    def test_same_filename_different_model_bytes_do_not_collide(self) -> None:
        state = StudioState()
        bridge = LidarBridge(state)
        options = {"width": 64, "height": 64, "rays_per_pixel": 1}

        first_scene = bridge.upload_scene("model.obj", CUBE_OBJ)
        first = bridge.scan(options)

        changed_obj = CUBE_OBJ.replace(b"v  1  1  1", b"v  1.2  1  1")
        second_scene = bridge.upload_scene("model.obj", changed_obj)
        self.assertNotEqual(first_scene["sha256"], second_scene["sha256"])

        with mock.patch(
            "server.lidar_bridge._load_engine",
            side_effect=RuntimeError("expected cache miss for changed model"),
        ):
            with self.assertRaisesRegex(RuntimeError, "expected cache miss"):
                bridge.scan(options)

        self.assertEqual(state.scan_cache_stats()["entries"], 1)
        self.assertFalse(state.get_scan())

    def test_reset_clears_scan_cache(self) -> None:
        state = StudioState()
        bridge = LidarBridge(state)
        bridge.upload_scene("cube.obj", CUBE_OBJ)
        bridge.scan({"width": 64, "height": 64, "rays_per_pixel": 1})
        self.assertEqual(state.scan_cache_stats()["entries"], 1)

        state.reset()

        self.assertEqual(
            state.scan_cache_stats(),
            {
                "entries": 0,
                "bytes": 0,
                "limit_bytes": state.scan_cache_stats()["limit_bytes"],
                "max_entries": state.scan_cache_stats()["max_entries"],
                "hits": 0,
                "misses": 0,
                "evictions": 0,
            },
        )

    def test_scan_cache_is_bounded_lru(self) -> None:
        state = StudioState(scan_cache_limit_bytes=10_000, scan_cache_max_entries=2)
        dummy = {"shaded": b"a" * 100}
        for i in range(3):
            state.put_cached_scan(
                f"key-{i}",
                {"scan_id": f"scan-{i}"},
                dummy,
            )

        stats = state.scan_cache_stats()
        self.assertEqual(stats["entries"], 2)
        self.assertEqual(stats["evictions"], 1)
        self.assertIsNone(state.get_cached_scan("key-0"))
        self.assertIsNotNone(state.get_cached_scan("key-1"))
        self.assertIsNotNone(state.get_cached_scan("key-2"))

    def test_camera_and_scan_options_are_clamped(self) -> None:
        options = {
            "width": 9999,
            "height": 9999,
            "rays_per_pixel": 99,
            "yaw_deg": 999,
            "elevation_deg": -100,
            "distance_scale": 99,
            "fov_deg": 5,
        }
        self.assertEqual(_int_option(options, "width", 320, 64, 640), 640)
        self.assertEqual(_int_option(options, "height", 240, 64, 480), 480)
        self.assertEqual(_int_option(options, "rays_per_pixel", 2, 1, 4), 4)
        self.assertEqual(_float_option(options, "yaw_deg", 45, 0, 360), 360.0)
        self.assertEqual(_float_option(options, "elevation_deg", 20, 5, 80), 5.0)
        self.assertEqual(_float_option(options, "distance_scale", 3, 1.4, 6), 6.0)
        self.assertEqual(_float_option(options, "fov_deg", 55, 25, 90), 25.0)


if __name__ == "__main__":
    unittest.main()

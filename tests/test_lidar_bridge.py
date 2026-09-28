from __future__ import annotations

import unittest

from server.lidar_bridge import LidarBridge, _float_option, _int_option
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

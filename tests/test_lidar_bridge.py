from __future__ import annotations

import unittest

from server.lidar_bridge import LidarBridge
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
    def test_obj_to_lidar_maps(self) -> None:
        state = StudioState()
        bridge = LidarBridge(state)

        scene = bridge.upload_scene("cube.obj", CUBE_OBJ)
        self.assertEqual(scene["triangles"], 12)
        self.assertEqual(scene["vertices"], 8)
        self.assertTrue(state.snapshot()["workspace"]["scene"]["loaded"])

        scan = bridge.scan(
            {
                "width": 64,
                "height": 64,
                "rays_per_pixel": 1,
                "seed": 7,
            }
        )
        self.assertEqual(scan["width"], 64)
        self.assertEqual(scan["height"], 64)
        self.assertGreater(scan["coverage"], 0)
        self.assertEqual(set(scan["channels"]), {"shaded", "depth", "edge"})

        for channel in ("shaded", "depth", "edge"):
            payload = bridge.channel_png(channel)
            self.assertTrue(payload.startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertGreater(len(payload), 32)


if __name__ == "__main__":
    unittest.main()

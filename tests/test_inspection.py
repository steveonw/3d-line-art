from __future__ import annotations

import unittest

import numpy as np

from server.confidence_fusion import encode_scan_evidence
from server.inspection import scene_inspection_snapshot, scan_inspection_snapshot


class FakeMesh:
    def __init__(self, vertices, faces):
        self.vertices = np.asarray(vertices, dtype=np.float64)
        self.faces = np.asarray(faces, dtype=np.int64)


class FakeScene:
    def __init__(self, meshes):
        self.meshes = meshes


def scan(scan_id: str = "scan-a") -> dict:
    depth = np.zeros((5, 5), dtype=np.float64)
    confidence = np.zeros((5, 5), dtype=np.float64)
    depth[2, 2] = 5.0
    confidence[2, 2] = 0.8
    return {
        "metadata": {
            "scan_id": scan_id,
            "width": 5,
            "height": 5,
            "camera": {
                "fov_deg": 90.0,
                "yaw_deg": 0.0,
                "elevation_deg": 20.0,
            },
            "camera_position": [0.0, 0.0, -5.0],
            "camera_target": [0.0, 0.0, 0.0],
            "scene": {"sha256": "a" * 64},
        },
        "evidence": encode_scan_evidence(depth, confidence),
    }


class InspectionSnapshotTest(unittest.TestCase):
    def test_scene_preview_is_bounded_and_deterministic(self) -> None:
        vertices = []
        faces = []
        for i in range(30):
            base = len(vertices)
            vertices.extend([
                [float(i), 0.0, 0.0],
                [float(i), 1.0, 0.0],
                [float(i), 0.0, 1.0],
            ])
            faces.append([base, base + 1, base + 2])
        scene = FakeScene([FakeMesh(vertices, faces)])
        info = {
            "name": "many.obj",
            "sha256": "a" * 64,
            "triangles": 30,
            "vertices": len(vertices),
            "bounds_min": [0.0, 0.0, 0.0],
            "bounds_max": [29.0, 1.0, 1.0],
        }

        first = scene_inspection_snapshot(scene, info, max_triangles=7)
        second = scene_inspection_snapshot(scene, info, max_triangles=7)
        self.assertEqual(first, second)
        self.assertEqual(first["preview"]["triangle_count"], 7)
        self.assertEqual(first["preview"]["source_triangle_count"], 30)
        self.assertEqual(len(first["preview"]["positions"]), 7 * 9)

    def test_scan_preview_contains_world_hit_point_and_ray(self) -> None:
        snapshot = scan_inspection_snapshot(scan(), max_points=10, max_rays=10)
        self.assertEqual(snapshot["scan_id"], "scan-a")
        self.assertEqual(snapshot["points"]["source_count"], 1)
        self.assertEqual(snapshot["points"]["preview_count"], 1)
        self.assertEqual(snapshot["rays"]["count"], 1)
        self.assertEqual(len(snapshot["points"]["positions"]), 3)
        self.assertEqual(len(snapshot["rays"]["positions"]), 6)
        point = snapshot["points"]["positions"]
        self.assertAlmostEqual(point[0], 0.0, places=5)
        self.assertAlmostEqual(point[1], 0.0, places=5)
        self.assertAlmostEqual(point[2], 0.0, places=5)
        self.assertGreater(snapshot["points"]["confidence"][0], 190)

    def test_scan_preview_is_bounded(self) -> None:
        depth = np.full((20, 20), 5.0, dtype=np.float64)
        confidence = np.full((20, 20), 0.5, dtype=np.float64)
        stored = scan("dense")
        stored["metadata"]["width"] = 20
        stored["metadata"]["height"] = 20
        stored["evidence"] = encode_scan_evidence(depth, confidence)
        snapshot = scan_inspection_snapshot(stored, max_points=25, max_rays=9)
        self.assertEqual(snapshot["points"]["source_count"], 400)
        self.assertEqual(snapshot["points"]["preview_count"], 25)
        self.assertEqual(snapshot["rays"]["count"], 9)


if __name__ == "__main__":
    unittest.main()

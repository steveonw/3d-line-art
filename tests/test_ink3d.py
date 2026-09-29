from __future__ import annotations

import unittest

import numpy as np

from server.confidence_fusion import encode_scan_evidence
from server.ink3d import (
    INK3D_FORMAT,
    INK3D_VERSION,
    project_strokes_to_mesh,
)
from vendor import lidar_engine as engine


def cube_scene() -> engine.Scene:
    vertices = np.asarray([
        [-1.0, 0.0, -1.0],
        [1.0, 0.0, -1.0],
        [1.0, 2.0, -1.0],
        [-1.0, 2.0, -1.0],
        [-1.0, 0.0, 1.0],
        [1.0, 0.0, 1.0],
        [1.0, 2.0, 1.0],
        [-1.0, 2.0, 1.0],
    ], dtype=np.float64)
    faces = np.asarray([
        [0, 2, 1], [0, 3, 2],
        [4, 5, 6], [4, 6, 7],
        [0, 4, 7], [0, 7, 3],
        [1, 2, 6], [1, 6, 5],
        [3, 7, 6], [3, 6, 2],
        [0, 1, 5], [0, 5, 4],
    ], dtype=np.int64)
    mesh = engine.Mesh(
        vertices=vertices,
        faces=faces,
        color=(0.25, 0.5, 0.75),
        piece_id=1000,
    )
    return engine.Scene(meshes=[mesh])


def stored_scan(width: int = 100, height: int = 100) -> dict:
    depth = np.full((height, width), np.inf, dtype=np.float64)
    confidence = np.zeros((height, width), dtype=np.float64)
    depth[30:70, 30:70] = 4.0
    confidence[30:70, 30:70] = 0.8
    return {
        "metadata": {
            "scan_id": "scan-cube",
            "width": width,
            "height": height,
            "camera": {"fov_deg": 60.0},
            "camera_position": [0.0, 1.0, -5.0],
            "camera_target": [0.0, 1.0, 0.0],
            "scene": {"sha256": "a" * 64},
        },
        "evidence": encode_scan_evidence(depth, confidence),
    }


def payload() -> dict:
    return {
        "scan_id": "scan-cube",
        "width": 100,
        "height": 100,
        "max_segment_pixels": 2.0,
        "point_counts": [3],
        "points": [42.0, 50.0, 50.0, 50.0, 58.0, 50.0],
        "widths": [1.25],
        "rgba": [12, 18, 24, 180],
    }


class Ink3DProjectionTest(unittest.TestCase):
    def test_projects_2d_path_to_real_cube_surface_with_world_metadata(self) -> None:
        result = project_strokes_to_mesh(
            cube_scene(),
            stored_scan(),
            payload(),
            engine=engine,
        )
        self.assertEqual(result["format"], INK3D_FORMAT)
        self.assertEqual(result["version"], INK3D_VERSION)
        self.assertEqual(result["scan_id"], "scan-cube")
        self.assertGreaterEqual(result["stroke_count"], 1)
        self.assertGreater(result["point_count"], 3)
        self.assertEqual(len(result["positions"]), result["point_count"] * 3)
        self.assertEqual(len(result["normals"]), result["point_count"] * 3)
        self.assertEqual(len(result["tangents"]), result["point_count"] * 3)
        self.assertEqual(len(result["depth"]), result["point_count"])
        self.assertEqual(len(result["confidence"]), result["point_count"])
        self.assertEqual(len(result["material_rgb"]), result["point_count"] * 3)
        self.assertEqual(len(result["piece_ids"]), result["point_count"])

        positions = np.asarray(result["positions"], dtype=np.float64).reshape(-1, 3)
        normals = np.asarray(result["normals"], dtype=np.float64).reshape(-1, 3)
        tangents = np.asarray(result["tangents"], dtype=np.float64).reshape(-1, 3)

        self.assertTrue(np.allclose(positions[:, 2], -1.0, atol=2e-4))
        self.assertTrue(np.all(np.asarray(result["depth"]) > 0))
        self.assertTrue(np.all(np.asarray(result["confidence"]) >= 200))
        self.assertTrue(np.all(np.asarray(result["piece_ids"]) == 1000))
        self.assertTrue(np.all(np.abs(np.sum(normals * tangents, axis=1)) < 2e-4))
        self.assertTrue(np.allclose(np.linalg.norm(tangents, axis=1), 1.0, atol=2e-4))
        material = np.asarray(result["material_rgb"]).reshape(-1, 3)
        self.assertTrue(np.all(material == np.asarray([64, 128, 191])))

    def test_projection_is_deterministic(self) -> None:
        first = project_strokes_to_mesh(cube_scene(), stored_scan(), payload(), engine=engine)
        second = project_strokes_to_mesh(cube_scene(), stored_scan(), payload(), engine=engine)
        self.assertEqual(first, second)

    def test_rejects_scan_dimension_mismatch(self) -> None:
        bad = payload()
        bad["width"] = 99
        with self.assertRaisesRegex(ValueError, "dimensions"):
            project_strokes_to_mesh(cube_scene(), stored_scan(), bad, engine=engine)

    def test_rejects_more_than_bounded_stroke_count(self) -> None:
        bad = payload()
        bad["point_counts"] = [2] * 5001
        bad["points"] = [50.0, 50.0] * (5001 * 2)
        bad["widths"] = [1.0] * 5001
        bad["rgba"] = [0, 0, 0, 255] * 5001
        with self.assertRaisesRegex(ValueError, "at most 5000 strokes"):
            project_strokes_to_mesh(cube_scene(), stored_scan(), bad, engine=engine)


if __name__ == "__main__":
    unittest.main()

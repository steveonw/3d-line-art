from __future__ import annotations

import unittest

import numpy as np

from server.scene_transform import (
    DEFAULT_MODEL_TRANSFORM,
    geometry_fingerprint,
    normalize_model_transform,
    transform_scene,
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
        color=(0.5, 0.5, 0.5),
        piece_id=1000,
    )
    return engine.Scene(meshes=[mesh])


class SceneTransformTest(unittest.TestCase):
    def test_transform_rotates_about_center_then_translates_and_scales(self) -> None:
        base = cube_scene()
        original = base.meshes[0].vertices.copy()
        transformed, canonical = transform_scene(
            engine,
            base,
            {
                "position": {"x": 3, "y": -2, "z": 4},
                "rotation": {"x": 0, "y": 0, "z": 90},
                "scale": 2,
            },
        )

        self.assertEqual(
            canonical,
            {
                "position": {"x": 3.0, "y": -2.0, "z": 4.0},
                "rotation": {"x": 0.0, "y": 0.0, "z": 90.0},
                "scale": 2.0,
            },
        )
        # Base scene is immutable.
        self.assertTrue(np.array_equal(base.meshes[0].vertices, original))

        verts = transformed.meshes[0].vertices
        # Base center is (0, 1, 0), so transformed center is translated only.
        center = (verts.min(axis=0) + verts.max(axis=0)) * 0.5
        self.assertTrue(np.allclose(center, [3.0, -1.0, 4.0], atol=1e-9))
        # Cube span doubles under uniform scale; rotation preserves span here.
        self.assertTrue(np.allclose(verts.max(axis=0) - verts.min(axis=0), [4, 4, 4]))

    def test_identity_restores_exact_base_vertices(self) -> None:
        base = cube_scene()
        transformed, canonical = transform_scene(engine, base, DEFAULT_MODEL_TRANSFORM)
        self.assertEqual(canonical, DEFAULT_MODEL_TRANSFORM)
        self.assertTrue(
            np.array_equal(
                transformed.meshes[0].vertices,
                base.meshes[0].vertices,
            )
        )

    def test_normalization_wraps_rotation_and_bounds_values(self) -> None:
        value = normalize_model_transform({
            "position": {"x": 1.25, "y": -2, "z": 3},
            "rotation": {"x": 360, "y": 270, "z": -540},
            "scale": 1.5,
        })
        self.assertEqual(value["rotation"]["x"], 0.0)
        self.assertEqual(value["rotation"]["y"], -90.0)
        self.assertEqual(value["rotation"]["z"], -180.0)

        with self.assertRaisesRegex(ValueError, "position.x"):
            normalize_model_transform({"position": {"x": 25}})
        with self.assertRaisesRegex(ValueError, "scale"):
            normalize_model_transform({"scale": 0})

    def test_geometry_fingerprint_changes_with_pose_but_source_does_not(self) -> None:
        source = "a" * 64
        base = geometry_fingerprint(source, DEFAULT_MODEL_TRANSFORM)
        rotated = geometry_fingerprint(
            source,
            {"rotation": {"y": 45}},
        )
        same_rotated = geometry_fingerprint(
            source,
            {"rotation": {"y": 405}},
        )
        self.assertNotEqual(base, rotated)
        self.assertEqual(rotated, same_rotated)


if __name__ == "__main__":
    unittest.main()

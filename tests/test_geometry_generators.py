from __future__ import annotations

import hashlib
import unittest

from server.geometry_generators import generate_obj


def counts(raw: bytes) -> tuple[int, int]:
    lines = raw.decode("utf-8").splitlines()
    vertices = sum(1 for line in lines if line.startswith("v "))
    faces = sum(1 for line in lines if line.startswith("f "))
    return vertices, faces


class GeometryGeneratorTest(unittest.TestCase):
    def test_box_counts_and_determinism(self) -> None:
        spec = {"type": "box", "width": 2, "height": 3, "depth": 4}
        name1, canonical1, raw1 = generate_obj(spec)
        name2, canonical2, raw2 = generate_obj(spec)
        self.assertEqual(name1, "generated-box.obj")
        self.assertEqual(canonical1, canonical2)
        self.assertEqual(raw1, raw2)
        self.assertEqual(counts(raw1), (8, 12))

    def test_sphere_counts(self) -> None:
        _, canonical, raw = generate_obj(
            {"type": "sphere", "radius": 1.5, "segments": 12, "rings": 6}
        )
        self.assertEqual(canonical["segments"], 12)
        self.assertEqual(canonical["rings"], 6)
        self.assertEqual(counts(raw), (2 + 5 * 12, 2 * 12 * 5))

    def test_cylinder_counts(self) -> None:
        _, _, raw = generate_obj(
            {"type": "cylinder", "radius": 1, "height": 2.5, "segments": 10}
        )
        self.assertEqual(counts(raw), (22, 40))

    def test_lathe_profile_counts_and_canonicalization(self) -> None:
        spec = {
            "type": "lathe",
            "segments": 12,
            "profile": [
                [0, -1],
                [0.75, -0.8],
                [1, 0],
                [0.5, 0.8],
                [0, 1],
            ],
        }
        _, canonical, raw = generate_obj(spec)
        # Two poles + three 12-vertex rings.
        self.assertEqual(counts(raw), (38, 72))
        self.assertEqual(canonical["profile"][2], [1.0, 0.0])

    def test_heightfield_is_closed_and_bounded(self) -> None:
        _, canonical, raw = generate_obj(
            {
                "type": "heightfield",
                "width": 4,
                "depth": 3,
                "amplitude": 0.6,
                "frequency": 2.5,
                "grid": 4,
                "pattern": "ripple",
            }
        )
        self.assertEqual(canonical["pattern"], "ripple")
        self.assertEqual(counts(raw), (50, 96))

    def test_different_specs_produce_different_content_hashes(self) -> None:
        _, _, sphere = generate_obj({"type": "sphere", "radius": 1})
        _, _, larger = generate_obj({"type": "sphere", "radius": 1.1})
        self.assertNotEqual(hashlib.sha256(sphere).digest(), hashlib.sha256(larger).digest())

    def test_rejects_invalid_generator_and_profile(self) -> None:
        with self.assertRaisesRegex(ValueError, "type must be"):
            generate_obj({"type": "torus"})
        with self.assertRaisesRegex(ValueError, "profile"):
            generate_obj({"type": "lathe", "profile": [[0, 0]]})
        with self.assertRaisesRegex(ValueError, "positive radius"):
            generate_obj({"type": "lathe", "profile": [[0, 0], [0, 1]]})
        with self.assertRaisesRegex(ValueError, "grid"):
            generate_obj({"type": "heightfield", "grid": 1000})


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import unittest

import numpy as np

from server.confidence_fusion import (
    decode_scan_evidence,
    encode_scan_evidence,
    fuse_confidence,
)


def scan(
    scan_id: str,
    confidence: float,
    *,
    scene_hash: str = "a" * 64,
    camera_position=(0.0, 0.0, 0.0),
    camera_target=(0.0, 0.0, 1.0),
    depth_value: float = 5.0,
) -> dict:
    depth = np.zeros((5, 5), dtype=np.float64)
    depth[2, 2] = depth_value
    conf = np.zeros((5, 5), dtype=np.float64)
    conf[2, 2] = confidence
    metadata = {
        "scan_id": scan_id,
        "width": 5,
        "height": 5,
        "camera": {"fov_deg": 90.0},
        "camera_position": list(camera_position),
        "camera_target": list(camera_target),
        "scene": {"sha256": scene_hash},
    }
    return {
        "metadata": metadata,
        "evidence": encode_scan_evidence(depth, conf),
    }


class ConfidenceFusionTest(unittest.TestCase):
    def test_evidence_round_trip(self) -> None:
        depth = np.asarray([[0.0, 1.25], [2.5, 0.0]], dtype=np.float64)
        confidence = np.asarray([[0.0, 0.25], [0.75, 1.0]], dtype=np.float64)
        payload = encode_scan_evidence(depth, confidence)
        restored_depth, restored_conf = decode_scan_evidence(payload)
        np.testing.assert_allclose(restored_depth, depth, atol=1e-6)
        np.testing.assert_allclose(restored_conf, confidence, atol=1 / 255 + 1e-9)

    def test_single_source_is_not_artificially_boosted(self) -> None:
        one = fuse_confidence([scan("a", 0.5)], "a")
        self.assertAlmostEqual(float(one["confidence"][2, 2]), 0.5, delta=1 / 255)

    def test_multi_source_agreement_increases_confidence(self) -> None:
        one = fuse_confidence([scan("a", 0.5)], "a")
        two = fuse_confidence([scan("a", 0.5), scan("b", 0.5)], "a")
        self.assertGreater(two["mean_confidence"], one["mean_confidence"])
        self.assertEqual(int(two["support"][2, 2]), 2)
        self.assertGreater(float(two["confidence"][2, 2]), 0.5)

    def test_different_cameras_reproject_shared_world_point(self) -> None:
        front = scan(
            "front",
            0.6,
            camera_position=(0.0, 0.0, -5.0),
            camera_target=(0.0, 0.0, 0.0),
            depth_value=5.0,
        )
        side = scan(
            "side",
            0.7,
            camera_position=(5.0, 0.0, 0.0),
            camera_target=(0.0, 0.0, 0.0),
            depth_value=5.0,
        )
        fused = fuse_confidence([front, side], "front")
        self.assertEqual(int(fused["support"][2, 2]), 2)
        self.assertGreater(float(fused["confidence"][2, 2]), 0.7)

    def test_best_single_observation_is_never_reduced(self) -> None:
        fused = fuse_confidence([scan("a", 0.9), scan("b", 0.1)], "a")
        self.assertGreaterEqual(float(fused["confidence"][2, 2]), 0.9 - 1 / 255)

    def test_different_models_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "same model"):
            fuse_confidence(
                [scan("a", 0.7), scan("b", 0.7, scene_hash="b" * 64)],
                "a",
            )


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import unittest

from server.auto_view import (
    angular_distance_deg,
    candidate_is_duplicate,
    choose_next_candidate,
    generate_candidate_views,
    scan_quality_score,
    stop_reason,
    view_space_coverage_score,
)


class AutoViewPlannerTest(unittest.TestCase):
    def test_candidates_are_stable_and_unique(self) -> None:
        candidates = generate_candidate_views()
        self.assertEqual(len(candidates), 21)
        self.assertEqual(candidates[0]["name"], "auto_low_000")
        self.assertEqual(candidates[-1]["name"], "auto_top")
        self.assertEqual(len({c["name"] for c in candidates}), len(candidates))

    def test_angular_distance_and_duplicate_rejection(self) -> None:
        a = {"yaw_deg": 0, "elevation_deg": 20}
        b = {"yaw_deg": 180, "elevation_deg": 20}
        c = {"yaw_deg": 22.5, "elevation_deg": 20}
        self.assertGreater(angular_distance_deg(a, b), 130)
        self.assertTrue(candidate_is_duplicate(c, [a], min_separation_deg=35))
        self.assertFalse(candidate_is_duplicate(b, [a], min_separation_deg=35))

    def test_scan_quality_saturates_visibility(self) -> None:
        weak = scan_quality_score(0.02, 0.2)
        strong = scan_quality_score(0.20, 0.9)
        oversize = scan_quality_score(0.80, 0.9)
        self.assertLess(weak, strong)
        self.assertEqual(strong, oversize)
        self.assertGreater(strong, 0.9)

    def test_next_view_is_deterministic_and_increases_coverage(self) -> None:
        candidates = generate_candidate_views()
        first = choose_next_candidate(candidates, [])
        self.assertEqual(first["name"], "auto_low_000")
        self.assertGreater(first["expected_gain"], 0)
        self.assertEqual(first["expected_gain"], first["expected_coverage_score"])
        acquired = [{**first, "quality_score": 0.9}]
        before = view_space_coverage_score(candidates, acquired)
        second = choose_next_candidate(candidates, acquired)
        self.assertIsNotNone(second)
        after = view_space_coverage_score(
            candidates,
            [*acquired, {**second, "quality_score": 0.9}],
        )
        self.assertGreater(after, before)
        self.assertGreaterEqual(angular_distance_deg(first, second), 35)

    def test_weak_view_leaves_more_coverage_gap_than_strong_view(self) -> None:
        candidates = generate_candidate_views()
        view = candidates[0]
        weak = view_space_coverage_score(
            candidates, [{**view, "quality_score": 0.2}]
        )
        strong = view_space_coverage_score(
            candidates, [{**view, "quality_score": 0.9}]
        )
        self.assertGreater(strong, weak)

    def test_stop_conditions_are_explicit(self) -> None:
        self.assertEqual(
            stop_reason(
                view_count=3,
                coverage_score=0.8,
                next_expected_gain=0.1,
            ),
            "target_reached",
        )
        self.assertEqual(
            stop_reason(
                view_count=3,
                coverage_score=0.4,
                next_expected_gain=0.01,
            ),
            "diminishing_returns",
        )
        self.assertEqual(
            stop_reason(
                view_count=6,
                coverage_score=0.4,
                next_expected_gain=0.2,
            ),
            "max_views",
        )
        self.assertIsNone(
            stop_reason(
                view_count=2,
                coverage_score=0.9,
                next_expected_gain=0.0,
            )
        )


if __name__ == "__main__":
    unittest.main()

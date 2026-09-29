"""Deterministic Phase 13 automatic LiDAR view planning helpers.

The planner deliberately works in *view space*, not reconstructed object space.
Each acquired scan contributes a quality-weighted angular footprint over a fixed
candidate camera set. This lets weak scans leave weak directional coverage while
avoiding any claim that Phase 13 already performs Phase 14 confidence fusion.
"""

from __future__ import annotations

import math
from typing import Any, Iterable

DEFAULT_AUTO_TARGET = 0.72
DEFAULT_AUTO_MIN_VIEWS = 3
DEFAULT_AUTO_MAX_VIEWS = 6
DEFAULT_AUTO_MIN_GAIN = 0.035
DEFAULT_AUTO_MIN_SEPARATION_DEG = 35.0


def _candidate(name: str, label: str, yaw: float, elevation: float) -> dict[str, Any]:
    return {
        "name": name,
        "label": label,
        "yaw_deg": float(yaw),
        "elevation_deg": float(elevation),
    }


def generate_candidate_views() -> list[dict[str, Any]]:
    """Return the stable Phase 13 candidate camera set."""
    out: list[dict[str, Any]] = []

    for yaw in range(0, 360, 45):
        out.append(_candidate(
            f"auto_low_{yaw:03d}",
            f"Low {yaw}°",
            yaw,
            20.0,
        ))

    for yaw in (22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5):
        name_yaw = int(round(yaw * 10))
        out.append(_candidate(
            f"auto_mid_{name_yaw:04d}",
            f"Mid {yaw:g}°",
            yaw,
            45.0,
        ))

    for yaw in (0, 90, 180, 270):
        out.append(_candidate(
            f"auto_high_{yaw:03d}",
            f"High {yaw}°",
            yaw,
            70.0,
        ))

    out.append(_candidate("auto_top", "Top", 0.0, 80.0))
    return out


def camera_direction(yaw_deg: float, elevation_deg: float) -> tuple[float, float, float]:
    yaw = math.radians(float(yaw_deg))
    elevation = math.radians(float(elevation_deg))
    horizontal = math.cos(elevation)
    return (
        math.sin(yaw) * horizontal,
        math.sin(elevation),
        math.cos(yaw) * horizontal,
    )


def angular_distance_deg(a: dict[str, Any], b: dict[str, Any]) -> float:
    av = camera_direction(a["yaw_deg"], a["elevation_deg"])
    bv = camera_direction(b["yaw_deg"], b["elevation_deg"])
    dot = max(-1.0, min(1.0, sum(x * y for x, y in zip(av, bv))))
    return math.degrees(math.acos(dot))


def _angular_support(angle_deg: float) -> float:
    if angle_deg >= 90.0:
        return 0.0
    return max(0.0, math.cos(math.radians(angle_deg))) ** 0.75


def normalize_view_quality(value: Any) -> float:
    try:
        quality = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(quality):
        return 0.0
    return max(0.0, min(1.0, quality))


def scan_quality_score(ray_hit_fraction: Any, mean_confidence: Any) -> float:
    """Compress per-view sensor evidence into a stable 0..1 planner weight."""
    try:
        hit = float(ray_hit_fraction)
    except (TypeError, ValueError):
        hit = 0.0
    try:
        confidence = float(mean_confidence)
    except (TypeError, ValueError):
        confidence = 0.0

    if not math.isfinite(hit):
        hit = 0.0
    if not math.isfinite(confidence):
        confidence = 0.0

    visibility = max(0.0, min(1.0, hit / 0.20))
    confidence = max(0.0, min(1.0, confidence))
    return round(0.65 * visibility + 0.35 * confidence, 6)


def view_space_coverage_score(
    candidates: Iterable[dict[str, Any]],
    acquired: Iterable[dict[str, Any]],
) -> float:
    candidate_list = list(candidates)
    acquired_list = list(acquired)
    if not candidate_list or not acquired_list:
        return 0.0

    total = 0.0
    for target in candidate_list:
        best = 0.0
        for view in acquired_list:
            quality = normalize_view_quality(view.get("quality_score", 0.0))
            if quality <= 0.0:
                continue
            angle = angular_distance_deg(target, view)
            best = max(best, quality * _angular_support(angle))
        total += best
    return round(total / len(candidate_list), 6)


def candidate_is_duplicate(
    candidate: dict[str, Any],
    acquired: Iterable[dict[str, Any]],
    *,
    min_separation_deg: float = DEFAULT_AUTO_MIN_SEPARATION_DEG,
) -> bool:
    return any(
        angular_distance_deg(candidate, view) < float(min_separation_deg)
        for view in acquired
    )


def choose_next_candidate(
    candidates: Iterable[dict[str, Any]],
    acquired: Iterable[dict[str, Any]],
    *,
    min_separation_deg: float = DEFAULT_AUTO_MIN_SEPARATION_DEG,
) -> dict[str, Any] | None:
    """Choose the candidate with the largest expected view-space coverage gain."""
    candidate_list = list(candidates)
    acquired_list = list(acquired)
    acquired_names = {str(view.get("name")) for view in acquired_list}

    if not acquired_list:
        if not candidate_list:
            return None
        first = dict(candidate_list[0])
        projected = dict(first)
        projected["quality_score"] = 1.0
        score = view_space_coverage_score(candidate_list, [projected])
        first["expected_gain"] = round(score, 6)
        first["expected_coverage_score"] = round(score, 6)
        return first

    current = view_space_coverage_score(candidate_list, acquired_list)
    best: dict[str, Any] | None = None
    best_gain = -1.0
    best_score = current

    for candidate in candidate_list:
        if candidate["name"] in acquired_names:
            continue
        if candidate_is_duplicate(
            candidate,
            acquired_list,
            min_separation_deg=min_separation_deg,
        ):
            continue

        projected_view = dict(candidate)
        projected_view["quality_score"] = 1.0
        projected = view_space_coverage_score(
            candidate_list,
            [*acquired_list, projected_view],
        )
        gain = projected - current
        if gain > best_gain + 1e-12:
            best = dict(candidate)
            best_gain = gain
            best_score = projected

    if best is None:
        return None
    best["expected_gain"] = round(max(0.0, best_gain), 6)
    best["expected_coverage_score"] = round(best_score, 6)
    return best


def stop_reason(
    *,
    view_count: int,
    coverage_score: float,
    next_expected_gain: float | None,
    target: float = DEFAULT_AUTO_TARGET,
    min_views: int = DEFAULT_AUTO_MIN_VIEWS,
    max_views: int = DEFAULT_AUTO_MAX_VIEWS,
    min_gain: float = DEFAULT_AUTO_MIN_GAIN,
) -> str | None:
    if view_count >= int(max_views):
        return "max_views"
    if view_count >= int(min_views) and float(coverage_score) >= float(target):
        return "target_reached"
    if (
        view_count >= int(min_views)
        and next_expected_gain is not None
        and float(next_expected_gain) < float(min_gain)
    ):
        return "diminishing_returns"
    return None

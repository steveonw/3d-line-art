"""Phase 16 world-space ink projection onto the authoritative normalized mesh."""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from .confidence_fusion import decode_scan_evidence

INK3D_FORMAT = "lidar-ink-3d-strokes"
INK3D_VERSION = 1
MAX_INPUT_STROKES = 5_000
MAX_INPUT_POINTS_PER_STROKE = 8
MAX_PROJECTED_POINTS = 80_000
DEFAULT_MAX_SEGMENT_PIXELS = 2.5
DEPTH_JUMP_FACTOR = 5.0


def _camera_basis(metadata: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    position = np.asarray(metadata["camera_position"], dtype=np.float64)
    target = np.asarray(metadata["camera_target"], dtype=np.float64)
    forward = target - position
    norm = float(np.linalg.norm(forward))
    if norm <= 1e-12:
        raise ValueError("3D Ink camera position equals target")
    forward /= norm

    up_hint = np.asarray([0.0, 1.0, 0.0], dtype=np.float64)
    right = np.cross(forward, up_hint)
    right_norm = float(np.linalg.norm(right))
    if right_norm <= 1e-12:
        right = np.cross(forward, np.asarray([0.0, 0.0, 1.0], dtype=np.float64))
        right_norm = float(np.linalg.norm(right))
    right /= max(right_norm, 1e-12)
    up = np.cross(right, forward)
    return position, forward, right, up


def _pixel_rays(
    xy: np.ndarray,
    metadata: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray]:
    width = int(metadata["width"])
    height = int(metadata["height"])
    if width <= 0 or height <= 0:
        raise ValueError("3D Ink scan dimensions are invalid")
    position, forward, right, up = _camera_basis(metadata)
    fov = float(metadata.get("camera", {}).get("fov_deg", 55.0))
    half_h = math.tan(math.radians(fov) / 2.0)
    half_w = half_h * (width / height)

    px = xy[:, 0].astype(np.float64) + 0.5
    py = xy[:, 1].astype(np.float64) + 0.5
    ndc_x = (px / width - 0.5) * 2.0 * half_w
    ndc_y = (0.5 - py / height) * 2.0 * half_h
    directions = (
        forward[None, :]
        + ndc_x[:, None] * right[None, :]
        + ndc_y[:, None] * up[None, :]
    )
    directions /= np.linalg.norm(directions, axis=1, keepdims=True)
    origins = np.repeat(position[None, :], len(xy), axis=0)
    return origins, directions


def _validate_payload(payload: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any]:
    width = int(payload.get("width", 0))
    height = int(payload.get("height", 0))
    if width != int(metadata["width"]) or height != int(metadata["height"]):
        raise ValueError("3D Ink stroke dimensions do not match the selected scan")

    counts_raw = payload.get("point_counts")
    points_raw = payload.get("points")
    widths_raw = payload.get("widths")
    rgba_raw = payload.get("rgba")
    if not isinstance(counts_raw, list) or not isinstance(points_raw, list):
        raise ValueError("3D Ink payload requires point_counts and points arrays")
    if not isinstance(widths_raw, list) or not isinstance(rgba_raw, list):
        raise ValueError("3D Ink payload requires widths and rgba arrays")
    if len(counts_raw) > MAX_INPUT_STROKES:
        raise ValueError(f"3D Ink accepts at most {MAX_INPUT_STROKES} strokes")
    if len(widths_raw) != len(counts_raw) or len(rgba_raw) != len(counts_raw) * 4:
        raise ValueError("3D Ink stroke style arrays do not match point_counts")

    counts: list[int] = []
    total_points = 0
    for raw in counts_raw:
        count = int(raw)
        if count < 2 or count > MAX_INPUT_POINTS_PER_STROKE:
            raise ValueError(
                f"each 3D Ink input stroke must contain 2..{MAX_INPUT_POINTS_PER_STROKE} points"
            )
        counts.append(count)
        total_points += count

    if len(points_raw) != total_points * 2:
        raise ValueError("3D Ink points array length does not match point_counts")
    if total_points > MAX_INPUT_STROKES * MAX_INPUT_POINTS_PER_STROKE:
        raise ValueError("3D Ink input point limit exceeded")

    points = np.asarray(points_raw, dtype=np.float64)
    if points.size and not np.all(np.isfinite(points)):
        raise ValueError("3D Ink points must be finite")
    points = points.reshape(-1, 2)
    if len(points):
        if (
            np.any(points[:, 0] < -1.0)
            or np.any(points[:, 0] > width)
            or np.any(points[:, 1] < -1.0)
            or np.any(points[:, 1] > height)
        ):
            raise ValueError("3D Ink stroke point lies outside the scan frame")

    widths = np.asarray(widths_raw, dtype=np.float64)
    if widths.size and (not np.all(np.isfinite(widths)) or np.any(widths <= 0)):
        raise ValueError("3D Ink widths must be finite positive numbers")
    rgba = np.asarray(rgba_raw, dtype=np.int64)
    if rgba.size and (np.any(rgba < 0) or np.any(rgba > 255)):
        raise ValueError("3D Ink rgba values must be bytes")

    try:
        max_segment_pixels = float(payload.get("max_segment_pixels", DEFAULT_MAX_SEGMENT_PIXELS))
    except (TypeError, ValueError) as error:
        raise ValueError("max_segment_pixels must be a number") from error
    if not math.isfinite(max_segment_pixels):
        raise ValueError("max_segment_pixels must be finite")
    max_segment_pixels = max(0.75, min(8.0, max_segment_pixels))

    return {
        "counts": counts,
        "points": points,
        "widths": widths.astype(np.float32),
        "rgba": rgba.astype(np.uint8).reshape(-1, 4),
        "max_segment_pixels": max_segment_pixels,
    }


def _densify(
    points: np.ndarray,
    counts: list[int],
    max_segment_pixels: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Densify image-space paths while retaining source-stroke/style identity."""
    dense: list[tuple[float, float]] = []
    stroke_ids: list[int] = []
    source_positions: list[float] = []
    cursor = 0

    for stroke_index, count in enumerate(counts):
        path = points[cursor : cursor + count]
        cursor += count
        local: list[np.ndarray] = [path[0]]
        local_pos: list[float] = [0.0]
        distance_so_far = 0.0

        for a, b in zip(path[:-1], path[1:]):
            delta = b - a
            distance = float(np.linalg.norm(delta))
            steps = max(1, int(math.ceil(distance / max_segment_pixels)))
            for step in range(1, steps + 1):
                t = step / steps
                local.append(a + delta * t)
                local_pos.append(distance_so_far + distance * t)
            distance_so_far += distance

        if len(dense) + len(local) > MAX_PROJECTED_POINTS:
            keep = max(0, MAX_PROJECTED_POINTS - len(dense))
            local = local[:keep]
            local_pos = local_pos[:keep]

        dense.extend((float(p[0]), float(p[1])) for p in local)
        stroke_ids.extend([stroke_index] * len(local))
        source_positions.extend(local_pos)
        if len(dense) >= MAX_PROJECTED_POINTS:
            break

    return (
        np.asarray(dense, dtype=np.float64).reshape(-1, 2),
        np.asarray(stroke_ids, dtype=np.int64),
        np.asarray(source_positions, dtype=np.float64),
    )


def _sample_confidence(
    confidence: np.ndarray,
    xy: np.ndarray,
) -> np.ndarray:
    height, width = confidence.shape
    ix = np.clip(np.rint(xy[:, 0]).astype(np.int64), 0, width - 1)
    iy = np.clip(np.rint(xy[:, 1]).astype(np.int64), 0, height - 1)
    return np.clip(confidence[iy, ix], 0.0, 1.0)


def _stable_tangent(normal: np.ndarray) -> np.ndarray:
    axis = np.asarray([1.0, 0.0, 0.0], dtype=np.float64)
    if abs(float(normal[0])) > 0.85:
        axis = np.asarray([0.0, 1.0, 0.0], dtype=np.float64)
    tangent = np.cross(normal, axis)
    norm = float(np.linalg.norm(tangent))
    if norm <= 1e-12:
        tangent = np.asarray([0.0, 0.0, 1.0], dtype=np.float64)
        norm = 1.0
    return tangent / norm


def _compute_tangents(points: np.ndarray, normals: np.ndarray) -> np.ndarray:
    count = len(points)
    tangents = np.zeros_like(points)
    if count == 1:
        tangents[0] = _stable_tangent(normals[0])
        return tangents

    for i in range(count):
        if i == 0:
            delta = points[1] - points[0]
        elif i == count - 1:
            delta = points[-1] - points[-2]
        else:
            delta = points[i + 1] - points[i - 1]
        normal = normals[i]
        tangent = delta - normal * float(np.dot(delta, normal))
        norm = float(np.linalg.norm(tangent))
        tangents[i] = tangent / norm if norm > 1e-12 else _stable_tangent(normal)
    return tangents


def _round_flat(values: np.ndarray, decimals: int = 5) -> list[float]:
    return np.round(np.asarray(values, dtype=np.float64), decimals).astype(np.float32).reshape(-1).tolist()


def project_strokes_to_mesh(
    scene: Any,
    stored_scan: dict[str, Any],
    payload: dict[str, Any],
    *,
    engine: Any,
) -> dict[str, Any]:
    """Project deterministic 2D ink paths onto actual scene triangles.

    The 2D renderer remains the art-placement authority. This function densely
    samples those paths, intersects the selected scan camera rays with the real
    normalized mesh, and emits packed world-space metadata for Three.js.
    """
    metadata = stored_scan.get("metadata") or {}
    if not metadata.get("scan_id"):
        raise ValueError("3D Ink requires a selected scan")
    scene_hash = metadata.get("scene", {}).get("sha256")
    scene_geometry_hash = (
        metadata.get("scene", {}).get("geometry_sha256")
        or scene_hash
    )
    validated = _validate_payload(payload, metadata)
    dense_xy, stroke_ids, _ = _densify(
        validated["points"],
        validated["counts"],
        validated["max_segment_pixels"],
    )
    if not len(dense_xy):
        raise ValueError("3D Ink payload contains no projectable points")

    origins, directions = _pixel_rays(dense_xy, metadata)
    depths, colors, normals, piece_ids = engine.cast_rays_scene(
        origins,
        directions,
        scene,
    )
    hit = np.isfinite(depths) & (depths < getattr(engine, "INF", 1e9))
    if not np.any(hit):
        raise ValueError("3D Ink strokes did not intersect the loaded mesh")

    points = origins + directions * depths[:, None]
    normals = np.asarray(normals, dtype=np.float64)
    colors = np.asarray(colors, dtype=np.float64)
    piece_ids = np.asarray(piece_ids, dtype=np.int64)

    # Imported winding is not reliable. Store camera-facing surface normals,
    # matching the two-sided convention used by the LiDAR scan renderer.
    back = np.sum(normals * directions, axis=1) > 0.0
    normals[back] *= -1.0

    _, confidence_map = decode_scan_evidence(stored_scan["evidence"])
    confidence = _sample_confidence(confidence_map, dense_xy)

    out_positions: list[np.ndarray] = []
    out_normals: list[np.ndarray] = []
    out_tangents: list[np.ndarray] = []
    out_depth: list[np.ndarray] = []
    out_confidence: list[np.ndarray] = []
    out_material: list[np.ndarray] = []
    out_piece_ids: list[np.ndarray] = []
    stroke_offsets: list[int] = []
    stroke_counts: list[int] = []
    stroke_widths: list[float] = []
    stroke_rgba: list[int] = []
    source_indices: list[int] = []
    point_cursor = 0

    input_stroke_count = len(validated["counts"])
    hit_count = int(np.count_nonzero(hit))
    miss_count = int(len(hit) - hit_count)

    for stroke_index in range(input_stroke_count):
        ids = np.where(stroke_ids == stroke_index)[0]
        if len(ids) < 2:
            continue

        run: list[int] = []

        def flush_run() -> None:
            nonlocal point_cursor, run
            if len(run) < 2:
                run = []
                return
            idx = np.asarray(run, dtype=np.int64)
            run_points = points[idx]
            run_normals = normals[idx]
            run_tangents = _compute_tangents(run_points, run_normals)

            stroke_offsets.append(point_cursor)
            stroke_counts.append(len(idx))
            stroke_widths.append(float(validated["widths"][stroke_index]))
            stroke_rgba.extend(int(x) for x in validated["rgba"][stroke_index])
            source_indices.append(stroke_index)
            out_positions.append(run_points)
            out_normals.append(run_normals)
            out_tangents.append(run_tangents)
            out_depth.append(depths[idx])
            out_confidence.append(confidence[idx])
            out_material.append(colors[idx])
            out_piece_ids.append(piece_ids[idx])
            point_cursor += len(idx)
            run = []

        previous = None
        for dense_index in ids:
            if not hit[dense_index]:
                flush_run()
                previous = None
                continue

            if previous is not None:
                pixel_step = float(np.linalg.norm(dense_xy[dense_index] - dense_xy[previous]))
                world_step = float(np.linalg.norm(points[dense_index] - points[previous]))
                expected = max(1e-6, float(depths[dense_index]) * pixel_step / max(metadata["width"], metadata["height"]))
                depth_ratio = max(float(depths[dense_index]), float(depths[previous])) / max(
                    1e-6,
                    min(float(depths[dense_index]), float(depths[previous])),
                )
                if (
                    piece_ids[dense_index] != piece_ids[previous]
                    or world_step > max(0.18, expected * DEPTH_JUMP_FACTOR)
                    or depth_ratio > 1.35
                ):
                    flush_run()
            run.append(int(dense_index))
            previous = int(dense_index)
        flush_run()

    if not stroke_counts:
        raise ValueError("3D Ink projection produced no continuous surface strokes")

    position_arr = np.vstack(out_positions)
    normal_arr = np.vstack(out_normals)
    tangent_arr = np.vstack(out_tangents)
    depth_arr = np.concatenate(out_depth)
    confidence_arr = np.concatenate(out_confidence)
    material_arr = np.vstack(out_material)
    piece_arr = np.concatenate(out_piece_ids)

    return {
        "format": INK3D_FORMAT,
        "version": INK3D_VERSION,
        "scene_sha256": scene_hash,
        "scene_geometry_sha256": scene_geometry_hash,
        "scan_id": metadata["scan_id"],
        "source_stroke_count": input_stroke_count,
        "stroke_count": len(stroke_counts),
        "point_count": int(len(position_arr)),
        "ray_count": int(len(dense_xy)),
        "hit_count": hit_count,
        "miss_count": miss_count,
        "positions": _round_flat(position_arr),
        "normals": _round_flat(normal_arr),
        "tangents": _round_flat(tangent_arr),
        "depth": _round_flat(depth_arr),
        "confidence": np.round(np.clip(confidence_arr, 0.0, 1.0) * 255).astype(np.uint8).tolist(),
        "material_rgb": np.round(np.clip(material_arr, 0.0, 1.0) * 255).astype(np.uint8).reshape(-1).tolist(),
        "piece_ids": piece_arr.astype(np.int32).tolist(),
        "stroke_offsets": stroke_offsets,
        "stroke_counts": stroke_counts,
        "stroke_widths": [round(float(x), 4) for x in stroke_widths],
        "stroke_rgba": stroke_rgba,
        "source_stroke_indices": source_indices,
        "metadata": {
            "coordinate_space": "normalized-world",
            "normal_convention": "camera-facing-visible-surface",
            "tangent_convention": "projected-polyline-surface-tangent",
            "depth_convention": "camera-ray-distance-to-real-mesh",
            "confidence_source": "selected-scan-cached-confidence",
            "material_source": "real-mesh-hit-color-and-piece-id",
        },
    }

"""Bounded geometry snapshots for the Phase 15 local Three.js inspector."""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from .confidence_fusion import world_points_from_scan

DEFAULT_MAX_PREVIEW_TRIANGLES = 20_000
DEFAULT_MAX_POINT_CLOUD_POINTS = 12_000
DEFAULT_MAX_RAY_SEGMENTS = 320


def _sample_indices(count: int, limit: int) -> np.ndarray:
    count = max(0, int(count))
    limit = max(1, int(limit))
    if count <= limit:
        return np.arange(count, dtype=np.int64)
    # Deterministic, coverage-friendly spread across the source order.
    return np.linspace(0, count - 1, limit, dtype=np.int64)


def _round_positions(values: np.ndarray) -> list[float]:
    return np.round(np.asarray(values, dtype=np.float64), 5).astype(np.float32).reshape(-1).tolist()


def scene_inspection_snapshot(
    scene: Any,
    scene_info: dict[str, Any],
    *,
    max_triangles: int = DEFAULT_MAX_PREVIEW_TRIANGLES,
) -> dict[str, Any]:
    """Return a deterministic triangle-soup preview of the normalized scene."""
    meshes = list(getattr(scene, "meshes", []) or [])
    if not meshes:
        raise ValueError("loaded scene does not contain a mesh")

    source_triangles = sum(int(np.asarray(mesh.faces).shape[0]) for mesh in meshes)
    remaining = max(1, int(max_triangles))
    chunks: list[np.ndarray] = []
    sampled_triangles = 0

    for mesh_index, mesh in enumerate(meshes):
        faces = np.asarray(mesh.faces, dtype=np.int64)
        vertices = np.asarray(mesh.vertices, dtype=np.float64)
        if faces.ndim != 2 or faces.shape[1] != 3 or not len(faces):
            continue

        meshes_left = max(1, len(meshes) - mesh_index)
        budget = max(1, remaining // meshes_left)
        indices = _sample_indices(len(faces), min(budget, len(faces)))
        selected = faces[indices]
        triangles = vertices[selected].reshape(-1, 3)
        chunks.append(triangles)
        sampled = int(len(selected))
        sampled_triangles += sampled
        remaining = max(0, remaining - sampled)
        if remaining <= 0:
            break

    if not chunks:
        raise ValueError("loaded scene does not contain previewable triangles")

    positions = np.vstack(chunks)
    bounds_min = np.asarray(scene_info.get("bounds_min", [0, 0, 0]), dtype=np.float64)
    bounds_max = np.asarray(scene_info.get("bounds_max", [0, 0, 0]), dtype=np.float64)
    center = (bounds_min + bounds_max) * 0.5
    radius = float(np.linalg.norm(bounds_max - bounds_min) * 0.5)
    if not math.isfinite(radius) or radius <= 1e-9:
        radius = 1.0

    return {
        "scene": {
            "name": scene_info.get("name"),
            "sha256": scene_info.get("sha256"),
            "geometry_sha256": scene_info.get("geometry_sha256") or scene_info.get("sha256"),
            "transform": scene_info.get("transform"),
            "triangles": int(scene_info.get("triangles") or source_triangles),
            "vertices": int(scene_info.get("vertices") or 0),
            "bounds_min": [float(x) for x in bounds_min],
            "bounds_max": [float(x) for x in bounds_max],
        },
        "preview": {
            "triangle_count": sampled_triangles,
            "source_triangle_count": source_triangles,
            "positions": _round_positions(positions),
            "center": [round(float(x), 5) for x in center],
            "radius": round(radius, 5),
        },
    }


def scan_inspection_snapshot(
    scan: dict[str, Any],
    *,
    max_points: int = DEFAULT_MAX_POINT_CLOUD_POINTS,
    max_rays: int = DEFAULT_MAX_RAY_SEGMENTS,
) -> dict[str, Any]:
    """Return a bounded point cloud and hit-ray preview from cached scan evidence."""
    metadata = scan.get("metadata") or {}
    if not scan.get("evidence"):
        raise ValueError("scan does not contain cached inspection evidence")

    points, confidence = world_points_from_scan(scan)
    point_indices = _sample_indices(len(points), max_points)
    sampled_points = points[point_indices] if len(point_indices) else np.empty((0, 3))
    sampled_confidence = (
        confidence[point_indices] if len(point_indices) else np.empty(0, dtype=np.float64)
    )

    ray_indices = _sample_indices(len(sampled_points), max_rays)
    ray_points = (
        sampled_points[ray_indices] if len(ray_indices) else np.empty((0, 3), dtype=np.float64)
    )
    camera = np.asarray(metadata.get("camera_position", [0, 0, 0]), dtype=np.float64)
    if len(ray_points):
        starts = np.repeat(camera[None, :], len(ray_points), axis=0)
        segments = np.stack([starts, ray_points], axis=1).reshape(-1, 3)
    else:
        segments = np.empty((0, 3), dtype=np.float64)

    confidence_bytes = np.round(np.clip(sampled_confidence, 0.0, 1.0) * 255).astype(np.uint8)
    camera_meta = metadata.get("camera") or {}
    return {
        "scan_id": metadata.get("scan_id"),
        "scene_sha256": metadata.get("scene", {}).get("sha256"),
        "scene_geometry_sha256": (
            metadata.get("scene", {}).get("geometry_sha256")
            or metadata.get("scene", {}).get("sha256")
        ),
        "camera": {
            "position": [float(x) for x in metadata.get("camera_position", [0, 0, 0])],
            "target": [float(x) for x in metadata.get("camera_target", [0, 0, 0])],
            "fov_deg": float(camera_meta.get("fov_deg", 55.0)),
            "width": int(metadata.get("width", 1)),
            "height": int(metadata.get("height", 1)),
            "yaw_deg": float(camera_meta.get("yaw_deg", 0.0)),
            "elevation_deg": float(camera_meta.get("elevation_deg", 0.0)),
        },
        "points": {
            "source_count": int(len(points)),
            "preview_count": int(len(sampled_points)),
            "positions": _round_positions(sampled_points),
            "confidence": confidence_bytes.tolist(),
        },
        "rays": {
            "kind": "cached-hit-rays",
            "count": int(len(ray_points)),
            "positions": _round_positions(segments),
        },
    }

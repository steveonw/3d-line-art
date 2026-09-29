"""Authoritative post-normalization model transforms.

The source SHA remains the identity of the uploaded/generated asset.  A separate
geometry fingerprint combines that source identity with the canonical transform
so LiDAR/cache/fusion products cannot be reused across different placements.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

DEFAULT_MODEL_TRANSFORM = {
    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
    "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
    "scale": 1.0,
}

POSITION_LIMIT = 24.0
SCALE_MIN = 0.05
SCALE_MAX = 10.0


def _finite(value: Any, name: str, default: float) -> float:
    if value is None:
        return float(default)
    try:
        result = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be a number") from error
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


def _canonical_rotation(value: Any, name: str) -> float:
    angle = _finite(value, name, 0.0)
    angle = ((angle + 180.0) % 360.0) - 180.0
    if abs(angle) < 5e-10:
        angle = 0.0
    return round(angle, 6)


def normalize_model_transform(spec: dict[str, Any] | None) -> dict[str, Any]:
    raw = spec if isinstance(spec, dict) else {}
    raw_position = raw.get("position")
    raw_rotation = raw.get("rotation")
    position = raw_position if isinstance(raw_position, dict) else {}
    rotation = raw_rotation if isinstance(raw_rotation, dict) else {}

    px = _finite(position.get("x"), "position.x", 0.0)
    py = _finite(position.get("y"), "position.y", 0.0)
    pz = _finite(position.get("z"), "position.z", 0.0)
    for value, name in ((px, "position.x"), (py, "position.y"), (pz, "position.z")):
        if value < -POSITION_LIMIT or value > POSITION_LIMIT:
            raise ValueError(
                f"{name} must be between {-POSITION_LIMIT:g} and {POSITION_LIMIT:g}"
            )

    scale = _finite(raw.get("scale"), "scale", 1.0)
    if scale < SCALE_MIN or scale > SCALE_MAX:
        raise ValueError(f"scale must be between {SCALE_MIN:g} and {SCALE_MAX:g}")

    return {
        "position": {
            "x": round(px, 6),
            "y": round(py, 6),
            "z": round(pz, 6),
        },
        "rotation": {
            "x": _canonical_rotation(rotation.get("x"), "rotation.x"),
            "y": _canonical_rotation(rotation.get("y"), "rotation.y"),
            "z": _canonical_rotation(rotation.get("z"), "rotation.z"),
        },
        "scale": round(scale, 6),
    }


def is_identity_transform(spec: dict[str, Any] | None) -> bool:
    return normalize_model_transform(spec) == DEFAULT_MODEL_TRANSFORM


def geometry_fingerprint(source_sha256: str, transform: dict[str, Any] | None) -> str:
    if not source_sha256:
        raise ValueError("source SHA-256 is required for transformed geometry identity")
    canonical = json.dumps(
        {
            "source_sha256": str(source_sha256).lower(),
            "transform": normalize_model_transform(transform),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _rotation_matrix(np, rotation: dict[str, float]):
    rx = math.radians(rotation["x"])
    ry = math.radians(rotation["y"])
    rz = math.radians(rotation["z"])
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)

    mx = np.asarray([
        [1.0, 0.0, 0.0],
        [0.0, cx, -sx],
        [0.0, sx, cx],
    ], dtype=np.float64)
    my = np.asarray([
        [cy, 0.0, sy],
        [0.0, 1.0, 0.0],
        [-sy, 0.0, cy],
    ], dtype=np.float64)
    mz = np.asarray([
        [cz, -sz, 0.0],
        [sz, cz, 0.0],
        [0.0, 0.0, 1.0],
    ], dtype=np.float64)
    # Column-vector convention: X, then Y, then Z.
    return mz @ my @ mx


def transform_scene(engine, base_scene: Any, spec: dict[str, Any] | None):
    transform = normalize_model_transform(spec)
    meshes = list(getattr(base_scene, "meshes", []) or [])
    if not meshes:
        raise ValueError("loaded scene does not contain transformable mesh geometry")

    np = engine.np
    all_vertices = np.vstack([
        np.asarray(mesh.vertices, dtype=np.float64)
        for mesh in meshes
    ])
    minimum = all_vertices.min(axis=0)
    maximum = all_vertices.max(axis=0)
    pivot = (minimum + maximum) * 0.5

    rotation = _rotation_matrix(np, transform["rotation"])
    translation = np.asarray([
        transform["position"]["x"],
        transform["position"]["y"],
        transform["position"]["z"],
    ], dtype=np.float64)
    scale = float(transform["scale"])

    transformed_meshes = []
    for mesh in meshes:
        vertices = np.asarray(mesh.vertices, dtype=np.float64)
        local = (vertices - pivot) * scale
        transformed = local @ rotation.T + pivot + translation
        transformed_meshes.append(
            engine.Mesh(
                vertices=transformed,
                faces=mesh.faces,
                color=mesh.color,
                piece_id=mesh.piece_id,
                piece_type=mesh.piece_type,
            )
        )

    return engine.Scene(meshes=transformed_meshes), transform

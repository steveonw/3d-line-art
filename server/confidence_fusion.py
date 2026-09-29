"""Phase 14 confidence fusion over cached metric scan evidence."""

from __future__ import annotations

import io
import math
from typing import Any, Iterable

import numpy as np
from PIL import Image

EVIDENCE_VERSION = 1
DEFAULT_ALPHA_GAIN = 1.5
DEFAULT_DEPTH_TOLERANCE = 0.08


def encode_scan_evidence(depth, confidence) -> bytes:
    """Compact metric depth + confidence payload retained inside the scan cache."""
    buffer = io.BytesIO()
    np.savez_compressed(
        buffer,
        version=np.asarray([EVIDENCE_VERSION], dtype=np.uint8),
        depth=np.asarray(depth, dtype=np.float32),
        confidence=np.round(np.clip(confidence, 0.0, 1.0) * 255).astype(np.uint8),
    )
    return buffer.getvalue()


def decode_scan_evidence(payload: bytes) -> tuple[np.ndarray, np.ndarray]:
    if not payload:
        raise ValueError("scan does not contain Phase 14 fusion evidence")
    with np.load(io.BytesIO(payload), allow_pickle=False) as data:
        version = int(np.asarray(data["version"]).reshape(-1)[0])
        if version != EVIDENCE_VERSION:
            raise ValueError(f"unsupported fusion evidence version: {version}")
        depth = np.asarray(data["depth"], dtype=np.float64)
        confidence = np.asarray(data["confidence"], dtype=np.float64) / 255.0
    if depth.shape != confidence.shape or depth.ndim != 2:
        raise ValueError("fusion evidence dimensions do not match")
    return depth, confidence


def _camera_basis(metadata: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    position = np.asarray(metadata["camera_position"], dtype=np.float64)
    target = np.asarray(metadata["camera_target"], dtype=np.float64)
    forward = target - position
    norm = float(np.linalg.norm(forward))
    if norm <= 1e-12:
        raise ValueError("fusion camera position equals target")
    forward /= norm
    up_hint = np.asarray([0.0, 1.0, 0.0], dtype=np.float64)
    right = np.cross(forward, up_hint)
    right_norm = float(np.linalg.norm(right))
    if right_norm <= 1e-12:
        alt = np.asarray([0.0, 0.0, 1.0], dtype=np.float64)
        right = np.cross(forward, alt)
        right_norm = float(np.linalg.norm(right))
    right /= max(right_norm, 1e-12)
    up = np.cross(right, forward)
    return position, forward, right, up


def _world_points(depth: np.ndarray, metadata: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    height, width = depth.shape
    if width != int(metadata["width"]) or height != int(metadata["height"]):
        raise ValueError("fusion evidence does not match scan dimensions")

    hit = np.isfinite(depth) & (depth > 0.0)
    ys, xs = np.nonzero(hit)
    if not len(xs):
        return np.empty((0, 3), dtype=np.float64), np.empty(0, dtype=np.int64)

    position, forward, right, up = _camera_basis(metadata)
    aspect = width / height
    half_h = math.tan(math.radians(float(metadata["camera"]["fov_deg"])) / 2.0)
    half_w = half_h * aspect
    px = xs.astype(np.float64) + 0.5
    py = ys.astype(np.float64) + 0.5
    ndc_x = (px / width - 0.5) * 2.0 * half_w
    ndc_y = (0.5 - py / height) * 2.0 * half_h
    directions = (
        forward[None, :]
        + ndc_x[:, None] * right[None, :]
        + ndc_y[:, None] * up[None, :]
    )
    directions /= np.linalg.norm(directions, axis=1, keepdims=True)
    distances = depth[ys, xs]
    points = position[None, :] + directions * distances[:, None]
    flat = ys.astype(np.int64) * width + xs.astype(np.int64)
    return points, flat


def _project_points(
    points: np.ndarray,
    metadata: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray]:
    width = int(metadata["width"])
    height = int(metadata["height"])
    position, forward, right, up = _camera_basis(metadata)
    rel = points - position[None, :]
    z = rel @ forward
    valid = z > 1e-9
    safe_z = np.where(valid, z, 1.0)
    aspect = width / height
    half_h = math.tan(math.radians(float(metadata["camera"]["fov_deg"])) / 2.0)
    half_w = half_h * aspect
    x = (rel @ right) / safe_z
    y = (rel @ up) / safe_z
    px = (x / (2.0 * half_w) + 0.5) * width
    py = (0.5 - y / (2.0 * half_h)) * height
    ix = np.floor(px).astype(np.int64)
    iy = np.floor(py).astype(np.int64)
    valid &= ix >= 0
    valid &= ix < width
    valid &= iy >= 0
    valid &= iy < height
    flat = iy * width + ix
    return flat[valid], z[valid]


def fuse_confidence(
    scans: Iterable[dict[str, Any]],
    canonical_scan_id: str,
    *,
    alpha_gain: float = DEFAULT_ALPHA_GAIN,
    depth_tolerance: float = DEFAULT_DEPTH_TOLERANCE,
) -> dict[str, Any]:
    """Reproject cached metric evidence and accumulate multi-source confidence."""
    scan_list = list(scans)
    if not scan_list:
        raise ValueError("at least one scan is required for confidence fusion")
    canonical = next(
        (scan for scan in scan_list if scan["metadata"].get("scan_id") == canonical_scan_id),
        None,
    )
    if canonical is None:
        raise ValueError("canonical scan is not part of the fusion set")

    scene_hash = canonical["metadata"].get("scene", {}).get("sha256")
    width = int(canonical["metadata"]["width"])
    height = int(canonical["metadata"]["height"])
    projected: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    nearest = np.full(width * height, np.inf, dtype=np.float64)

    for scan in scan_list:
        metadata = scan["metadata"]
        if metadata.get("scene", {}).get("sha256") != scene_hash:
            raise ValueError("all fused scans must belong to the same model")
        depth, confidence = decode_scan_evidence(scan["evidence"])
        points, source_flat = _world_points(depth, metadata)
        if not len(points):
            continue
        target_flat, target_depth = _project_points(points, canonical["metadata"])
        if not len(target_flat):
            continue

        # _project_points filters points, so reconstruct the same visibility mask
        # to select source confidence in the same order.
        position, forward, right, up = _camera_basis(canonical["metadata"])
        rel = points - position[None, :]
        z = rel @ forward
        safe_z = np.where(z > 1e-9, z, 1.0)
        half_h = math.tan(math.radians(float(canonical["metadata"]["camera"]["fov_deg"])) / 2.0)
        half_w = half_h * (width / height)
        px = ((rel @ right) / safe_z / (2.0 * half_w) + 0.5) * width
        py = (0.5 - (rel @ up) / safe_z / (2.0 * half_h)) * height
        ix = np.floor(px).astype(np.int64)
        iy = np.floor(py).astype(np.int64)
        ok = (z > 1e-9) & (ix >= 0) & (ix < width) & (iy >= 0) & (iy < height)
        source_conf = confidence.reshape(-1)[source_flat][ok]
        target_flat = (iy[ok] * width + ix[ok]).astype(np.int64)
        target_depth = z[ok]
        np.minimum.at(nearest, target_flat, target_depth)
        projected.append((target_flat, target_depth, source_conf))

    sum_weight = np.zeros(width * height, dtype=np.float64)
    best_weight = np.zeros(width * height, dtype=np.float64)
    support = np.zeros(width * height, dtype=np.uint8)

    for target_flat, target_depth, source_conf in projected:
        tolerance = depth_tolerance + 0.01 * nearest[target_flat]
        keep = target_depth <= nearest[target_flat] + tolerance
        if not np.any(keep):
            continue
        idx = target_flat[keep]
        conf = np.clip(source_conf[keep], 0.0, 1.0)

        # One source camera may splat multiple source pixels into one canonical
        # pixel. Let each source contribute at most its strongest observation.
        source_grid = np.zeros(width * height, dtype=np.float64)
        np.maximum.at(source_grid, idx, conf)
        active = source_grid > 0
        sum_weight[active] += source_grid[active]
        best_weight[active] = np.maximum(best_weight[active], source_grid[active])
        support[active] = np.minimum(255, support[active] + 1)

    saturated = 1.0 - np.exp(-max(float(alpha_gain), 1e-6) * sum_weight)
    fused = np.maximum(best_weight, saturated)
    fused = np.clip(fused, 0.0, 1.0).reshape(height, width)
    support_map = support.reshape(height, width)

    occupied = fused > 0
    mean_confidence = float(np.mean(fused[occupied])) if np.any(occupied) else 0.0
    multi_supported = support_map >= 2
    overlap_fraction = float(np.mean(multi_supported[occupied])) if np.any(occupied) else 0.0
    return {
        "confidence": fused,
        "support": support_map,
        "mean_confidence": mean_confidence,
        "overlap_fraction": overlap_fraction,
        "max_support": int(support_map.max()) if support_map.size else 0,
        "width": width,
        "height": height,
    }


def grayscale_png(values: np.ndarray) -> bytes:
    arr = np.round(np.clip(values, 0.0, 1.0) * 255).astype(np.uint8)
    image = Image.fromarray(arr, mode="L").convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def support_png(support: np.ndarray, source_count: int) -> bytes:
    denom = max(1, int(source_count))
    return grayscale_png(np.asarray(support, dtype=np.float64) / denom)

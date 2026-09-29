"""Phase 4 bridge between the local server and the vendored LiDAR engine."""

from __future__ import annotations

import hashlib
import io
from collections import OrderedDict
import json
import math
import os
import tempfile
import uuid
from typing import Any

from .inspection import scene_inspection_snapshot, scan_inspection_snapshot
from .ink3d import project_strokes_to_mesh

from .confidence_fusion import (
    EVIDENCE_VERSION,
    encode_scan_evidence,
    fuse_confidence,
    grayscale_png,
    support_png,
)

from .auto_view import (
    DEFAULT_AUTO_MAX_VIEWS,
    DEFAULT_AUTO_MIN_GAIN,
    DEFAULT_AUTO_MIN_SEPARATION_DEG,
    DEFAULT_AUTO_MIN_VIEWS,
    DEFAULT_AUTO_TARGET,
    choose_next_candidate,
    generate_candidate_views,
    normalize_view_quality,
    scan_quality_score,
    stop_reason as auto_stop_reason,
    view_space_coverage_score,
)

MAX_TRIANGLES = 250_000
DEFAULT_WIDTH = 320
DEFAULT_HEIGHT = 240
DEFAULT_RAYS_PER_PIXEL = 2
DEFAULT_SEED = 42
DEFAULT_YAW_DEG = 45.0
DEFAULT_ELEVATION_DEG = 20.0
DEFAULT_DISTANCE_SCALE = 3.0
DEFAULT_FOV_DEG = 55.0
SENSOR_FLOAT_DECIMALS = 6
MIN_COHERENCE_HITS = 4

FIXED_VIEW_ORDER = ("front", "back", "left", "right", "top")
FIXED_VIEWS: dict[str, dict[str, Any]] = {
    "front": {"label": "Front", "yaw_deg": 0.0, "elevation_deg": 20.0},
    "back": {"label": "Back", "yaw_deg": 180.0, "elevation_deg": 20.0},
    "left": {"label": "Left", "yaw_deg": 270.0, "elevation_deg": 20.0},
    "right": {"label": "Right", "yaw_deg": 90.0, "elevation_deg": 20.0},
    "top": {"label": "Top", "yaw_deg": 0.0, "elevation_deg": 80.0},
}


class LidarUnavailableError(RuntimeError):
    """Raised when optional LiDAR runtime dependencies are unavailable."""


class ScanIdMismatchError(RuntimeError):
    """Raised when a channel request targets a scan that is no longer current."""


def _patch_engine_for_mesh_scenes(engine) -> None:
    """Apply the mesh compatibility shim used by the upstream camera studio."""
    if getattr(engine, "_lidar_ink_mesh_patch", False):
        return
    if not (hasattr(engine, "Scene") and hasattr(engine, "Mesh")):
        raise LidarUnavailableError("vendored LiDAR engine is missing Scene/Mesh support")

    np = engine.np
    Scene, Mesh = engine.Scene, engine.Mesh

    if "__iter__" not in vars(Scene):
        def _scene_iter(self):
            yield from self.primitives
            yield from self.meshes
        Scene.__iter__ = _scene_iter

    if "__len__" not in vars(Scene):
        def _scene_len(self):
            return len(self.primitives) + len(self.meshes)
        Scene.__len__ = _scene_len

    if not hasattr(Mesh, "shape"):
        Mesh.shape = property(lambda self: "mesh")
    if not hasattr(Mesh, "center"):
        Mesh.center = property(lambda self: (self.aabb_min + self.aabb_max) / 2.0)

    if not getattr(engine.scene_bounds, "_lidar_ink_mesh_aware", False):
        original_scene_bounds = engine.scene_bounds

        def mesh_scene_bounds(prims):
            meshes = [p for p in prims if getattr(p, "shape", None) == "mesh"]
            if not meshes:
                return original_scene_bounds(prims)

            primitive_only = [
                p for p in prims if getattr(p, "shape", None) != "mesh"
            ]
            lows = [np.asarray(m.aabb_min, dtype=np.float64) for m in meshes]
            highs = [np.asarray(m.aabb_max, dtype=np.float64) for m in meshes]
            if primitive_only:
                primitive_bounds = original_scene_bounds(primitive_only)
                lows.append(primitive_bounds["min"])
                highs.append(primitive_bounds["max"])

            minimum = np.vstack(lows).min(axis=0)
            maximum = np.vstack(highs).max(axis=0)
            center = (minimum + maximum) / 2.0
            span = np.maximum(maximum - minimum, 1e-6)
            return {
                "min": minimum,
                "max": maximum,
                "center": center,
                "span": span,
            }

        mesh_scene_bounds._lidar_ink_mesh_aware = True
        engine.scene_bounds = mesh_scene_bounds

    engine._lidar_ink_mesh_patch = True


def _load_engine():
    try:
        from vendor import lidar_engine as engine
    except ImportError as error:
        raise LidarUnavailableError(
            "LiDAR dependencies are unavailable. Run: pip install -r requirements.txt"
        ) from error
    _patch_engine_for_mesh_scenes(engine)
    return engine


def _parse_obj(engine, text: str, *, piece_id: int = 1000):
    """Minimal Wavefront OBJ -> engine Mesh."""
    np = engine.np
    vertices = []
    faces = []

    for line in text.splitlines():
        line = line.split("#", 1)[0]
        parts = line.split()
        if not parts:
            continue

        tag = parts[0]
        if tag == "v" and len(parts) >= 4:
            vertices.append([float(parts[1]), float(parts[2]), float(parts[3])])
        elif tag == "f" and len(parts) >= 4:
            indices = []
            for token in parts[1:]:
                raw = token.split("/")[0]
                if not raw:
                    continue
                index = int(raw)
                indices.append((index - 1) if index > 0 else (len(vertices) + index))
            for k in range(1, len(indices) - 1):
                faces.append([indices[0], indices[k], indices[k + 1]])

    if len(vertices) < 3 or not faces:
        raise ValueError("OBJ had no usable triangles (need 'v' and 'f' lines)")

    vertex_array = np.asarray(vertices, dtype=np.float64)
    face_array = np.asarray(faces, dtype=np.int64)
    if face_array.size and (
        face_array.min() < 0 or face_array.max() >= len(vertex_array)
    ):
        raise ValueError(
            "OBJ has face indices out of range "
            f"(verts={len(vertex_array)}, "
            f"face index range {int(face_array.min())}..{int(face_array.max())})"
        )

    return engine.Mesh(
        vertices=vertex_array,
        faces=face_array,
        color=(0.72, 0.72, 0.75),
        piece_id=piece_id,
    )


def _load_mesh(engine, filename: str, raw: bytes):
    extension = os.path.splitext(filename)[1].lower()
    if extension == ".obj":
        return _parse_obj(engine, raw.decode("utf-8", errors="replace"))

    if extension == ".stl":
        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as handle:
            handle.write(raw)
            path = handle.name
        try:
            return engine.load_stl(
                path,
                color=(0.72, 0.72, 0.75),
                piece_id=1000,
            )
        finally:
            os.unlink(path)

    raise ValueError(f"unsupported file type {extension!r}; use .stl or .obj")


def _validate_mesh_geometry(engine, mesh) -> None:
    np = engine.np
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    if vertices.ndim != 2 or vertices.shape[1] != 3 or vertices.shape[0] < 3:
        raise ValueError("mesh must contain at least three 3D vertices")
    if not np.all(np.isfinite(vertices)):
        raise ValueError("mesh contains non-finite vertex coordinates")

    extent = np.max(vertices, axis=0) - np.min(vertices, axis=0)
    if not np.all(np.isfinite(extent)):
        raise ValueError("mesh bounds are not finite")
    if float(np.max(extent)) <= 1e-9:
        raise ValueError("mesh has near-zero extent")


def _normalize_mesh(engine, mesh, target_size: float = 6.0):
    """Center X/Z, put the base on Y=0, and normalize the longest dimension."""
    np = engine.np
    minimum = mesh.aabb_min.astype(np.float64)
    maximum = mesh.aabb_max.astype(np.float64)
    center = (minimum + maximum) / 2.0
    size = float(np.max(maximum - minimum))
    if not math.isfinite(size) or size <= 1e-9:
        raise ValueError("mesh has near-zero or non-finite extent")
    scale = target_size / size

    vertices = (np.asarray(mesh.vertices, dtype=np.float64) - center) * scale
    vertices[:, 1] -= vertices[:, 1].min()

    return engine.Mesh(
        vertices=vertices,
        faces=mesh.faces,
        color=mesh.color,
        piece_id=mesh.piece_id,
        piece_type=mesh.piece_type,
    )


def _png_bytes(image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def _normalize_channel(engine, values, *, mask=None):
    np = engine.np
    arr = np.asarray(values, dtype=np.float64)
    valid = np.isfinite(arr)
    if mask is not None:
        valid &= np.asarray(mask, dtype=bool)
    normalized = np.zeros_like(arr, dtype=np.float64)
    if np.any(valid):
        lo, hi = np.percentile(arr[valid], [2, 98])
        if hi <= lo + 1e-12:
            normalized[valid] = 1.0
        else:
            normalized[valid] = np.clip((arr[valid] - lo) / (hi - lo), 0.0, 1.0)
    return normalized


def _grayscale_image(engine, values):
    np = engine.np
    Image = engine.Image
    pixels = np.round(np.clip(values, 0.0, 1.0) * 255).astype(np.uint8)
    return Image.fromarray(pixels, mode="L").convert("RGB")


def _depth_image(engine, depth):
    np = engine.np
    Image = engine.Image
    arr = np.asarray(depth, dtype=np.float64)
    mask = np.isfinite(arr) & (arr > 0)
    normalized = _normalize_channel(engine, arr, mask=mask)

    # Reserve zero for "no hit"; valid depth occupies 1..255.
    pixels = np.zeros(arr.shape, dtype=np.uint8)
    pixels[mask] = 1 + np.round(normalized[mask] * 254).astype(np.uint8)
    return Image.fromarray(pixels, mode="L").convert("RGB")


def _orient_hit_normals_against_rays(engine, burst) -> int:
    """Make mesh hit normals two-sided by orienting them toward the camera.

    Ray directions point from the camera into the scene, so a visible surface
    normal should have n·dir <= 0. Imported OBJ/STL winding is not reliable;
    flipping only back-facing hit normals makes shaded tone independent of face
    winding without changing hit positions, depth, or material color.
    """
    np = engine.np
    depths = np.asarray(burst.depths)
    normals = np.asarray(burst.normals)
    dirs = np.asarray(burst.dirs)
    hit = np.isfinite(depths) & (depths < getattr(engine, "INF", np.inf))
    if not np.any(hit):
        return 0

    indices = np.where(hit)[0]
    back_facing = np.sum(normals[indices] * dirs[indices], axis=1) > 0.0
    flip_indices = indices[back_facing]
    if flip_indices.size:
        burst.normals[flip_indices] *= -1.0
    return int(flip_indices.size)


def _confidence_map(engine, channels, rays_per_pixel: int):
    """Continuous sensor-confidence proxy from support, coherence, and depth stability."""
    np = engine.np
    hits = np.asarray(channels["hit_count"], dtype=np.float64)
    has_hit = hits > 0

    # Beam coherence is only meaningful once the engine has enough return
    # evidence. Below that threshold a stored zero means "not measured", not
    # "incoherent". Grow confidence with evidence instead of collapsing it.
    evidence_floor = max(float(rays_per_pixel), float(MIN_COHERENCE_HITS), 1.0)
    support = np.clip(hits / evidence_floor, 0.0, 1.0)
    if "return_valid_stats" in channels:
        coherence_measured = np.asarray(
            channels["return_valid_stats"], dtype=np.float64
        ) > 0.0
    else:
        coherence_measured = hits >= MIN_COHERENCE_HITS

    variance = np.asarray(channels["depth_variance"], dtype=np.float64)
    finite_hit_variance = variance[has_hit & np.isfinite(variance)]
    if finite_hit_variance.size and np.ptp(finite_hit_variance) > 1e-12:
        variance_norm = _normalize_channel(engine, variance, mask=has_hit)
    else:
        # A constant variance field carries no relative instability evidence.
        # _normalize_channel uses 1.0 for a flat channel for display purposes,
        # which would incorrectly apply the maximum confidence penalty here.
        variance_norm = np.zeros_like(variance)

    beam = np.asarray(
        channels.get("beam_coherence", np.ones_like(hits)),
        dtype=np.float64,
    )
    beam = np.where(coherence_measured, np.clip(beam, 0.0, 1.0), 1.0)

    confidence = np.sqrt(np.clip(support * beam, 0.0, 1.0))
    confidence *= 1.0 - 0.75 * variance_norm
    return np.where(has_hit, np.clip(confidence, 0.0, 1.0), 0.0)


def _int_option(
    options: dict[str, Any],
    key: str,
    default: int,
    low: int,
    high: int,
) -> int:
    raw = options.get(key, default)
    try:
        value = int(raw)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{key} must be an integer") from error
    return max(low, min(high, value))


def _float_option(
    options: dict[str, Any],
    key: str,
    default: float,
    low: float,
    high: float,
) -> float:
    raw = options.get(key, default)
    try:
        value = float(raw)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{key} must be a number") from error
    if not math.isfinite(value):
        raise ValueError(f"{key} must be finite")
    return max(low, min(high, value))


def _bool_option(options: dict[str, Any], key: str, default: bool) -> bool:
    raw = options.get(key, default)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        return bool(raw)
    if isinstance(raw, str):
        value = raw.strip().lower()
        if value in {"1", "true", "yes", "on"}:
            return True
        if value in {"0", "false", "no", "off", ""}:
            return False
    raise ValueError(f"{key} must be a boolean")


def _canonical_sensor_float(value: float) -> float:
    """Quantize sensor floats once so scan geometry, metadata, and cache agree."""
    scale = 10 ** SENSOR_FLOAT_DECIMALS
    # Sensor floats are validated/clamped non-negative. Match the browser's
    # Math.round rule so freshness signatures and server metadata agree.
    rounded = math.floor(float(value) * scale + 0.5) / scale
    return 0.0 if rounded == 0.0 else rounded


def _canonical_yaw_deg(value: float) -> float:
    wrapped = float(value) % 360.0
    return _canonical_sensor_float(wrapped)


def _normalized_scan_options(options: dict[str, Any] | None = None) -> dict[str, Any]:
    """Validate/clamp and canonicalize only inputs that change the sensor result."""
    options = options or {}
    yaw_deg = _float_option(options, "yaw_deg", DEFAULT_YAW_DEG, 0.0, 360.0)
    elevation_deg = _float_option(
        options, "elevation_deg", DEFAULT_ELEVATION_DEG, 5.0, 80.0
    )
    distance_scale = _float_option(
        options, "distance_scale", DEFAULT_DISTANCE_SCALE, 1.4, 6.0
    )
    fov_deg = _float_option(options, "fov_deg", DEFAULT_FOV_DEG, 25.0, 90.0)
    return {
        "width": _int_option(options, "width", DEFAULT_WIDTH, 64, 640),
        "height": _int_option(options, "height", DEFAULT_HEIGHT, 64, 480),
        "rays_per_pixel": _int_option(
            options,
            "rays_per_pixel",
            DEFAULT_RAYS_PER_PIXEL,
            1,
            4,
        ),
        "seed": _int_option(
            options,
            "seed",
            DEFAULT_SEED,
            1,
            2_147_483_647,
        ),
        "smart_sampling": _bool_option(options, "smart_sampling", False),
        "yaw_deg": _canonical_yaw_deg(yaw_deg),
        "elevation_deg": _canonical_sensor_float(elevation_deg),
        "distance_scale": _canonical_sensor_float(distance_scale),
        "fov_deg": _canonical_sensor_float(fov_deg),
    }


def _scan_cache_key(scene_info: dict[str, Any], scan_options: dict[str, Any]) -> str:
    """Stable content key for expensive LiDAR results.

    Art settings are intentionally absent. The key contains only the model
    content identity and normalized sensor inputs.
    """
    fingerprint = scene_info.get("sha256")
    if not fingerprint:
        raise ValueError("loaded scene is missing its content fingerprint")

    payload = {
        "model_sha256": str(fingerprint),
        "width": int(scan_options["width"]),
        "height": int(scan_options["height"]),
        "rays_per_pixel": int(scan_options["rays_per_pixel"]),
        "smart_sampling": bool(scan_options["smart_sampling"]),
        "yaw_deg": float(scan_options["yaw_deg"]),
        "elevation_deg": float(scan_options["elevation_deg"]),
        "distance_scale": float(scan_options["distance_scale"]),
        "fov_deg": float(scan_options["fov_deg"]),
        "seed": int(scan_options["seed"]),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _camera_for_options(
    engine,
    scene,
    *,
    width: int,
    height: int,
    yaw_deg: float,
    elevation_deg: float,
    distance_scale: float,
    fov_deg: float,
):
    np = engine.np
    bounds = engine.scene_bounds(scene)
    center = np.asarray(bounds["center"], dtype=np.float64)
    span = np.asarray(bounds["span"], dtype=np.float64)
    radius = max(float(np.linalg.norm(span)) * 0.5, 0.5)

    yaw = math.radians(yaw_deg)
    elevation = math.radians(elevation_deg)
    horizontal = math.cos(elevation)
    direction = np.array(
        [
            math.sin(yaw) * horizontal,
            math.sin(elevation),
            math.cos(yaw) * horizontal,
        ],
        dtype=np.float64,
    )
    position = center + direction * radius * distance_scale

    return engine.Camera(
        position=position,
        target=center,
        up=np.array([0.0, 1.0, 0.0], dtype=np.float64),
        fov_deg=fov_deg,
        width=width,
        height=height,
        lens="pinhole",
        sampling_mode="halton",
    )


class LidarBridge:
    """Owns mesh loading and configurable single-view LiDAR scans for Phase 4."""

    def __init__(self, state) -> None:
        self.state = state
        self._fusion_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._fusion_cache_max_entries = 8

    def upload_scene(self, filename: str, raw: bytes) -> dict[str, Any]:
        if not filename:
            raise ValueError("filename is required")
        if not raw:
            raise ValueError("uploaded model is empty")

        engine = _load_engine()
        mesh = _load_mesh(engine, filename, raw)
        _validate_mesh_geometry(engine, mesh)
        triangle_count = int(mesh.faces.shape[0])
        if triangle_count > MAX_TRIANGLES:
            raise ValueError(
                f"mesh has {triangle_count:,} triangles; "
                f"Phase 4 limit is {MAX_TRIANGLES:,}"
            )

        mesh = _normalize_mesh(engine, mesh)
        _validate_mesh_geometry(engine, mesh)
        scene = engine.Scene(meshes=[mesh])
        fingerprint = hashlib.sha256(raw).hexdigest()
        info = {
            "name": filename,
            "format": os.path.splitext(filename)[1].lower().lstrip("."),
            "triangles": int(mesh.faces.shape[0]),
            "vertices": int(mesh.vertices.shape[0]),
            "bounds_min": [round(float(x), 4) for x in mesh.aabb_min],
            "bounds_max": [round(float(x), 4) for x in mesh.aabb_max],
            "normalized": True,
            "sha256": fingerprint,
        }
        self.state.set_scene(scene, info)
        return info

    def scan(self, options: dict[str, Any] | None = None) -> dict[str, Any]:
        scene = self.state.get_scene_object()
        if scene is None:
            raise ValueError("no 3D model is loaded")

        scene_info = self.state.snapshot()["workspace"]["scene"]
        normalized = _normalized_scan_options(options)
        cache_key = _scan_cache_key(scene_info, normalized)

        cached = self.state.get_cached_scan(cache_key)
        if cached is not None:
            metadata = dict(cached["metadata"])
            metadata["cache_hit"] = True
            metadata["cache_key"] = cache_key
            self.state.set_scan(
                metadata["scan_id"],
                metadata,
                cached["channels"],
                cached.get("evidence"),
            )
            return self.maps_summary()

        engine = _load_engine()
        width = normalized["width"]
        height = normalized["height"]
        rays_per_pixel = normalized["rays_per_pixel"]
        seed = normalized["seed"]
        smart_sampling = normalized["smart_sampling"]
        yaw_deg = normalized["yaw_deg"]
        elevation_deg = normalized["elevation_deg"]
        distance_scale = normalized["distance_scale"]
        fov_deg = normalized["fov_deg"]

        camera = _camera_for_options(
            engine,
            scene,
            width=width,
            height=height,
            yaw_deg=yaw_deg,
            elevation_deg=elevation_deg,
            distance_scale=distance_scale,
            fov_deg=fov_deg,
        )
        sample_count = width * height * rays_per_pixel
        burst_fn = engine.scout_then_fill if smart_sampling else engine.fire_burst
        burst = burst_fn(
            camera,
            scene,
            n_samples=sample_count,
            seed=seed,
            beam_profile="gaussian",
            beam_width=0.35,
            min_ray_weight=0.05,
        )
        _orient_hit_normals_against_rays(engine, burst)
        channels = engine.compute_wave_channels(
            burst,
            scene,
            edge_score_mode="geom_fused",
            edge_fusion_mode="depth_grad_mul",
            include_sound=False,
            include_ultrasonic=False,
            include_polarization=False,
        )

        shaded = engine.render_burst(
            burst,
            mode="shaded",
            bg="#ffffff",
        )
        depth = _depth_image(engine, channels["depth_per_pixel"])
        edge = _grayscale_image(engine, channels["edge_score_geom"])
        variance_norm = _normalize_channel(
            engine,
            channels["depth_variance"],
            mask=channels["hit_count"] > 0,
        )
        variance = _grayscale_image(engine, variance_norm)
        confidence_values = _confidence_map(engine, channels, rays_per_pixel)
        confidence = _grayscale_image(engine, confidence_values)
        hit_pixels = engine.np.asarray(channels["hit_count"]) > 0
        mean_confidence = (
            float(engine.np.mean(confidence_values[hit_pixels]))
            if engine.np.any(hit_pixels)
            else 0.0
        )
        quality_score = scan_quality_score(burst.coverage, mean_confidence)
        evidence = encode_scan_evidence(
            channels["depth_per_pixel"],
            confidence_values,
        )

        scan_id = uuid.uuid4().hex[:12]
        metadata = {
            "scan_id": scan_id,
            "cache_key": cache_key,
            "cache_hit": False,
            "width": width,
            "height": height,
            "rays_per_pixel": rays_per_pixel,
            "seed": seed,
            "smart_sampling": smart_sampling,
            "coverage": round(float(burst.coverage), 6),
            "mean_confidence": round(mean_confidence, 6),
            "quality_score": quality_score,
            "fusion_evidence_version": EVIDENCE_VERSION,
            "camera": {
                "yaw_deg": yaw_deg,
                "elevation_deg": elevation_deg,
                "distance_scale": distance_scale,
                "fov_deg": fov_deg,
            },
            "camera_position": [float(x) for x in camera.position],
            "camera_target": [float(x) for x in camera.target],
            "scene": {
                "name": scene_info.get("name"),
                "triangles": scene_info.get("triangles"),
                "vertices": scene_info.get("vertices"),
                "sha256": scene_info.get("sha256"),
            },
        }
        image_bytes = {
            "shaded": _png_bytes(shaded),
            "depth": _png_bytes(depth),
            "edge": _png_bytes(edge),
            "variance": _png_bytes(variance),
            "confidence": _png_bytes(confidence),
        }
        self.state.set_scan(scan_id, metadata, image_bytes, evidence)
        self.state.put_cached_scan(cache_key, metadata, image_bytes, evidence)
        return self.maps_summary()

    def scan_fixed_views(
        self,
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Scan the five deterministic Phase 12 views through the normal cache."""
        base = dict(options or {})
        views: dict[str, dict[str, Any]] = {}

        for name in FIXED_VIEW_ORDER:
            descriptor = FIXED_VIEWS[name]
            view_options = dict(base)
            view_options["yaw_deg"] = descriptor["yaw_deg"]
            view_options["elevation_deg"] = descriptor["elevation_deg"]
            scan = self.scan(view_options)
            scan["view"] = {
                "name": name,
                "label": descriptor["label"],
                "yaw_deg": descriptor["yaw_deg"],
                "elevation_deg": descriptor["elevation_deg"],
            }
            views[name] = scan

        return {
            "mode": "fixed",
            "order": list(FIXED_VIEW_ORDER),
            "views": views,
            "current_view": FIXED_VIEW_ORDER[-1],
            "cache": self.state.scan_cache_stats(),
        }

    def scan_auto_views(
        self,
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Acquire a deterministic, quality-weighted set of useful viewpoints."""
        base = dict(options or {})
        target = _float_option(base, "auto_target", DEFAULT_AUTO_TARGET, 0.20, 0.98)
        min_views = _int_option(base, "auto_min_views", DEFAULT_AUTO_MIN_VIEWS, 1, 8)
        max_views = _int_option(
            base, "auto_max_views", DEFAULT_AUTO_MAX_VIEWS, min_views, 10
        )
        min_gain = _float_option(
            base, "auto_min_gain", DEFAULT_AUTO_MIN_GAIN, 0.0, 0.50
        )
        min_separation = _float_option(
            base,
            "auto_min_separation_deg",
            DEFAULT_AUTO_MIN_SEPARATION_DEG,
            10.0,
            90.0,
        )
        for key in (
            "auto_target",
            "auto_min_views",
            "auto_max_views",
            "auto_min_gain",
            "auto_min_separation_deg",
        ):
            base.pop(key, None)

        candidates = generate_candidate_views()
        acquired: list[dict[str, Any]] = []
        views: dict[str, dict[str, Any]] = {}
        steps: list[dict[str, Any]] = []
        reason = "no_candidate"

        while True:
            coverage_before = view_space_coverage_score(candidates, acquired)
            candidate = choose_next_candidate(
                candidates,
                acquired,
                min_separation_deg=min_separation,
            )
            expected_gain = (
                float(candidate.get("expected_gain", 0.0))
                if candidate is not None
                else None
            )
            should_stop = auto_stop_reason(
                view_count=len(acquired),
                coverage_score=coverage_before,
                next_expected_gain=expected_gain,
                target=target,
                min_views=min_views,
                max_views=max_views,
                min_gain=min_gain,
            )
            if should_stop:
                reason = should_stop
                break
            if candidate is None:
                reason = "no_candidate"
                break

            view_options = dict(base)
            view_options["yaw_deg"] = candidate["yaw_deg"]
            view_options["elevation_deg"] = candidate["elevation_deg"]
            scan = self.scan(view_options)
            quality = normalize_view_quality(
                scan.get("quality_score", scan.get("coverage", 0.0))
            )
            acquired_view = {
                "name": candidate["name"],
                "label": candidate["label"],
                "yaw_deg": candidate["yaw_deg"],
                "elevation_deg": candidate["elevation_deg"],
                "quality_score": quality,
            }
            acquired.append(acquired_view)
            coverage_after = view_space_coverage_score(candidates, acquired)

            scan["view"] = {
                **acquired_view,
                "kind": "auto",
            }
            views[candidate["name"]] = scan
            steps.append({
                **acquired_view,
                "scan_id": scan.get("scan_id"),
                "cache_hit": bool(scan.get("cache_hit")),
                "ray_hit_fraction": round(float(scan.get("coverage", 0.0)), 6),
                "coverage_before": coverage_before,
                "coverage_after": coverage_after,
                "expected_gain": round(float(expected_gain or 0.0), 6),
                "actual_gain": round(coverage_after - coverage_before, 6),
            })

        order = [view["name"] for view in acquired]
        final_coverage = view_space_coverage_score(candidates, acquired)
        return {
            "mode": "auto",
            "order": order,
            "views": views,
            "current_view": order[-1] if order else None,
            "planner": {
                "metric": "quality-weighted view-space coverage",
                "coverage_score": final_coverage,
                "target": target,
                "min_views": min_views,
                "max_views": max_views,
                "min_gain": min_gain,
                "min_separation_deg": min_separation,
                "stop_reason": reason,
                "candidate_count": len(candidates),
                "steps": steps,
            },
            "cache": self.state.scan_cache_stats(),
        }

    def inspection_scene(self) -> dict[str, Any]:
        scene = self.state.get_scene_object()
        if scene is None:
            raise ValueError("no 3D model is loaded")
        scene_info = self.state.snapshot()["workspace"]["scene"]
        return scene_inspection_snapshot(scene, scene_info)

    def inspection_scan(self, scan_id: str | None = None) -> dict[str, Any]:
        requested = str(scan_id or "").strip()
        if requested:
            stored = self.state.get_scan_by_id(requested)
        else:
            current = self.state.get_scan()
            stored = (
                self.state.get_scan_by_id(current["metadata"].get("scan_id"))
                if current
                else None
            )
        if stored is None:
            raise ScanIdMismatchError("requested inspection scan is not available")
        return scan_inspection_snapshot(stored)

    def project_ink3d(self, payload: dict[str, Any]) -> dict[str, Any]:
        scene = self.state.get_scene_object()
        if scene is None:
            raise ValueError("no 3D model is loaded")

        scan_id = str(payload.get("scan_id") or "").strip()
        if not scan_id:
            raise ValueError("scan_id is required for 3D Ink")
        stored = self.state.get_scan_by_id(scan_id)
        if stored is None:
            raise ScanIdMismatchError("requested 3D Ink scan is not available")
        if not stored.get("evidence"):
            raise ValueError("selected scan does not contain cached confidence evidence")

        current_scene = self.state.snapshot()["workspace"]["scene"]
        scan_scene_hash = stored["metadata"].get("scene", {}).get("sha256")
        current_scene_hash = current_scene.get("sha256")
        if scan_scene_hash and current_scene_hash and scan_scene_hash != current_scene_hash:
            raise ScanIdMismatchError("selected 3D Ink scan belongs to a different model")

        engine = _load_engine()
        return project_strokes_to_mesh(scene, stored, payload, engine=engine)

    def clear_fusion_cache(self) -> None:
        self._fusion_cache.clear()

    def fuse_scan_confidence(
        self,
        scan_ids: list[str],
    ) -> dict[str, Any]:
        """Fuse cached metric evidence into every requested canonical view."""
        ordered_ids = []
        seen = set()
        for raw in scan_ids:
            scan_id = str(raw or "").strip()
            if not scan_id or scan_id in seen:
                continue
            seen.add(scan_id)
            ordered_ids.append(scan_id)
        if len(ordered_ids) < 2:
            raise ValueError("confidence fusion requires at least two distinct scans")
        if len(ordered_ids) > 8:
            raise ValueError("confidence fusion supports at most eight scans")

        scans = []
        for scan_id in ordered_ids:
            stored = self.state.get_scan_by_id(scan_id)
            if stored is None:
                raise ScanIdMismatchError(
                    f"scan {scan_id} is not available for confidence fusion"
                )
            if not stored.get("evidence"):
                raise ValueError(
                    f"scan {scan_id} does not contain Phase 14 fusion evidence"
                )
            scans.append(stored)

        fingerprints = {
            scan["metadata"].get("scene", {}).get("sha256")
            for scan in scans
        }
        if len(fingerprints) != 1:
            raise ValueError("all fused scans must belong to the same model")

        key_payload = {
            "scan_ids": sorted(ordered_ids),
            "evidence_version": EVIDENCE_VERSION,
        }
        canonical = json.dumps(key_payload, sort_keys=True, separators=(",", ":"))
        fusion_id = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
        cached = self._fusion_cache.get(fusion_id)
        if cached is not None:
            self._fusion_cache.move_to_end(fusion_id)
            return {
                **cached["summary"],
                "cache_hit": True,
            }

        views: dict[str, dict[str, Any]] = {}
        pngs: dict[tuple[str, str], bytes] = {}
        for scan_id in ordered_ids:
            fused = fuse_confidence(scans, scan_id)
            pngs[(scan_id, "confidence")] = grayscale_png(fused["confidence"])
            pngs[(scan_id, "support")] = support_png(
                fused["support"],
                len(ordered_ids),
            )
            views[scan_id] = {
                "scan_id": scan_id,
                "mean_confidence": round(float(fused["mean_confidence"]), 6),
                "overlap_fraction": round(float(fused["overlap_fraction"]), 6),
                "max_support": int(fused["max_support"]),
                "width": int(fused["width"]),
                "height": int(fused["height"]),
                "confidence": (
                    f"/api/lidar/fusion/confidence.png?fusion_id={fusion_id}"
                    f"&scan_id={scan_id}"
                ),
                "support": (
                    f"/api/lidar/fusion/support.png?fusion_id={fusion_id}"
                    f"&scan_id={scan_id}"
                ),
            }

        summary = {
            "fusion_id": fusion_id,
            "cache_hit": False,
            "source_count": len(ordered_ids),
            "scan_ids": ordered_ids,
            "metric": "world-space reprojected confidence agreement",
            "views": views,
        }
        self._fusion_cache[fusion_id] = {
            "summary": summary,
            "pngs": pngs,
        }
        self._fusion_cache.move_to_end(fusion_id)
        while len(self._fusion_cache) > self._fusion_cache_max_entries:
            self._fusion_cache.popitem(last=False)
        return summary

    def fusion_png(
        self,
        fusion_id: str,
        scan_id: str,
        channel: str,
    ) -> bytes:
        if channel not in {"confidence", "support"}:
            raise ValueError("unknown confidence-fusion channel")
        entry = self._fusion_cache.get(str(fusion_id or ""))
        if entry is None:
            raise ScanIdMismatchError("confidence fusion result is not available")
        payload = entry["pngs"].get((str(scan_id or ""), channel))
        if payload is None:
            raise ScanIdMismatchError("requested fused scan is not available")
        self._fusion_cache.move_to_end(str(fusion_id))
        return payload

    def maps_summary(self, scan_id: str | None = None) -> dict[str, Any]:
        if scan_id:
            scan = self.state.get_scan_by_id(scan_id)
            if scan is None:
                raise ScanIdMismatchError(
                    f"requested scan {scan_id!r} is not available"
                )
        else:
            scan = self.state.get_scan()
            if scan is None:
                raise ValueError("no LiDAR scan is available")

        metadata = dict(scan["metadata"])
        resolved_scan_id = metadata["scan_id"]
        metadata["channels"] = {
            name: f"/api/lidar/maps/{name}.png?scan_id={resolved_scan_id}"
            for name in ("shaded", "depth", "edge", "variance", "confidence")
        }
        metadata["cache"] = self.state.scan_cache_stats()
        return metadata

    def channel_png(self, channel: str, scan_id: str | None = None) -> bytes:
        allowed = {"shaded", "depth", "edge", "variance", "confidence"}
        if channel not in allowed:
            raise ValueError(f"unknown LiDAR channel {channel!r}")

        if scan_id:
            payload = self.state.get_scan_channel_for(scan_id, channel)
            if payload is None:
                raise ScanIdMismatchError(
                    f"requested scan {scan_id!r} is not available"
                )
            return payload

        payload = self.state.get_scan_channel(channel)
        if payload is None:
            raise ValueError("no LiDAR scan is available")
        return payload

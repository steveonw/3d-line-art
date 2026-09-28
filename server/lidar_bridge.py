"""Minimal Phase 3 bridge between the local server and the vendored LiDAR engine."""

from __future__ import annotations

import io
import os
import tempfile
import uuid
from typing import Any

MAX_TRIANGLES = 250_000
DEFAULT_WIDTH = 320
DEFAULT_HEIGHT = 240
DEFAULT_RAYS_PER_PIXEL = 2
DEFAULT_SEED = 42


class LidarUnavailableError(RuntimeError):
    """Raised when optional LiDAR runtime dependencies are unavailable."""


def _load_engine():
    try:
        from vendor import lidar_engine as engine
    except ImportError as error:
        raise LidarUnavailableError(
            "LiDAR dependencies are unavailable. Run: pip install -r requirements.txt"
        ) from error
    return engine


def _parse_obj(engine, text: str, *, piece_id: int = 1000):
    """Minimal Wavefront OBJ -> engine Mesh.

    Adapted from steveonw/lidar-engine's browser studio. Polygon faces are fan
    triangulated; texture and normal indices are ignored.
    """
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


def _normalize_mesh(engine, mesh, target_size: float = 6.0):
    """Center X/Z, put the base on Y=0, and normalize the longest dimension."""
    np = engine.np
    minimum = mesh.aabb_min.astype(np.float64)
    maximum = mesh.aabb_max.astype(np.float64)
    center = (minimum + maximum) / 2.0
    size = float(np.max(maximum - minimum))
    scale = target_size / size if size > 1e-9 else 1.0

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


def _depth_image(engine, depth):
    np = engine.np
    Image = engine.Image
    arr = np.asarray(depth, dtype=np.float64)
    mask = np.isfinite(arr) & (arr > 0)
    normalized = np.zeros_like(arr, dtype=np.float64)

    if mask.any():
        values = arr[mask]
        lo, hi = np.percentile(values, [2, 98])
        if hi <= lo + 1e-12:
            normalized[mask] = 1.0
        else:
            normalized[mask] = np.clip((arr[mask] - lo) / (hi - lo), 0.0, 1.0)

    # Reserve zero for "no hit"; valid depth occupies 1..255.
    pixels = np.zeros(arr.shape, dtype=np.uint8)
    pixels[mask] = 1 + np.round(normalized[mask] * 254).astype(np.uint8)
    return Image.fromarray(pixels, mode="L").convert("RGB")


def _edge_image(engine, edge):
    np = engine.np
    Image = engine.Image
    pixels = np.round(np.clip(edge, 0.0, 1.0) * 255).astype(np.uint8)
    return Image.fromarray(pixels, mode="L").convert("RGB")


def _int_option(options: dict[str, Any], key: str, default: int, low: int, high: int) -> int:
    raw = options.get(key, default)
    try:
        value = int(raw)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{key} must be an integer") from error
    return max(low, min(high, value))


class LidarBridge:
    """Owns mesh loading and single-view LiDAR scans for Phase 3."""

    def __init__(self, state) -> None:
        self.state = state

    def upload_scene(self, filename: str, raw: bytes) -> dict[str, Any]:
        if not filename:
            raise ValueError("filename is required")
        if not raw:
            raise ValueError("uploaded model is empty")

        engine = _load_engine()
        mesh = _load_mesh(engine, filename, raw)
        triangle_count = int(mesh.faces.shape[0])
        if triangle_count > MAX_TRIANGLES:
            raise ValueError(
                f"mesh has {triangle_count:,} triangles; "
                f"Phase 3 limit is {MAX_TRIANGLES:,}"
            )

        mesh = _normalize_mesh(engine, mesh)
        scene = engine.Scene(meshes=[mesh])
        info = {
            "name": filename,
            "format": os.path.splitext(filename)[1].lower().lstrip("."),
            "triangles": int(mesh.faces.shape[0]),
            "vertices": int(mesh.vertices.shape[0]),
            "bounds_min": [round(float(x), 4) for x in mesh.aabb_min],
            "bounds_max": [round(float(x), 4) for x in mesh.aabb_max],
            "normalized": True,
        }
        self.state.set_scene(scene, info)
        return info

    def scan(self, options: dict[str, Any] | None = None) -> dict[str, Any]:
        options = options or {}
        scene = self.state.get_scene_object()
        if scene is None:
            raise ValueError("no 3D model is loaded")

        engine = _load_engine()
        width = _int_option(options, "width", DEFAULT_WIDTH, 64, 640)
        height = _int_option(options, "height", DEFAULT_HEIGHT, 64, 480)
        rays_per_pixel = _int_option(
            options,
            "rays_per_pixel",
            DEFAULT_RAYS_PER_PIXEL,
            1,
            4,
        )
        seed = _int_option(options, "seed", DEFAULT_SEED, 1, 2_147_483_647)

        camera = engine.make_camera_for_preset(
            scene,
            "compact_diagnostic",
            width=width,
            height=height,
        )
        burst = engine.fire_burst(
            camera,
            scene,
            n_samples=width * height * rays_per_pixel,
            seed=seed,
            beam_profile="gaussian",
            beam_width=0.35,
            min_ray_weight=0.05,
        )
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
        edge = _edge_image(engine, channels["edge_score_geom"])

        scan_id = uuid.uuid4().hex[:12]
        scene_info = self.state.snapshot()["workspace"]["scene"]
        metadata = {
            "scan_id": scan_id,
            "width": width,
            "height": height,
            "rays_per_pixel": rays_per_pixel,
            "seed": seed,
            "coverage": round(float(burst.coverage), 6),
            "camera_position": [round(float(x), 4) for x in camera.position],
            "camera_target": [round(float(x), 4) for x in camera.target],
            "scene": {
                "name": scene_info.get("name"),
                "triangles": scene_info.get("triangles"),
                "vertices": scene_info.get("vertices"),
            },
        }
        image_bytes = {
            "shaded": _png_bytes(shaded),
            "depth": _png_bytes(depth),
            "edge": _png_bytes(edge),
        }
        self.state.set_scan(scan_id, metadata, image_bytes)
        return self.maps_summary()

    def maps_summary(self) -> dict[str, Any]:
        scan = self.state.get_scan()
        if scan is None:
            raise ValueError("no LiDAR scan is available")
        metadata = dict(scan["metadata"])
        scan_id = metadata["scan_id"]
        metadata["channels"] = {
            "shaded": f"/api/lidar/maps/shaded.png?scan_id={scan_id}",
            "depth": f"/api/lidar/maps/depth.png?scan_id={scan_id}",
            "edge": f"/api/lidar/maps/edge.png?scan_id={scan_id}",
        }
        return metadata

    def channel_png(self, channel: str) -> bytes:
        if channel not in {"shaded", "depth", "edge"}:
            raise ValueError(f"unknown LiDAR channel {channel!r}")
        payload = self.state.get_scan_channel(channel)
        if payload is None:
            raise ValueError("no LiDAR scan is available")
        return payload

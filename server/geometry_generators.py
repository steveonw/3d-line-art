"""Deterministic built-in mesh generators for Phase 17.

Every generator emits ordinary OBJ bytes. The bridge intentionally routes those
bytes back through the same OBJ loader / validation / normalization boundary as
an uploaded model.
"""

from __future__ import annotations

import math
from typing import Any

MAX_SEGMENTS = 128
MAX_RINGS = 96
MAX_GRID = 80
MAX_PROFILE_POINTS = 32


def _finite(value: Any, name: str, default: float) -> float:
    if value is None:
        return float(default)
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be a number") from error
    if not math.isfinite(number):
        raise ValueError(f"{name} must be finite")
    return number


def _bounded_float(
    value: Any,
    name: str,
    default: float,
    low: float,
    high: float,
) -> float:
    number = _finite(value, name, default)
    if number < low or number > high:
        raise ValueError(f"{name} must be between {low:g} and {high:g}")
    return number


def _bounded_int(
    value: Any,
    name: str,
    default: int,
    low: int,
    high: int,
) -> int:
    number = _finite(value, name, float(default))
    rounded = int(round(number))
    if abs(number - rounded) > 1e-9:
        raise ValueError(f"{name} must be an integer")
    if rounded < low or rounded > high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return rounded


def _add_face(faces: list[tuple[int, int, int]], a: int, b: int, c: int) -> None:
    if a == b or b == c or a == c:
        return
    faces.append((a, b, c))


def _obj_bytes(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, int, int]],
    *,
    label: str,
) -> bytes:
    if len(vertices) < 3 or not faces:
        raise ValueError("generated geometry is empty")
    lines = [
        "# LiDAR Ink deterministic generated geometry",
        f"o {label}",
    ]
    for x, y, z in vertices:
        lines.append(f"v {x:.9f} {y:.9f} {z:.9f}")
    for a, b, c in faces:
        lines.append(f"f {a + 1} {b + 1} {c + 1}")
    lines.append("")
    return "\n".join(lines).encode("utf-8")


def _box(spec: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
    width = _bounded_float(spec.get("width"), "width", 2.0, 0.05, 100.0)
    height = _bounded_float(spec.get("height"), "height", 2.0, 0.05, 100.0)
    depth = _bounded_float(spec.get("depth"), "depth", 2.0, 0.05, 100.0)
    x = width * 0.5
    z = depth * 0.5
    vertices = [
        (-x, 0.0, -z), (x, 0.0, -z), (x, height, -z), (-x, height, -z),
        (-x, 0.0, z), (x, 0.0, z), (x, height, z), (-x, height, z),
    ]
    faces = [
        (0, 2, 1), (0, 3, 2),
        (4, 5, 6), (4, 6, 7),
        (0, 4, 7), (0, 7, 3),
        (1, 2, 6), (1, 6, 5),
        (3, 7, 6), (3, 6, 2),
        (0, 1, 5), (0, 5, 4),
    ]
    canonical = {"type": "box", "width": width, "height": height, "depth": depth}
    return canonical, _obj_bytes(vertices, faces, label="generated_box")


def _sphere(spec: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
    radius = _bounded_float(spec.get("radius"), "radius", 1.0, 0.05, 100.0)
    segments = _bounded_int(spec.get("segments"), "segments", 32, 8, MAX_SEGMENTS)
    rings = _bounded_int(spec.get("rings"), "rings", 16, 4, MAX_RINGS)

    vertices: list[tuple[float, float, float]] = [(0.0, radius, 0.0)]
    ring_indices: list[list[int]] = []
    for ring in range(1, rings):
        phi = math.pi * ring / rings
        y = radius * math.cos(phi)
        rr = radius * math.sin(phi)
        indices: list[int] = []
        for segment in range(segments):
            theta = 2.0 * math.pi * segment / segments
            indices.append(len(vertices))
            vertices.append((rr * math.cos(theta), y, rr * math.sin(theta)))
        ring_indices.append(indices)
    bottom = len(vertices)
    vertices.append((0.0, -radius, 0.0))

    faces: list[tuple[int, int, int]] = []
    first = ring_indices[0]
    for s in range(segments):
        n = (s + 1) % segments
        _add_face(faces, 0, first[s], first[n])

    for a_ring, b_ring in zip(ring_indices[:-1], ring_indices[1:]):
        for s in range(segments):
            n = (s + 1) % segments
            _add_face(faces, a_ring[s], b_ring[s], b_ring[n])
            _add_face(faces, a_ring[s], b_ring[n], a_ring[n])

    last = ring_indices[-1]
    for s in range(segments):
        n = (s + 1) % segments
        _add_face(faces, last[s], bottom, last[n])

    canonical = {
        "type": "sphere",
        "radius": radius,
        "segments": segments,
        "rings": rings,
    }
    return canonical, _obj_bytes(vertices, faces, label="generated_sphere")


def _cylinder(spec: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
    radius = _bounded_float(spec.get("radius"), "radius", 1.0, 0.05, 100.0)
    height = _bounded_float(spec.get("height"), "height", 2.0, 0.05, 100.0)
    segments = _bounded_int(spec.get("segments"), "segments", 32, 6, MAX_SEGMENTS)

    vertices: list[tuple[float, float, float]] = []
    bottom_ring: list[int] = []
    top_ring: list[int] = []
    for s in range(segments):
        theta = 2.0 * math.pi * s / segments
        x = radius * math.cos(theta)
        z = radius * math.sin(theta)
        bottom_ring.append(len(vertices))
        vertices.append((x, 0.0, z))
        top_ring.append(len(vertices))
        vertices.append((x, height, z))
    bottom_center = len(vertices)
    vertices.append((0.0, 0.0, 0.0))
    top_center = len(vertices)
    vertices.append((0.0, height, 0.0))

    faces: list[tuple[int, int, int]] = []
    for s in range(segments):
        n = (s + 1) % segments
        _add_face(faces, bottom_ring[s], top_ring[s], top_ring[n])
        _add_face(faces, bottom_ring[s], top_ring[n], bottom_ring[n])
        _add_face(faces, bottom_center, bottom_ring[n], bottom_ring[s])
        _add_face(faces, top_center, top_ring[s], top_ring[n])

    canonical = {
        "type": "cylinder",
        "radius": radius,
        "height": height,
        "segments": segments,
    }
    return canonical, _obj_bytes(vertices, faces, label="generated_cylinder")


DEFAULT_LATHE_PROFILE = (
    (0.0, -1.0),
    (0.72, -0.92),
    (0.92, -0.35),
    (0.58, 0.1),
    (0.76, 0.72),
    (0.0, 1.0),
)


def _profile(spec: dict[str, Any]) -> list[tuple[float, float]]:
    raw = spec.get("profile")
    if raw is None:
        return [tuple(point) for point in DEFAULT_LATHE_PROFILE]
    if not isinstance(raw, list) or not 2 <= len(raw) <= MAX_PROFILE_POINTS:
        raise ValueError(
            f"profile must contain 2..{MAX_PROFILE_POINTS} [radius, y] points"
        )
    profile: list[tuple[float, float]] = []
    for index, point in enumerate(raw):
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            raise ValueError(f"profile point {index + 1} must be [radius, y]")
        radius = _bounded_float(point[0], f"profile[{index}].radius", 0.0, 0.0, 100.0)
        y = _bounded_float(point[1], f"profile[{index}].y", 0.0, -100.0, 100.0)
        profile.append((radius, y))
    if max(r for r, _ in profile) <= 1e-9:
        raise ValueError("profile must contain a positive radius")
    if max(y for _, y in profile) - min(y for _, y in profile) <= 1e-9:
        raise ValueError("profile must span a non-zero height")
    for a, b in zip(profile[:-1], profile[1:]):
        if abs(a[0] - b[0]) <= 1e-12 and abs(a[1] - b[1]) <= 1e-12:
            raise ValueError("profile contains duplicate consecutive points")
    return profile


def _lathe(spec: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
    profile = _profile(spec)
    segments = _bounded_int(spec.get("segments"), "segments", 36, 6, MAX_SEGMENTS)
    vertices: list[tuple[float, float, float]] = []
    rows: list[list[int]] = []

    for radius, y in profile:
        if radius <= 1e-10:
            rows.append([len(vertices)])
            vertices.append((0.0, y, 0.0))
            continue
        row: list[int] = []
        for s in range(segments):
            theta = 2.0 * math.pi * s / segments
            row.append(len(vertices))
            vertices.append((radius * math.cos(theta), y, radius * math.sin(theta)))
        rows.append(row)

    faces: list[tuple[int, int, int]] = []
    for a_row, b_row in zip(rows[:-1], rows[1:]):
        if len(a_row) == 1 and len(b_row) == 1:
            continue
        if len(a_row) == 1:
            pole = a_row[0]
            for s in range(segments):
                n = (s + 1) % segments
                _add_face(faces, pole, b_row[s], b_row[n])
            continue
        if len(b_row) == 1:
            pole = b_row[0]
            for s in range(segments):
                n = (s + 1) % segments
                _add_face(faces, a_row[s], pole, a_row[n])
            continue
        for s in range(segments):
            n = (s + 1) % segments
            _add_face(faces, a_row[s], b_row[s], b_row[n])
            _add_face(faces, a_row[s], b_row[n], a_row[n])

    # Close non-axis endpoints so custom open profiles still become ordinary
    # solid scan geometry.
    if len(rows[0]) > 1:
        center = len(vertices)
        vertices.append((0.0, profile[0][1], 0.0))
        for s in range(segments):
            n = (s + 1) % segments
            _add_face(faces, center, rows[0][n], rows[0][s])
    if len(rows[-1]) > 1:
        center = len(vertices)
        vertices.append((0.0, profile[-1][1], 0.0))
        for s in range(segments):
            n = (s + 1) % segments
            _add_face(faces, center, rows[-1][s], rows[-1][n])

    canonical = {
        "type": "lathe",
        "segments": segments,
        "profile": [[round(r, 9), round(y, 9)] for r, y in profile],
    }
    return canonical, _obj_bytes(vertices, faces, label="generated_lathe")


def _height_value(pattern: str, x: float, z: float, amplitude: float, frequency: float) -> float:
    if pattern == "ripple":
        r = math.hypot(x, z)
        return amplitude * math.sin(math.pi * frequency * r) * math.exp(-0.45 * r)
    if pattern == "saddle":
        return amplitude * 0.5 * (x * x - z * z)
    if pattern == "radial":
        r = math.hypot(x, z)
        return amplitude * math.cos(math.pi * frequency * r) / (1.0 + 0.6 * r)
    # waves
    return amplitude * 0.5 * (
        math.sin(math.pi * frequency * x)
        + math.cos(math.pi * frequency * z)
    )


def _heightfield(spec: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
    width = _bounded_float(spec.get("width"), "width", 3.0, 0.1, 100.0)
    depth = _bounded_float(spec.get("depth"), "depth", 3.0, 0.1, 100.0)
    amplitude = _bounded_float(spec.get("amplitude"), "amplitude", 0.65, 0.0, 100.0)
    frequency = _bounded_float(spec.get("frequency"), "frequency", 2.0, 0.1, 20.0)
    grid = _bounded_int(spec.get("grid"), "grid", 28, 4, MAX_GRID)
    pattern = str(spec.get("pattern") or "waves").strip().lower()
    if pattern not in {"waves", "ripple", "saddle", "radial"}:
        raise ValueError("pattern must be waves, ripple, saddle, or radial")

    vertices: list[tuple[float, float, float]] = []
    top: list[list[int]] = []
    values: list[float] = []
    for iz in range(grid + 1):
        row: list[int] = []
        nz = iz / grid * 2.0 - 1.0
        for ix in range(grid + 1):
            nx = ix / grid * 2.0 - 1.0
            y = _height_value(pattern, nx, nz, amplitude, frequency)
            row.append(len(vertices))
            values.append(y)
            vertices.append((nx * width * 0.5, y, nz * depth * 0.5))
        top.append(row)

    minimum_y = min(values)
    skirt = max(0.15, amplitude * 0.35, min(width, depth) * 0.04)
    bottom_y = minimum_y - skirt
    bottom: list[list[int]] = []
    for iz in range(grid + 1):
        row: list[int] = []
        nz = iz / grid * 2.0 - 1.0
        for ix in range(grid + 1):
            nx = ix / grid * 2.0 - 1.0
            row.append(len(vertices))
            vertices.append((nx * width * 0.5, bottom_y, nz * depth * 0.5))
        bottom.append(row)

    faces: list[tuple[int, int, int]] = []
    for iz in range(grid):
        for ix in range(grid):
            a, b = top[iz][ix], top[iz][ix + 1]
            c, d = top[iz + 1][ix + 1], top[iz + 1][ix]
            _add_face(faces, a, d, c)
            _add_face(faces, a, c, b)
            ba, bb = bottom[iz][ix], bottom[iz][ix + 1]
            bc, bd = bottom[iz + 1][ix + 1], bottom[iz + 1][ix]
            _add_face(faces, ba, bc, bd)
            _add_face(faces, ba, bb, bc)

    # Four closed side strips.
    for ix in range(grid):
        n = ix + 1
        _add_face(faces, top[0][ix], top[0][n], bottom[0][n])
        _add_face(faces, top[0][ix], bottom[0][n], bottom[0][ix])
        _add_face(faces, top[grid][ix], bottom[grid][n], top[grid][n])
        _add_face(faces, top[grid][ix], bottom[grid][ix], bottom[grid][n])
    for iz in range(grid):
        n = iz + 1
        _add_face(faces, top[iz][0], bottom[n][0], top[n][0])
        _add_face(faces, top[iz][0], bottom[iz][0], bottom[n][0])
        _add_face(faces, top[iz][grid], top[n][grid], bottom[n][grid])
        _add_face(faces, top[iz][grid], bottom[n][grid], bottom[iz][grid])

    canonical = {
        "type": "heightfield",
        "width": width,
        "depth": depth,
        "amplitude": amplitude,
        "frequency": frequency,
        "grid": grid,
        "pattern": pattern,
    }
    return canonical, _obj_bytes(vertices, faces, label="generated_heightfield")


_GENERATORS = {
    "sphere": _sphere,
    "box": _box,
    "cylinder": _cylinder,
    "lathe": _lathe,
    "heightfield": _heightfield,
}


def generate_obj(spec: dict[str, Any] | None) -> tuple[str, dict[str, Any], bytes]:
    if not isinstance(spec, dict):
        raise ValueError("geometry generator request must be an object")
    kind = str(spec.get("type") or "").strip().lower()
    generator = _GENERATORS.get(kind)
    if generator is None:
        raise ValueError("type must be sphere, box, cylinder, lathe, or heightfield")
    canonical, raw = generator(spec)
    filename = f"generated-{kind}.obj"
    return filename, canonical, raw

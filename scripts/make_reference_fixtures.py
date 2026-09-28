from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts" / "reference-fixtures"
MODELS = OUT / "models"


def write_obj(path: Path, vertices, faces) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for vertex in vertices:
            handle.write(
                f"v {vertex[0]:.5f} {vertex[1]:.5f} {vertex[2]:.5f}\n"
            )
        for tri in faces:
            handle.write(
                f"f {tri[0] + 1} {tri[1] + 1} {tri[2] + 1}\n"
            )


def grid_faces(nu: int, nv: int, *, offset: int = 0, wrap_u: bool = True, wrap_v: bool = True):
    faces = []
    for i in range(nu if wrap_u else nu - 1):
        for j in range(nv if wrap_v else nv - 1):
            a = offset + i * nv + j
            b = offset + ((i + 1) % nu) * nv + j
            c = offset + ((i + 1) % nu) * nv + (j + 1) % nv
            d = offset + i * nv + (j + 1) % nv
            faces.extend([[a, b, c], [a, c, d]])
    return faces


def tube(curve, *, nu: int = 400, nv: int = 28, radius: float = 0.35):
    t = np.linspace(0.0, 2.0 * np.pi, nu, endpoint=False)
    points = curve(t)
    tangent = np.gradient(points, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1)[:, None]
    normal = np.cross(tangent, [0.0, 1.0, 0.3])
    normal /= np.linalg.norm(normal, axis=1)[:, None]
    binormal = np.cross(tangent, normal)

    vertices = []
    for i in range(nu):
        for angle in np.linspace(0.0, 2.0 * np.pi, nv, endpoint=False):
            vertices.append(
                points[i]
                + radius
                * (
                    math.cos(angle) * normal[i]
                    + math.sin(angle) * binormal[i]
                )
            )
    return np.asarray(vertices), grid_faces(nu, nv)


def add_box(vertices, faces, bounds) -> None:
    x0, y0, z0, x1, y1, z1 = bounds
    offset = len(vertices)
    vertices.extend(
        [[x, y, z] for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    )
    quads = [
        (0, 1, 3, 2),
        (4, 6, 7, 5),
        (0, 4, 5, 1),
        (2, 3, 7, 6),
        (0, 2, 6, 4),
        (1, 5, 7, 3),
    ]
    for a, b, c, d in quads:
        faces.extend(
            [
                [offset + a, offset + b, offset + c],
                [offset + a, offset + c, offset + d],
            ]
        )


def make_meshes() -> None:
    trefoil_v, trefoil_f = tube(
        lambda t: np.stack(
            [
                np.sin(t) + 2.0 * np.sin(2.0 * t),
                np.cos(t) - 2.0 * np.cos(2.0 * t),
                -np.sin(3.0 * t),
            ],
            axis=1,
        )
    )
    write_obj(MODELS / "trefoil.obj", trefoil_v, trefoil_f)

    nu, nv, major, minor = 120, 48, 2.0, 0.8
    torus_v = [
        [
            (major + minor * math.cos(b)) * math.cos(a),
            minor * math.sin(b),
            (major + minor * math.cos(b)) * math.sin(a),
        ]
        for a in np.linspace(0.0, 2.0 * np.pi, nu, endpoint=False)
        for b in np.linspace(0.0, 2.0 * np.pi, nv, endpoint=False)
    ]
    write_obj(MODELS / "torus.obj", torus_v, grid_faces(nu, nv))

    still_v = []
    still_f = []
    for bounds in [
        (-3, 0, -3, 3, 0.6, 3),
        (-2.2, 0.6, -2.2, 2.2, 1.2, 2.2),
        (-1.4, 1.2, -1.4, 1.4, 1.8, 1.4),
    ]:
        add_box(still_v, still_f, bounds)

    offset = len(still_v)
    sphere_u, sphere_v = 96, 48
    for i in range(sphere_v + 1):
        theta = math.pi * i / sphere_v
        for j in range(sphere_u):
            phi = 2.0 * math.pi * j / sphere_u
            still_v.append(
                [
                    1.3 * math.sin(theta) * math.cos(phi),
                    3.1 + 1.3 * math.cos(theta),
                    1.3 * math.sin(theta) * math.sin(phi),
                ]
            )
    for i in range(sphere_v):
        for j in range(sphere_u):
            a = offset + i * sphere_u + j
            b = offset + (i + 1) * sphere_u + j
            c = offset + (i + 1) * sphere_u + (j + 1) % sphere_u
            d = offset + i * sphere_u + (j + 1) % sphere_u
            still_f.extend([[a, b, c], [a, c, d]])
    write_obj(MODELS / "still_life.obj", still_v, still_f)

    n = 140
    xs = np.linspace(-3.0, 3.0, n)
    ripple_v = [
        [
            x,
            0.35
            * math.cos(2.2 * math.hypot(x, z))
            * math.exp(-0.15 * (x * x + z * z))
            + 0.25 * math.sin(1.3 * x),
            z,
        ]
        for x in xs
        for z in xs
    ]
    write_obj(
        MODELS / "ripple.obj",
        ripple_v,
        grid_faces(n, n, wrap_u=False, wrap_v=False),
    )


def make_spheres_image() -> None:
    width, height = 720, 480
    yy, xx = np.mgrid[0:height, 0:width]
    image = np.ones((height, width, 3), dtype=np.float64)
    light = np.asarray([-0.45, -0.55, 0.7], dtype=np.float64)
    light /= np.linalg.norm(light)

    spheres = [
        (170, 240, 115, np.asarray([0.85, 0.34, 0.22])),
        (365, 205, 95, np.asarray([0.20, 0.55, 0.85])),
        (535, 270, 125, np.asarray([0.35, 0.72, 0.40])),
    ]
    for cx, cy, radius, color in spheres:
        nx = (xx - cx) / radius
        ny = (yy - cy) / radius
        radial2 = nx * nx + ny * ny
        mask = radial2 <= 1.0
        nz = np.sqrt(np.clip(1.0 - radial2, 0.0, 1.0))
        normal = np.stack([nx, ny, nz], axis=-1)
        lambert = np.clip(np.sum(normal * light, axis=-1), 0.0, 1.0)
        tone = 0.18 + 0.82 * lambert
        image[mask] = color * tone[mask, None]

    pixels = np.round(np.clip(image, 0.0, 1.0) * 255.0).astype(np.uint8)
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels, mode="RGB").save(OUT / "spheres.png")


def main() -> None:
    make_meshes()
    make_spheres_image()
    print(f"reference fixtures written to {OUT}")


if __name__ == "__main__":
    main()

# 3D Line Art / LiDAR Ink Studio

This repository is being developed in small roadmap phases.

The original single-file Line Art Studio reference build is kept at:

```text
line_art_5_3_streamlines.html
```

The active frontend is under:

```text
frontend/
```

## Run locally

Install the Phase 3 runtime dependencies:

```bash
python -m pip install -r requirements.txt
```

Start the studio:

```bash
python run_studio.py
```

Open:

```text
http://127.0.0.1:8777/
```

Use a different local port if needed:

```bash
python run_studio.py --port 8780
```

Do not open a browser automatically:

```bash
python run_studio.py --no-browser
```

The server is intentionally loopback-only.

## Phase 3 workflow

The studio now supports two source paths:

```text
2D image
  -> image analysis
  -> line renderer

STL / OBJ
  -> LiDAR engine
  -> shaded + depth + geometry-edge maps
  -> line renderer
```

For a 3D model:

1. Choose an `.stl` or `.obj` file in **3D Model**.
2. The server loads and normalizes the mesh.
3. Click **Scan LiDAR**.
4. The Phase 3 scan uses a fixed 320 x 240 single-view setup.
5. The browser uses:
   - shaded output for tone/color,
   - `edge_score_geom` for edge strength,
   - normalized depth gradients for stroke flow.
6. The existing preview, high-quality render, PNG export, and SVG export paths are reused.

Phase 3 intentionally keeps scan controls fixed. Camera controls, scan resolution controls,
smart sampling, and confidence controls belong to later roadmap phases.

### Mesh guardrails

- accepted formats: `.stl`, `.obj`
- request upload cap: 25 MB
- Phase 3 mesh cap: 250,000 triangles
- uploaded meshes are normalized to a roughly 6-unit working size
- only one scene and one current scan are kept in memory

## Current API

```text
GET  /api/health
GET  /api/state
POST /api/reset

POST /api/scene/upload?filename=model.obj
POST /api/lidar/scan
GET  /api/lidar/maps

GET  /api/lidar/maps/shaded.png
GET  /api/lidar/maps/depth.png
GET  /api/lidar/maps/edge.png
```

`/api/scene/upload` accepts the model bytes directly as the request body. It does not use
multipart form parsing.

A scan request is JSON. The bridge accepts:

```json
{
  "width": 320,
  "height": 240,
  "rays_per_pixel": 2,
  "seed": 42
}
```

The API clamps Phase 3 scan settings to conservative limits.

## Server safety

The local server includes:

- loopback-only binding,
- Host-header checks,
- a non-blocking operation gate around writes/scans,
- upload/body-size limits,
- static path-traversal protection,
- private JSONL error logging with short public error IDs.

Unexpected server errors are logged locally to:

```text
.lidar-ink/errors.jsonl
```

## LiDAR engine source

The sensor core is vendored at:

```text
vendor/lidar_engine.py
```

It is derived from `steveonw/lidar-engine` and kept behind
`server/lidar_bridge.py`. The upstream license notice and source reference are retained
in `vendor/NOTICE.md`.

## Tests

Run:

```bash
python -m unittest discover -s tests -v
```

The suite includes HTTP/API tests and a real cube-OBJ -> LiDAR-map integration test.

See `ROADMAP.md` for the staged build plan.

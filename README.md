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

Install the runtime dependencies:

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

## Current source paths

```text
2D image
  -> image analysis
  -> line renderer

STL / OBJ
  -> LiDAR engine
  -> shaded + depth + geometry edge
  -> depth variance + sensor confidence
  -> browser-side art mapping
  -> line renderer
```

The existing preview, high-quality render, PNG export, and SVG export paths are shared by both sources.

## Phase 4 LiDAR controls

For a 3D model:

1. Choose an `.stl` or `.obj` file under **3D Model**.
2. Set the single-view scan controls.
3. Click **Scan LiDAR**.
4. Adjust the art-mapping controls without rescanning.
5. Pick a LiDAR preset or tune the normal line-art settings.
6. Render and export PNG/SVG as usual.

### Scan controls

Changing these settings requires a new scan:

- Resolution: 160x120, 320x240, 480x360, or 640x480
- Rays per pixel: 1, 2, or 4
- Smart sampling: optional scout-then-fill sampling from the LiDAR engine
- Camera orbit/yaw
- Camera elevation
- Camera distance
- Field of view

Smart sampling uses the same total ray budget. Its purpose is better quality per ray when the model occupies only part of the frame, not shorter runtime.

### Art-mapping controls

These operate on the current LiDAR maps in the browser and do **not** rerun the sensor:

```text
Density Source
  Tone
  Geometry Edge
  Depth Change
  Confidence

Direction Source
  Image Structure
  Depth Tangent
  Mixed
```

Additional controls:

- **Geometry edge** scales how strongly `edge_score_geom` attracts strokes.
- **Depth influence** controls depth-change density and the contribution of depth tangents to mixed flow.

The Phase 4 confidence map is a single-view sensor-confidence proxy derived from hit support, beam coherence, and depth stability. It is useful for artistic weighting, but it is not the later multi-view confidence-fusion system.

### LiDAR presets

- **Technical Pencil** — tone-led drawing with strong geometry-edge attraction
- **Depth Contours** — depth-change density with depth-tangent flow
- **Sensor Sketch** — confidence-led density with mixed flow
- **Architectural Scan** — geometry-edge density with restrained/quantized direction
- **Uncertain Scribble** — looser, lower-opacity, high-noise mixed flow

## Phase 5 stable seeded randomness

The renderer no longer uses a single sequential PRNG stream for stroke placement and local direction noise.

Instead:

- `frontend/random_field.js` provides stateless `randomAt(x, y, seed, channel)` and `randomForIndex(index, seed, channel)` helpers.
- each stroke index owns its candidate-position and length-jitter samples,
- local direction noise is derived from the stroke's coordinates plus seed,
- changing path complexity does not consume random numbers that shift later stroke candidates,
- changing only the requested high-quality line count preserves the already-existing stroke prefix,
- preview opacity/weight amplification no longer changes coverage decisions, so preview geometry stays stable.

This is an independent implementation of the coordinate-stable randomness idea referenced in the roadmap; it does not copy code from `other-tools`.

The existing **Seed** field controls this deterministic variation. **New Variation** still generates a new seed intentionally.

## Mesh guardrails

- accepted formats: `.stl`, `.obj`
- request upload cap: 25 MB
- mesh cap: 250,000 triangles
- uploaded meshes are normalized to a roughly 6-unit working size
- one scene and one current scan are kept in memory

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
GET  /api/lidar/maps/variance.png
GET  /api/lidar/maps/confidence.png
```

`/api/scene/upload` accepts the model bytes directly as the request body. It does not use multipart form parsing.

A Phase 4 scan request is JSON. Example:

```json
{
  "width": 320,
  "height": 240,
  "rays_per_pixel": 2,
  "smart_sampling": true,
  "yaw_deg": 45,
  "elevation_deg": 20,
  "distance_scale": 3.0,
  "fov_deg": 55,
  "seed": 42
}
```

The server clamps scan/camera values to conservative ranges.

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

Run the Python suite:

```bash
python -m unittest discover -s tests -v
```

Run the frontend LiDAR-map smoke test:

```bash
node tests/frontend_maps_smoke.js
```

Run the deterministic-randomness regression test:

```bash
node tests/frontend_randomness_smoke.js
```

GitHub Actions also runs JavaScript syntax checks, deterministic prefix/repeatability checks, and the real cube-OBJ -> LiDAR integration test.

See `ROADMAP.md` for the staged build plan.

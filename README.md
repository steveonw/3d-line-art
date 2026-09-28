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

## Phase 6 procedural flow

Phase 6 adds a deterministic multi-octave gradient-noise/fBm direction field on top of the current image or LiDAR direction map.

Controls:

- **Flow Scale** — spatial size of the procedural features. Larger values create broader, slower bends.
- **Turbulence** — strength of the procedural angular offset. At 0%, the Phase 5 direction field is preserved exactly.
- **Octaves** — number of fBm detail layers, from 1 to 7.
- **Seed** — the existing seed controls both stable stroke variation and the procedural field.

The procedural field is evaluated locally from coordinates and seed, so it remains repeatable and does not consume sequential random state.

Conceptually:

```text
image/LiDAR direction
        +
seeded fBm flow offset
        +
small stable local jitter
        ↓
final streamline direction
```

This is an independent implementation of seeded gradient noise and fBm. It does not copy source code from the experimental world-generator repository.

## Phase 7 mathematical flow mixer

Phase 7 puts the direction systems behind one common field API in:

```text
frontend/math_fields.js
```

The renderer now composes direction from a weighted set of fields instead of hard-wiring procedural noise directly into the stroke solver.

### Core mixer

```text
Surface Flow
Depth Contour
Procedural Noise
Radial
Vortex
Spiral
Wave
Rose
Cardioid
Log Spiral
```

**Surface Flow** is the current image/LiDAR base direction selected by the existing direction controls.

**Depth Contour** uses the raw LiDAR depth-tangent field and its local depth coherence. It has no effect for ordinary 2D image sources.

**Procedural Noise** is treated as an angular offset field. Its Flow Scale, Turbulence, Octaves, and Seed still come from the Phase 6 controls.

The mathematical fields are absolute orientation fields centered on the artwork:

- **Radial** points through the center.
- **Vortex** follows circles around the center.
- **Spiral** blends radial and tangential orientation.
- **Wave** creates a deterministic seeded sinusoidal direction field.
- **Rose** uses the tangent of a five-petal polar rose field.
- **Cardioid** uses a cardioid tangent field.
- **Log Spiral** uses the tangent direction of a logarithmic spiral.

The absolute direction fields are mixed using axial vectors, so a line orientation and the same line flipped by 180 degrees are treated as equivalent. This avoids false cancellation from ordinary arrow-vector averaging.

Conceptually:

```text
image/LiDAR surface field ───────┐
LiDAR depth contour ─────────────┤
radial/vortex/spiral/wave ───────┤
rose/cardioid/log spiral ────────┤
                                 ├─ axial field mix
                                 │
procedural fBm offset ───────────┘
                                 │
stable local jitter
                                 ▼
                         streamline solver
```

Default mixer settings preserve Phase 6 behavior: Surface Flow is 100%, Procedural Noise is 100%, all mathematical fields are 0%, and Depth Contour is 0%.

## Phase 8 deliberate stroke placement

Phase 8 improves where strokes start without changing the Phase 7 flow solver.

The renderer now generates six deterministic position candidates per stroke and scores each candidate using:

- remaining coverage need,
- darkness,
- geometry/image edge strength,
- LiDAR depth change,
- LiDAR sensor confidence,
- deterministic tie-breaking,
- minimum-spacing preference.

The coverage grid remains authoritative. Minimum spacing is a preference rather than a hard rejection, so dense 100k–400k renders can continue filling areas that genuinely still need ink.

The spacing radius is derived only from source dimensions, not requested line count. This preserves the Phase 5 guarantee that increasing line count keeps the existing stroke prefix stable.

Conceptually:

```text
deterministic candidate positions
              │
              ▼
    ┌─────────────────────┐
    │ placement evidence  │
    │                     │
    │ remaining coverage  │
    │ darkness            │
    │ geometry edge       │
    │ depth change        │
    │ confidence          │
    │ seed spacing        │
    └─────────┬───────────┘
              ▼
       best candidate
              │
              ▼
       Phase 7 flow mixer
              │
              ▼
          streamline
```

Completed renders store placement diagnostics in render metadata, including candidate attempts, useful-selection rate, average remaining need, spacing selections, and high-density spacing fallbacks.

The deterministic Phase 7-vs-Phase 8 benchmark in `tests/frontend_stroke_placement_smoke.js` uses the same seed and synthetic evidence field for both samplers. The current fixture improves useful selections from about 90.7% to 96.8% and raises average remaining need selected from about 0.327 to 0.366.

## Phase 9 undo, redo, and local autosave

Phase 9 adds an edit-safety layer for normal experimentation.

### History

The sidebar now includes **Undo** and **Redo** controls.

Keyboard shortcuts:

```text
Ctrl+Z         Undo
Ctrl+Y         Redo
Ctrl+Shift+Z   Redo
```

On macOS, Command can be used in place of Ctrl.

The history stack keeps up to 80 project-setting snapshots. Continuous slider edits with the same control are coalesced for 550 ms, so dragging a slider creates one useful undo step instead of dozens of tiny steps.

Undoable settings include:

- style presets,
- color/black mode,
- palette,
- line count,
- normal stroke/detail/opacity/flow sliders,
- seed/new variation,
- procedural flow controls,
- all mathematical flow-mixer weights,
- LiDAR art-mapping controls,
- LiDAR camera, resolution, ray-count, and smart-sampling controls.

Undoing a LiDAR camera/scan setting marks the current scan stale when appropriate; it does not silently rerun the sensor.

### Versioned project state

Browser history/autosave uses a versioned project-state schema in:

```text
frontend/project_state.js
```

Current schema version:

```text
1
```

Unknown fields are ignored, invalid primitive types fall back to current defaults, and unsupported future project-state versions are rejected rather than guessed at.

### Autosave

Settings autosave to browser-local storage after a 250 ms debounce.

The autosave key is versioned, and the UI reports:

```text
Autosave ready
Saving...
Autosaved
Autosave unavailable
```

Pending state is flushed during page unload.

After a reload or browser crash:

- project settings are restored automatically,
- undo history starts from the restored settings,
- if the Python server is still running and still holds the previous LiDAR scan in memory, that scan is reconstructed in the browser automatically,
- if the source was a local image, the settings are restored but the image must be selected again.

Local image bytes are intentionally **not** stored in localStorage. This avoids browser-storage quota problems and avoids silently copying arbitrary user files into persistent browser storage. Full portable project files belong to Phase 10.

Source hints are updated in the current autosave snapshot without becoming undo operations, so loading an image or LiDAR source does not create a misleading "undo source file" action.

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

Run the procedural-flow regression test:

```bash
node tests/frontend_procedural_flow_smoke.js
```

Run the mathematical-flow mixer regression test:

```bash
node tests/frontend_math_fields_smoke.js
```

GitHub Actions also runs JavaScript syntax checks, deterministic prefix/repeatability checks, procedural-flow and mathematical-field checks, plus the real cube-OBJ -> LiDAR integration test.

See `ROADMAP.md` for the staged build plan.

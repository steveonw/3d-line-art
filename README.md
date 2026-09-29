# 3D Line Art / LiDAR Ink Studio

This repository is being developed in small roadmap phases.

For AI/maintainer continuation notes, current stacked-PR state, invariants, and the exact next task, read:

```text
AI_HANDOFF.md
```

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
2
```

Phase 10 keeps backward migration for the Phase 9 version-1 autosave shape.

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

## Phase 10 portable project files

Phase 10 adds explicit **Open Project** and **Save Project** controls.

Projects are saved as readable JSON files:

```text
<source-name>.lidar-ink.json
```

For example, the repository includes:

```text
samples/cube.lidar-ink.json
samples/cube.obj
```

Open the project JSON, load `samples/cube.obj`, then run LiDAR if the local server does not already hold a matching current scan.

### Project format

The current portable project schema is:

```json
{
  "format": "lidar-ink-project",
  "version": 2,
  "settings": {
    "palette": "monochrome",
    "seed": 2841,
    "procedural": {},
    "flowMixer": {},
    "lidar": {}
  },
  "source": {
    "kind": "lidar",
    "name": "cube.obj",
    "size": 254,
    "lastModified": null,
    "type": "text/plain"
  },
  "export": {
    "pngScale": "2"
  }
}
```

The full `settings` object stores:

- camera orbit, elevation, distance, and field of view,
- LiDAR resolution, rays per pixel, and smart sampling,
- LiDAR density/direction mapping,
- geometry-edge and depth influence,
- line-art style settings,
- palette,
- seed,
- procedural-flow settings,
- the complete mathematical flow mixer.

The `export` section currently stores PNG export scale. SVG uses the deterministic completed stroke store and does not yet need a separate project option.

### Source references

Project files reference the intended source rather than embedding the source bytes.

For local files the reference includes:

```text
kind
filename
file size
last-modified timestamp when available
media type when available
SHA-256 when available
```

When both sides have a SHA-256, content identity is authoritative. The modification timestamp is retained as metadata but is not a hard match requirement.

When reopening a project, LiDAR Ink checks the reference before enabling rendering. A different image/model cannot silently become the source for the saved settings.

For server-restored LiDAR models, filename matching is accepted when browser file metadata is no longer available.

### Reopening and reproduction

For a 2D project:

```text
Open Project
    ↓
settings + export state restore
    ↓
reselect the referenced image
    ↓
deterministic preview/render
```

For a LiDAR project:

```text
Open Project
    ↓
settings + camera + sensor state restore
    ↓
matching model already on local server?
        ├─ yes → restore its current scan when available
        └─ no  → load the referenced STL/OBJ
    ↓
Rescan LiDAR if the restored scan uses different scan settings
    ↓
deterministic line-art render
```

A mismatched source blocks rendering/export until the correct referenced source is loaded.

### What is not embedded yet

Phase 10 deliberately does **not** put large scan products into the JSON file.

These remain Phase 11 work:

```text
scans/shaded.png
scans/depth.bin
scans/edge.png
scans/confidence.bin
```

So the Phase 10 project file is portable creative state plus a source reference, not a self-contained archive of the source model and LiDAR cache.

Project JSON is capped at 1 MB when opened. Unknown future schema versions and foreign project formats are rejected instead of guessed at.

## Phase 10 stabilization

A post-Phase-10 browser review found state-machine bugs that the earlier DOM/string smoke tests could not exercise. The stabilization branch fixes them before Phase 11:

- autosave recovery restores source **hints**, not hard project locks,
- explicit project files still enforce source identity,
- installed LiDAR scan freshness is compared against the actual scan metadata,
- returning camera controls to the scanned values clears stale state,
- stale LiDAR scans block render/export until rescanned,
- scan-channel URLs are bound to their `scan_id` and stale IDs return HTTP 409,
- OBJ/STL geometry rejects NaN/Inf and near-zero extent,
- model uploads carry SHA-256 fingerprints,
- local image references use browser SHA-256 when Web Crypto is available,
- `lastModified` is a portability hint rather than a hard identity constraint,
- failed model uploads keep the previous scene usable,
- asynchronous server restore cannot overwrite a newer user source selection.

Real headless-browser regressions now run in CI. For the full development suite:

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python -m unittest discover -s tests -v
```

Runtime-only installs can continue using `requirements.txt`; the browser regression module skips itself when Playwright is unavailable.

## Reference-render regression review

A full Playwright-driven Phase 10 reference-render bundle was used to exercise LiDAR presets, camera orbits, sensor maps, mathematical flow fields, the 2D image path, and repeated PNG export.

The review found one additional LiDAR correctness bug: imported mesh winding could flatten the shaded channel because face normals were used without orienting them toward the camera. The bridge now treats visible mesh hits as two-sided by flipping only hit normals whose `n·rayDirection > 0` before channel computation and shaded rendering.

The inward-wound repository cube now has real tonal variation instead of collapsing to the lighting floor.

Regression coverage now includes:

- a real cube scan that fails if shaded object pixels collapse to a flat tone,
- a real Chromium test that renders identical source/settings/seed twice and requires byte-identical PNG SHA-256 output,
- the existing geometry/seed prefix determinism tests,
- source/scan state-machine regressions.

The large review PNGs are not checked into the repository as hard CI goldens because browser PNG bytes can be brittle across Chromium/platform upgrades. Their hashes and provenance are recorded in:

```text
tests/reference/phase10_reference_manifest.json
```

Reference meshes and the synthetic shaded 2D source can be regenerated with:

```bash
python scripts/make_reference_fixtures.py
```

See `tests/reference/README.md` for the reference-render testing policy.

## Phase 11 LiDAR scan caching

Expensive single-view LiDAR results are now cached in memory and reused when the model and sensor inputs are identical.

The cache key contains only sensor-result inputs:

```text
model SHA-256
+ width / height
+ rays per pixel
+ smart sampling
+ yaw / elevation
+ camera distance
+ field of view
+ sensor seed
```

Art-only settings are deliberately excluded. Changing presets, palette, line count, stroke settings, procedural flow, mathematical flow weights, LiDAR density source, direction source, geometry-edge art strength, or depth influence does not require another raycast.

The server cache is a bounded LRU:

```text
default byte cap:   256 MB
default entry cap:  16 scans
```

Each entry stores scan metadata plus the existing five PNG channels:

```text
shaded
depth
edge
variance
confidence
```

A cache hit restores the complete scan as the current scan without loading or running the LiDAR engine again. Cache entries are safely namespaced by the model's uploaded SHA-256, so switching models can retain older entries without filename collisions. Explicit server reset clears the cache.

The UI distinguishes sensor state directly:

```text
Scan running…
Scan ready · 320×240
Scan cached · 320×240
Scan stale · 320×240
```

Returning camera/sensor controls to a previously cached configuration and scanning again can produce an immediate cache hit.

The cache design borrows the useful content-addressed / byte-accounted / bounded-eviction pattern from the owner's `Read-Aloud-Main` repository. A separate in-flight request table is unnecessary here because the local server already serializes expensive write/scan operations.

## Phase 11.5 LiDAR art mapping polish

Phase 11.5 improves how the existing single-view LiDAR evidence becomes line art. It does **not** add another sensor pass and does not change the Phase 11 scan-cache key.

New browser-side controls:

- **Contour coverage** — blends the original local depth-gradient density with deterministic iso-depth bands so smooth surfaces still produce readable contour structure.
- **Confidence smoothing** — masked smoothing of the confidence map to reduce cell-scale speckle without bleeding confidence into no-hit background.
- **Clean known-empty background** — uses the depth no-hit mask as a hard stroke mask. Candidate points are restricted to occupied pixels and straight/curved stroke paths stop at the occupancy boundary.
- **Center math fields on scanned object** — derives the projected object's centroid and scale from occupied depth pixels and uses that origin for Radial, Vortex, Spiral, Rose, Cardioid, and Log Spiral fields.
- **Math emphasis** — scales mathematical-field weights relative to the base surface field so subtle polar fields can read more clearly.

Backward compatibility is intentional: the new project settings default to the pre-11.5 behavior when absent. The LiDAR-specific presets opt into the new polish settings so new preset-driven work benefits immediately.

These settings are art-only:

```text
Contour coverage
Confidence smoothing
Clean background
Object-centered fields
Math emphasis
```

Changing them never requires a LiDAR rescan and does not invalidate a cached sensor result.

CI includes a synthetic hard-mask renderer test that fails if any recorded stroke point escapes the occupied region, plus map tests that verify contour coverage increases useful density on a shallow depth ramp and confidence smoothing reduces a speckled confidence field.

## Phase 12 fixed multi-view scanning

Phase 12 adds a predictable five-view LiDAR pass while keeping every view independently available:

```text
Front  — yaw   0°, elevation 20°
Back   — yaw 180°, elevation 20°
Left   — yaw 270°, elevation 20°
Right  — yaw  90°, elevation 20°
Top    — yaw   0°, elevation 80°
```

Top uses 80° rather than 90° because the existing sensor elevation guard is 5–80°.

**Scan 5 Views** sends one local API request. On the Python side each named camera still calls the normal single-view scan path, so every result uses the Phase 11 content-addressed cache. Repeating the same five-view scan can therefore reuse all five results without rerunning the LiDAR engine.

Cached scans are addressable by `scan_id` while they remain in the bounded LRU. This keeps Front / Back / Left / Right / Top independently inspectable even after another view becomes the server's current scan.

The browser keeps all five analysis-map sets in memory and provides two presentation modes:

- **Current View** — inspect and render one named view at a time.
- **Combined Views** — deterministically combine evidence from all five views into one 2D line-art field.

Combined mode preserves strong ink, edge, depth, and confidence evidence; axial-blends direction fields; unions clean-background occupancy; and continues through the same Phase 11.5 contour/confidence/object-centered art mapping.

This combined representation is intentionally a **2D evidence compositor**, not geometric registration or the later multi-view confidence-fusion system.

**Per-view debug coloring** makes contribution provenance visible:

- Current View colors strokes with that view's fixed debug color.
- Combined Views colors each stroke from the dominant contributing view at its location.
- Debug colors override normal black/color ink only while the option is enabled.

Sensor freshness remains explicit. Fixed named views override interactive yaw/elevation, so changing those two single-view controls does not stale a completed five-view set. Resolution, rays per pixel, smart sampling, camera distance, field of view, sensor seed, or model identity do affect the fixed scans and will mark the set stale.

Changing Current View, Combined Views, debug coloring, or any Phase 11.5 art-mapping control is browser-local and never triggers a raycast.

## Phase 13 automatic view selection

Phase 13 adds **Auto Scan** on top of the same cached single-view sensor path.

The server starts from a deterministic candidate-camera set, acquires a view, measures scan quality, updates a **quality-weighted view-space coverage** score, rejects near-duplicate camera directions, and chooses the next camera with the largest expected angular-coverage gain. It stops when the configured target is reached, expected gain becomes too small, the maximum view count is reached, or no valid candidate remains.

Important scope boundary: this is camera/view-space planning, not registered object-surface coverage. The planner does not yet reconstruct which 3D surfaces remain unseen; that belongs with later multi-view fusion work.

Every automatic view:

- goes through the Phase 11 content-addressed scan cache,
- keeps its own `scan_id`,
- keeps shaded / depth / edge / variance / confidence channels,
- can be inspected individually through **Current View**,
- can participate in the existing Phase 12 2D **Combined Views** compositor,
- receives a deterministic debug color.

Automatic view names are preserved through undo/redo and project/autosave settings. The browser displays human labels such as **Low 0°** rather than internal IDs such as `auto_low_000`.

Sensor floats are canonicalized once before camera construction, cache-key generation, and metadata. Equivalent yaw values such as 0° and 360° therefore describe the same sensor request.

## Phase 14 confidence fusion

Multi-view scans now derive a confidence-fusion layer without firing any additional LiDAR rays.

Each Phase 14 scan-cache entry retains a compact internal evidence payload containing:

```text
metric depth_per_pixel
single-view confidence
```

The payload is byte-accounted inside the existing bounded Phase 11 LRU. For a fusion request, the server reconstructs approximate world-space hit positions from metric depth plus camera metadata, reprojects those points into each requested canonical scan view, applies a nearest-depth visibility guard, and accumulates confidence from independent views.

The confidence rule deliberately distinguishes a single observation from agreement:

- one source keeps its original confidence,
- additional agreeing sources can increase confidence,
- fused confidence never drops below the strongest contributing observation.

The implementation borrows the useful canonical-camera / weighted-evidence / saturating-confidence ideas from the owner's `steveonw/lidar-numpy` repository, but remains integrated with this application's cache and scan-ID model.

The server exposes a fused **confidence map** and **support map** for every participating scan. The browser can substitute the fused confidence map into the existing LiDAR art-mapping path.

Art-only Phase 14 controls are:

- **Use multi-view fused confidence**
- **Confidence → length**
- **Confidence → opacity**
- **Confidence → fragmentation**

At high confidence, strokes can remain longer, darker, and more continuous. Lower confidence can make them shorter, fainter, and more broken. All three effect strengths default to zero, preserving older project/render behavior unless enabled. Changing these controls, Current View, or Combined Views never reruns LiDAR or confidence fusion.

Important boundary: the Phase 12 **Combined Views** picture is still a 2D compositor. Confidence fusion is geometrically reprojected evidence, but the cached metric depth is a per-pixel mean reconstructed through the pixel center rather than a retained raw point cloud. Phase 15's 3D inspection tools can make that geometry/evidence relationship directly inspectable.

## Phase 15 3D inspection viewer

Phase 15 adds a local **3D Inspector** without changing the LiDAR sensor pipeline or introducing an LLM dependency.

The browser loads a vendored Three.js r128 build from `frontend/vendor/three.r128.min.js`, copied from the owner's `steveonw/text-to-3d` repository. Runtime inspection therefore remains offline and does not depend on a CDN.

The inspector can show:

- the normalized source mesh,
- every acquired fixed or automatic LiDAR camera,
- the selected camera frustum and direction gizmo,
- a confidence-colored cached hit point cloud,
- a bounded cached hit-ray preview,
- the currently selected scan/viewpoint.

Interaction supports left-drag orbit, Shift/right-drag pan, wheel zoom, layer toggles, Reset Orbit, a scan dropdown, viewpoint buttons, and clickable 3D camera markers. Selecting a multi-view viewpoint synchronizes the existing **Current View** selection. These actions are inspection-only: they do not fire LiDAR rays or rerun Phase 14 confidence fusion.

The inspection API is intentionally bounded:

```text
mesh preview       <= 20,000 triangles
hit cloud          <= 12,000 points
hit-ray preview    <= 320 rays
```

The mesh preview comes from the already-normalized server scene. Point and ray previews are reconstructed from the same Phase 14 cached metric `depth_per_pixel` evidence; they can be rebuilt with LiDAR engine loading disabled. Because that depth is a per-pixel mean reconstructed through the pixel center, the point cloud and hit rays are approximate inspection products rather than retained raw sensor rays or a new canonical 3D surface representation.

This boundary matters for Phase 16: the inspector visualizes existing scene and sensor evidence, but **3D Ink** still needs an explicit world-space stroke representation tied to actual geometry.

## Phase 16 world-space 3D Ink

Phase 16 adds an explicit **Ink Space** choice:

- **2D Ink** keeps the existing deterministic canvas renderer and PNG/SVG export path.
- **3D Ink** projects the completed 2D stroke prefix onto the real normalized triangle mesh and renders that illustration in the offline Three.js workspace.

The 2D renderer remains the art-placement authority. For 3D Ink, the browser sends a bounded deterministic prefix of its completed stroke store to the local server. The server densely resamples those image-space paths and intersects the selected LiDAR camera rays with the authoritative normalized scene geometry.

Every retained 3D point carries:

```text
XYZ
camera-facing surface normal
surface tangent
geometric camera-ray depth
cached selected-scan confidence
material RGB
piece ID
```

The server splits projected paths when they miss the mesh, cross piece boundaries, or encounter a large depth discontinuity. This prevents a single 2D stroke from becoming a chord through empty 3D space. Tangents are derived from the projected polyline and projected into each point's local tangent plane.

The Phase 15 mean-depth point cloud remains inspection-only. Phase 16 does **not** promote that approximation into surface geometry: world-space ink uses direct intersections with the actual normalized triangle scene. It also does not fire a new LiDAR burst or rerun confidence fusion; confidence metadata comes from the selected scan's existing Phase 14 cached evidence.

3D Ink guardrails are:

```text
input stroke prefix       <= 5,000 completed 2D strokes
input points / stroke     <= 8
dense projected samples   <= 80,000
projection JSON body      <= 4 MB
```

The normal sensor/control JSON cap remains 64 KB. `POST /api/ink3d/project` uses the same loopback/origin/content-type protections and non-blocking operation gate as the other mutating local APIs.

The Three.js viewer renders the world-space polyline layer separately from the mesh, point cloud, hit rays, and camera helpers. A tiny visual-only normal offset prevents z-fighting; the stored XYZ values remain exactly on the mesh hit positions. Stroke RGB remains un-premultiplied and the original per-stroke alpha is passed to Three.js per vertex, preserving faint graphite/soft-pencil tones instead of turning them near-black. Selecting a scan/viewpoint frames the orbit camera from that scan's camera position, target, and vertical FOV, after which normal orbit/pan/zoom remains available. Current View can be reprojected after art-only edits without rescanning. **Combined Views** remains a 2D compositor and is intentionally unavailable as a 3D Ink projection source because it has no single camera.

## Phase 17 deterministic geometry creation

The studio can now create simple 3D source geometry without a file upload or an LLM.

Built-in generators:

- **Sphere**
- **Box**
- **Cylinder**
- **Lathe / profile** with editable radius,Y profile points
- **Height field** with Waves, Ripple, Saddle, and Radial patterns

The important implementation rule is that generated objects do not get their own renderer or LiDAR path. Every generator serializes deterministic **OBJ bytes** and immediately sends those bytes through the same server-side OBJ parser, validation, 250,000-triangle limit, normalization, SHA-256 fingerprinting, and scene-state installation used by an uploaded `.obj` file.

After that boundary, generated and uploaded models use the same:

```text
normalized scene
  -> LiDAR scan/cache
  -> fixed or automatic multi-view
  -> confidence fusion
  -> 3D inspection
  -> world-space 3D Ink
```

Because normal scene loading scales the longest model dimension to the common working size, absolute primitive scale is intentionally not a separate world-unit system. Relative dimensions and shape remain meaningful: box proportions, cylinder radius/height ratio, lathe profile, and height-field width/depth/amplitude relationships survive normalization.

Generated source references also store the server-canonical generator specification inside project/autosave JSON. If that project is reopened after the local server has restarted—or while another scene is loaded—the browser can deterministically regenerate the expected OBJ source/hash before normal project source-matching and scan-staleness logic continues. Uploaded-file projects remain reference-only and are unchanged.

The generation API is:

```text
POST /api/scene/generate
```

It uses the ordinary 64 KB JSON limit, JSON media-type requirement, same-loopback origin validation, and non-blocking operation gate.

## Authoritative Model Transform

Post-v0.5 stabilization adds a **Model Transform** section for imported and generated 3D scenes:

- Position X / Y / Z
- Rotation X / Y / Z
- Uniform scale
- Apply Transform
- Reset Transform

The transform is not a Three.js-only display adjustment. Studio applies it to the authoritative normalized triangle scene before any later sensor or geometry work. Rotation uses X → Y → Z order around the normalized model center; translation is a world-space offset; Reset restores the normalized pose.

Applying a transform deliberately makes current LiDAR products stale. Studio clears current scan/multi-view/inspection/3D-Ink products and waits for an explicit rescan rather than firing LiDAR automatically.

Source identity and geometry identity are kept separate:

```text
source sha256
  = uploaded/generated asset identity

geometry_sha256
  = source sha256 + canonical model transform
```

That distinction lets projects continue recognizing the same STL/OBJ while preventing a scan from one model pose from being reused for another pose. Returning to the exact identity transform recreates the identity geometry fingerprint, so a still-valid cached identity scan can be reused.

Model transforms are stored in normal project/autosave settings and participate in Undo/Redo. Explicit projects reapply their saved transform when the referenced model is loaded. Generated-scene autosave recovery regenerates the deterministic source and then reapplies its saved transform after a local-server reset.

The transform API is:

```text
POST /api/scene/transform
```

It uses the ordinary JSON media-type/origin protections, 64 KB JSON limit, and non-blocking operation gate.

## Floating Control Dock

Post-v0.5 stabilization replaces the long page-height sidebar with a movable **Control Dock** so the artwork or 3D inspection view stays fixed while controls move independently.

Desktop Control Dock modes:

- **Float** — draggable by the title bar and resizable from the window edge
- **Left** — docked as an overlay on the left side
- **Right** — docked as an overlay on the right side
- **Minimize** — collapse to the title bar
- **Close / Controls** — hide the dock and reopen it from the floating Controls button

Controls are grouped into five tabs:

```text
Source | Model | LiDAR | Art | Export
```

The window behavior is adapted from the owner's EquationWright scratch-pad implementation rather than introducing a third-party windowing dependency. On smaller screens the desktop drag/dock controls disappear and the Control Dock behaves as a viewport-constrained bottom drawer.

The main canvas and Three.js inspection workspace now own the viewport separately from the controls. Scrolling, dragging, docking, minimizing, or closing the Control Dock does not scroll or recenter the image/model underneath.

Dock layout is intentionally a local workspace preference. The active tab, dock mode, floating position/size, minimized state, and closed state are persisted in browser `localStorage`; they are not written into portable Line Art project JSON.

## Mesh guardrails

- accepted formats: `.stl`, `.obj`
- request upload cap: 25 MB
- mesh cap: 250,000 triangles
- uploaded meshes are normalized to a roughly 6-unit working size
- one scene and one current-scan pointer are kept, plus the bounded Phase 11 LRU of cached scans

## Current API

```text
GET  /api/health
GET  /api/state
POST /api/reset

POST /api/scene/upload?filename=model.obj
POST /api/scene/generate
POST /api/scene/transform
POST /api/lidar/scan
POST /api/lidar/multiview
POST /api/lidar/auto
POST /api/lidar/fusion
GET  /api/lidar/maps[?scan_id=<id>]

POST /api/ink3d/project

GET  /api/inspection/scene
GET  /api/inspection/scan[?scan_id=<id>]

GET  /api/lidar/fusion/confidence.png?fusion_id=<id>&scan_id=<id>
GET  /api/lidar/fusion/support.png?fusion_id=<id>&scan_id=<id>

GET  /api/lidar/maps/shaded.png[?scan_id=<id>]
GET  /api/lidar/maps/depth.png[?scan_id=<id>]
GET  /api/lidar/maps/edge.png[?scan_id=<id>]
GET  /api/lidar/maps/variance.png[?scan_id=<id>]
GET  /api/lidar/maps/confidence.png[?scan_id=<id>]
```

`/api/scene/upload` accepts the model bytes directly as the request body. It does not use multipart form parsing.

Mutating loopback API calls validate browser `Origin` when present. JSON POST routes require `application/json`; model upload requires `application/octet-stream`. This keeps ordinary cross-origin web pages from silently resetting the studio or launching expensive local scans.

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

Run the Phase 15 inspection-viewer smoke test:

```bash
node tests/frontend_inspection_viewer_smoke.js
```

Run the Phase 16 3D Ink smoke test:

```bash
node tests/frontend_ink3d_smoke.js
```

Run the Phase 17 geometry-builder smoke test:

```bash
node tests/frontend_geometry_builder_smoke.js
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

Run the stroke-placement regression test:

```bash
node tests/frontend_stroke_placement_smoke.js
```

Run the history/autosave regression test:

```bash
node tests/frontend_history_smoke.js
```

Run the portable-project regression test:

```bash
node tests/frontend_project_file_smoke.js
```

GitHub Actions also runs JavaScript syntax checks, deterministic prefix/repeatability checks, procedural-flow and mathematical-field checks, plus the real cube-OBJ -> LiDAR integration test.

See `ROADMAP.md` for the staged build plan.

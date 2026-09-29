# AI Handoff — LiDAR Ink Studio / 3D Line Art

> Read this before making changes.
>
> This file is intended for another AI coding agent (or a human maintainer) taking over development without access to the original long-form conversation.

## 1. Repository and current resume point

Repository:

```text
steveonw/3d-line-art
```

Current development head as of 2026-09-28:

```text
branch: phase-14-confidence-fusion
PR:     #17 — Phase 14: add multi-view confidence fusion
base:   phase-13-auto-view-selection
CI:     passed
```

Resume from **Phase 15 — 3D inspection viewer**.

Do **not** start Phase 16 3D Ink until Phase 15 is implemented, tested, committed, and green.

The project intentionally follows this rule from `ROADMAP.md`:

> Only one unchecked major phase should be active at a time.

## 2. Important Git / PR topology

The current work is a **stacked PR chain**. `main` does not yet contain the whole current application.

Open stack:

```text
main
  ↓
#2  phase-1-frontend-split
  ↓
#3  phase-2-local-server
  ↓
#4  phase-3-lidar-bridge
  ↓
#5  phase-4-lidar-controls
  ↓
#6  phase-5-stable-randomness
  ↓
#7  phase-6-procedural-flow
  ↓
#8  phase-7-math-flow-mixer
  ↓
#9  phase-8-stroke-placement
  ↓
#10 phase-9-undo-autosave
  ↓
#11 phase-10-project-files
  ↓
#12 phase-10-stabilization
  ↓
#13 phase-11-scan-cache
  ↓
#14 phase-11-5-lidar-art-polish
  ↓
#15 phase-12-fixed-multiview
  ↓
#16 phase-13-auto-view-selection
  ↓
#17 phase-14-confidence-fusion ← CURRENT HEAD
```

For Phase 15:

1. Branch from `phase-14-confidence-fusion`.
2. Suggested branch name:

   ```text
   phase-15-3d-inspection-viewer
   ```

3. Open the new PR against:

   ```text
   phase-14-confidence-fusion
   ```

Do not base new work on `main` unless the stacked PRs have first been merged/rebased intentionally.

## 3. Product goal

Build a **local, deterministic LiDAR + mathematical line-art studio**.

Primary flows:

```text
2D image
  → image analysis
  → line renderer
  → PNG / SVG
```

and:

```text
STL / OBJ
  → Python LiDAR engine
  → shaded/depth/edge/variance/confidence maps
  → browser art mapping
  → flow fields + stroke placement
  → line renderer
  → PNG / SVG
```

Later roadmap work adds multi-view sensing, 3D inspection, and true 3D Ink.

The application must **not depend on an LLM** to function. Any future LLM scene helper is optional and must output ordinary geometry into the same deterministic pipeline.

## 4. Run locally

Install dependencies:

```bash
python -m pip install -r requirements.txt
```

Start:

```bash
python run_studio.py
```

Default URL:

```text
http://127.0.0.1:8777/
```

Alternative port:

```bash
python run_studio.py --port 8780
```

No automatic browser:

```bash
python run_studio.py --no-browser
```

The server is intentionally loopback-only.

## 5. Test commands

Run the runtime-only Python suite:

```bash
python -m unittest discover -s tests -v
```

For the full development suite including real Chromium regressions:

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python -m unittest discover -s tests -v
```

Frontend smoke tests:

```bash
node tests/frontend_maps_smoke.js
node tests/frontend_lidar_polish_smoke.js
node tests/frontend_multiview_smoke.js
node tests/frontend_multiview_renderer_smoke.js
node tests/frontend_randomness_smoke.js
node tests/frontend_procedural_flow_smoke.js
node tests/frontend_math_fields_smoke.js
node tests/frontend_stroke_placement_smoke.js
node tests/frontend_history_smoke.js
node tests/frontend_project_file_smoke.js
```

GitHub Actions runs these plus JavaScript syntax checks, real Chromium project/source regressions, and the real cube OBJ → LiDAR engine integration tests.

Do not mark a roadmap phase complete until the exact branch-head CI is green.

## 6. Source-of-truth files

### Roadmap / documentation

```text
ROADMAP.md
README.md
AI_HANDOFF.md
```

### Preserved original renderer

```text
line_art_5_3_streamlines.html
```

Treat this file as the untouched reference/fallback build. Do not casually refactor it.

### Active frontend

```text
frontend/index.html
frontend/styles.css
frontend/app.js
frontend/analysis_maps.js
frontend/random_field.js
frontend/procedural_flow.js
frontend/math_fields.js
frontend/stroke_placement.js
frontend/project_state.js
frontend/history.js
frontend/line_renderer.js
frontend/export.js
frontend/lidar_client.js
```

### Python backend

```text
run_studio.py
server/api.py
server/state.py
server/errors.py
server/lidar_bridge.py
```

### Vendored LiDAR engine

```text
vendor/lidar_engine.py
vendor/NOTICE.md
```

The engine came from `steveonw/lidar-engine`. Preserve upstream licensing/source notices.

### Samples

```text
samples/cube.obj
samples/cube.lidar-ink.json
```

The cube project is a useful Phase 10 reproduction fixture.

## 7. Current architecture

```text
Browser
┌──────────────────────────────────────────────┐
│ index.html / app.js                          │
│                                              │
│ image input ──> analysis_maps.js             │
│                                              │
│ LiDAR maps <── lidar_client.js <── HTTP      │
│                                              │
│ random_field.js                              │
│ procedural_flow.js                           │
│ math_fields.js                               │
│ stroke_placement.js                          │
│          ↓                                   │
│ line_renderer.js                             │
│          ↓                                   │
│ export.js → PNG / SVG                        │
│                                              │
│ history.js + project_state.js                │
│ → undo / redo / autosave / portable JSON     │
└───────────────────────┬──────────────────────┘
                        │ localhost HTTP
                        ▼
Python
┌──────────────────────────────────────────────┐
│ server/api.py                                │
│ server/state.py                              │
│ server/lidar_bridge.py                       │
│          ↓                                   │
│ vendor/lidar_engine.py                       │
└──────────────────────────────────────────────┘
```

Responsibility rule:

- Browser owns art/rendering/UI.
- Python owns mesh loading and LiDAR sensing.
- Do not port the renderer into Python.
- Do not move the full LiDAR raycaster into browser JavaScript.

## 8. Completed phases

### Phase 1 — frontend split

Completed.

### Phase 2 — local server

Completed.

Server safety includes:

- bind to `127.0.0.1`,
- Host-header checks,
- request-size limits,
- serialized expensive operations,
- JSON error IDs,
- static path traversal protection.

### Phase 3 — LiDAR bridge

Completed.

Supports STL/OBJ and produces:

```text
shaded
depth
geometry edge
```

### Phase 4 — proper LiDAR controls

Completed.

Also includes:

```text
depth variance
sensor confidence
camera controls
smart sampling
density source
direction source
LiDAR art presets
```

### Phase 5 — deterministic randomness

Completed.

Critical guarantee:

> Same source + same settings + same seed produces the same geometry.

Also:

> Increasing line count preserves the existing stroke prefix.

Do not break this.

### Phase 6 — procedural flow

Completed.

Deterministic seeded gradient-noise/fBm-style field.

Controls:

```text
Flow Scale
Turbulence
Octaves
Seed
```

### Phase 7 — mathematical field mixer

Completed.

Fields:

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

Absolute line orientations use axial-vector mixing so 0° and 180° are equivalent.

### Phase 8 — deliberate stroke placement

Completed.

Each stroke considers six deterministic candidates scored with:

```text
remaining coverage
darkness
geometry/image edge
depth change
confidence
minimum-spacing preference
deterministic tie-break
```

Coverage remains the final authority.

The deterministic benchmark currently improves useful selections from roughly 90.7% to 96.8%.

### Phase 9 — undo / redo / autosave

Completed.

Features:

```text
Undo / Redo
Ctrl+Z
Ctrl+Y
Ctrl+Shift+Z
80-setting history
slider coalescing
250 ms autosave debounce
reload/crash settings restore
blocked-localStorage fallback
```

Local image bytes are intentionally not stored in browser localStorage.

### Phase 10 — portable project files

Completed.

UI:

```text
Open Project
Save Project
```

Format:

```json
{
  "format": "lidar-ink-project",
  "version": 2,
  "settings": {},
  "source": {},
  "export": {}
}
```

Stores:

- source reference,
- camera,
- LiDAR settings,
- art settings,
- procedural flow,
- mathematical flow mixer,
- palette,
- seed,
- PNG export scale.

Phase 9 v1 autosaves migrate to v2.

Source identity prefers SHA-256 content identity when both sides have it and falls back to filename + known size for older references. Modification time is metadata only, not a hard identity constraint. A mismatched explicit project source blocks rendering/export.

A post-review stabilization pass also fixed:
- autosave source hints becoming accidental permanent project locks,
- stale LiDAR scans being treated as fresh after project/camera changes,
- scan-channel mixing across different scan IDs,
- late async server restore overwriting a newer image selection,
- failed model uploads making the frontend forget the previous scene,
- old rendered scans being relabeled as newly uploaded models,
- NaN/Inf and near-zero-extent mesh acceptance.

Real browser regressions now cover the confirmed state-machine bugs in CI.

Scan binaries are **not** inside the project JSON yet.

### Reference-render review findings

#### Product-quality interpretation

The external automated review's overall conclusion was that the **core renderer, determinism, speed, project files, and architecture are stronger than the current LiDAR gallery initially suggests**.

Useful observations:

- the 2D image path with real tonal shading produced the strongest art,
- Color Threads and curvature-following strokes were visually convincing,
- Architectural Scan and Depth Contours remained readable even before the winding fix,
- the flat-shading bug was the dominant reason tone-led LiDAR presets looked uniformly dark,
- after two-sided normal orientation, torus/terrain-style LiDAR renders recovered visible form,
- project JSON worked well as an automation interface for repeatable headless rendering,
- mathematical Vortex/Rose/Log-Spiral effects can be visually subtle because they are canvas-centered and compete with the surface field,
- known-empty LiDAR background still receives faint low-importance strokes; a later clean-background option would be useful,
- Depth Contours can be sparse on smooth surfaces and Confidence density can show cell-scale speckle.

Environment-specific manual timings from that review (do **not** treat as SLAs):

```text
60k–140k high-quality render: ~1.5 s
640×480 LiDAR scan: ~5–14 s
uncaught page errors during automated gallery sessions: 0 observed
```

Priority implication: after Phase 11 caching, art-quality work should focus first on sensor-to-art evidence/mapping rather than adding more field types.
A Playwright-driven reference-render bundle supplied after Phase 10 found one additional sensor/render issue and gave us stronger regression fixtures.

Key findings now incorporated:

- imported mesh winding must not control shaded tone,
- visible hit normals are oriented against incoming ray direction before channel computation and shading,
- the repository's inward-wound `samples/cube.obj` is a permanent regression fixture for this,
- repeated real-browser high-quality renders with identical source/settings/seed must produce byte-identical PNG output within the same runtime,
- large historical PNG goldens are kept out of CI; their hashes/provenance live in `tests/reference/phase10_reference_manifest.json`,
- reproducible trefoil/torus/still-life/ripple/image fixtures can be generated with `scripts/make_reference_fixtures.py`.

The reference review also observed future art-quality opportunities (not Phase 10 blockers): depth-contour density can become sparse on smooth surfaces, confidence-driven density can show cell-scale speckle, and canvas-centered math fields may read better later if optionally centered on the projected object.

## 9. Current HTTP API

```text
GET  /api/health
GET  /api/state
POST /api/reset

POST /api/scene/upload?filename=model.obj
POST /api/lidar/scan
GET  /api/lidar/maps

GET  /api/lidar/maps/shaded.png?scan_id=<id>
GET  /api/lidar/maps/depth.png?scan_id=<id>
GET  /api/lidar/maps/edge.png?scan_id=<id>
GET  /api/lidar/maps/variance.png?scan_id=<id>
GET  /api/lidar/maps/confidence.png?scan_id=<id>
```

`/api/scene/upload` uses raw request bytes, not multipart.

Current scan request fields:

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

## 10. Current server/cache state

`server/state.py` now holds:

- one current scene object,
- one current scan metadata object,
- one current set of current-scan PNG channel bytes,
- a bounded in-memory LRU of reusable scans.

Default cache bounds:

```text
256 MB soft byte cap
16 entries
```

The stable scan cache key contains:

```text
model SHA-256
width
height
rays_per_pixel
smart_sampling
yaw_deg
elevation_deg
distance_scale
fov_deg
sensor seed
```

Art settings are intentionally excluded.

Uploading a new scene clears the **current scan** but does not clear safely namespaced cache entries. The uploaded model SHA-256 prevents two different files with the same filename from colliding.

Explicit server reset clears the scene, current scan, cache entries, and cache counters.

Current scan metadata exposes `cache_hit`, `cache_key`, and cache statistics. All five cached PNG channels are restored together. Channel retrieval still enforces the current `scan_id` and returns HTTP 409 for stale channel URLs.

## 11. Completed Phase 11 — LiDAR scan caching

Phase 11 is complete.

Implemented:

- content-addressed scan keys using model SHA-256 + normalized sensor inputs,
- bounded in-memory LRU with byte accounting,
- 256 MB / 16-entry default limits,
- exact cache hits that bypass LiDAR engine loading/raycasting,
- full five-channel restoration,
- same-filename/different-model isolation,
- reset clearing,
- cache hit/miss/eviction statistics,
- explicit browser states:
  - `Scan running…`
  - `Scan ready`
  - `Scan cached`
  - `Scan stale`,
- browser verification that art-only preset changes do not issue another scan request.

The cache architecture intentionally follows the good content-addressed/byte-bounded ideas from `steveonw/Read-Aloud-Main`. A separate duplicate in-flight table was not added because this local server already serializes expensive operations.

### Phase 11.5 — LiDAR art mapping polish

Phase 11.5 is complete and intentionally remains browser-side/art-only.

Implemented:

- explicit occupied/no-hit mask derived from LiDAR depth,
- optional clean-background mode,
- deterministic fallback candidate selection inside the occupied region,
- straight and curved stroke-path clipping at the occupancy boundary,
- masked confidence smoothing,
- deterministic iso-depth contour bands blended with local depth-change evidence,
- projected-object centroid/scale derived from occupied LiDAR pixels,
- optional object-centered mathematical fields,
- Math emphasis for stronger mathematical-field readability,
- LiDAR-specific presets opt into the new polish controls,
- defaults preserve pre-11.5 behavior for older project files.

New art settings:

```text
lidar.depthContourStrength
lidar.confidenceSmoothing
lidar.cleanBackground
lidar.objectCenteredFields
flowMixer.mathEmphasis
```

These settings are intentionally excluded from the Phase 11 scan key and must never trigger a LiDAR rescan.

Regression coverage includes:

- shallow smooth depth ramp gains contour density,
- confidence smoothing reduces checkerboard roughness,
- no-hit background is removed from art evidence,
- hard-mask renderer test requires every recorded stroke point to stay inside occupancy,
- custom object center moves Radial/Vortex origins,
- Math emphasis measurably strengthens mathematical influence,
- real Chromium verifies the LiDAR preset and Phase 11.5 controls issue no extra `/api/lidar/scan` request.

## 12. Completed Phase 12 — Fixed multi-view scanning

Phase 12 is complete.

Fixed cameras:

```text
Front  — yaw   0°, elevation 20°
Back   — yaw 180°, elevation 20°
Left   — yaw 270°, elevation 20°
Right  — yaw  90°, elevation 20°
Top    — yaw   0°, elevation 80°
```

Top uses 80° because the existing sensor elevation clamp ends at 80°.

Implementation:

- `POST /api/lidar/multiview` runs all five named views.
- Every named view goes through the existing Phase 11 single-view scan/cache path.
- Cached scans are retrievable by `scan_id` while retained in the bounded LRU.
- The browser holds all five independent map sets after a fixed multi-view scan.
- Current View switches among Front / Back / Left / Right / Top without a scan.
- Combined Views deterministically combines the five 2D evidence maps.
- Per-view debug coloring is applied at stroke-render time and survives black-ink mode.
- Phase 11.5 art mapping remains the common mapping path for every view and for combined mode.
- Project/autosave state stores:
  - `lidar.multiViewMode`,
  - `lidar.multiViewCurrent`,
  - `lidar.multiViewDebugColors`.

Combined mode is intentionally a **2D evidence compositor**. It is not object-space registration and is not Phase 14 confidence fusion.

Freshness rules:

- fixed views ignore interactive single-view yaw/elevation,
- changing yaw/elevation does not stale a fixed multi-view set,
- resolution / rays-per-pixel / smart sampling / camera distance / FOV / sensor seed / model identity do stale it,
- changing Current View / Combined mode / debug coloring / art mapping never raycasts.

Validation includes:

- real cube generation of all five fixed cameras,
- five cache entries on first pass,
- repeat five-view scan succeeds with LiDAR engine loading deliberately disabled,
- Front remains independently retrievable after Top is current,
- archived metadata and PNG channels work by `scan_id`,
- deterministic browser-side combined evidence and contribution coloring,
- recorded stroke RGB proves debug attribution reaches renderer output,
- portable project state round-trips the Phase 12 controls,
- real Chromium verifies local view switching/combining/debugging and cached replay.

## 12.5. Completed Phase 13 — Automatic view selection

Phase 13 is complete.

Planner:

```text
deterministic candidate cameras
  -> acquire through existing scan() cache path
  -> score scan quality
  -> update quality-weighted view-space coverage
  -> choose the largest expected coverage gain
  -> reject near-duplicate viewpoints
  -> stop at target / diminishing returns / max views
```

Implementation:

- `POST /api/lidar/auto` runs automatic acquisition.
- Candidate cameras are deterministic: low, staggered mid, high, and near-top views.
- The default near-duplicate threshold is 35°.
- Per-view quality combines saturated ray-hit visibility with mean confidence over hit pixels.
- Coverage is explicitly named **quality-weighted view-space coverage**; it is not object-space surface reconstruction.
- Every acquired camera calls the existing Phase 11 `scan()` path, so content-addressed caching remains authoritative.
- Auto-selected views preserve independent `scan_id` values and all five PNG channels.
- The Phase 12 current-view and combined-view browser paths accept variable automatic view sets.
- Automatic view names receive deterministic debug colors while preserving the original five fixed-view colors.
- Default stop criteria are target coverage 0.72, minimum 3 views, maximum 6 views, and minimum expected gain 0.035.

Validation includes:

- deterministic candidate generation and view ordering,
- angular separation / duplicate rejection,
- scan-quality and view-space coverage scoring,
- explicit stopping-rule tests,
- real cube acquisition with independently retrievable channels,
- repeat Auto Scan with LiDAR engine loading disabled and all selected views restored from cache,
- HTTP API coverage,
- frontend debug-color smoke coverage,
- real Chromium Auto Scan, view switching, stale/fresh sensor settings, and cache replay.

Post-review stabilization on the same Phase 13 branch additionally establishes:

- single-view confidence treats unmeasured beam coherence as neutral rather than incoherent,
- flat depth-variance fields do not receive the maximum instability penalty,
- the hard clean-background mask cannot connect an isolated one-point stroke to stale scratch-buffer coordinates,
- automatic view IDs survive undo/redo and restored project/autosave settings,
- automatic view labels show human names such as `Low 0°`,
- the automatic response `current_view` matches the server's actual last-acquired current scan,
- failed scans restore a non-running summary state,
- sensor floats are canonicalized once for camera construction, metadata, cache identity, and browser freshness,
- 0° and 360° yaw are the same canonical sensor request,
- the first planner step carries real expected-gain metadata,
- deeply nested JSON is rejected as a bad request instead of surfacing as a 500,
- mutating loopback API requests validate browser Origin when present and require the expected media type,
- README/API documentation now includes Phase 13.

Do **not** undo these fixes by forcing Smart Sampling, lowering the 0.72 target merely to make Auto Scan stop earlier, or changing the Phase 13 planner into object-space fusion. Reviews correctly observed that the current planner often chooses similar angular sequences for different models and that the 2D Combined Views mode is an overlay/compositor. Those are known design boundaries, not reasons to blur the Phase 13/14 separation.

## 12.75. Completed Phase 14 — Confidence fusion

Phase 14 is complete.

Architecture:

```text
cached scan
  -> compact metric depth + confidence evidence
  -> reconstruct approximate world points
  -> reproject into each canonical acquired view
  -> nearest-depth visibility guard
  -> per-source strongest observation
  -> confidence agreement accumulation
  -> fused confidence + support maps
```

Key invariants:

- fusion performs **zero additional LiDAR raycasts**,
- compact fusion evidence is byte-accounted in the existing Phase 11 bounded LRU,
- fusion can be rebuilt with LiDAR engine loading disabled as long as source scans remain cached,
- one-source pixels keep their original confidence,
- additional agreeing camera evidence can increase confidence,
- different model identities cannot be fused,
- Current View and Combined Views use the same per-view fused-confidence products,
- confidence → length / opacity / fragmentation are art-only settings and never rescan or re-fuse,
- zero-strength values preserve legacy rendering.

The world-space reconstruction is intentionally approximate because `depth_per_pixel` is a per-pixel mean and is reconstructed through the pixel center. Phase 14 does not claim retained raw-ray geometry or a full point-cloud archive.

The Phase 12 Combined Views image remains a 2D compositor. Do not conflate that overlay with the separate world-space confidence-fusion layer.

## 12.9. Next task: Phase 15 — 3D inspection viewer

Roadmap scope:

- add Three.js without an LLM dependency,
- show source mesh,
- show LiDAR camera,
- show ray/hit preview,
- show point cloud,
- show selected scan,
- add orbit controls,
- add camera direction gizmo,
- allow scan-viewpoint selection.

Inspect the owner's `Math-tools` for reusable camera/viewer ideas and `text-to-3d` for non-LLM viewer/scaffold ideas where useful. Preserve the Phase 11 cache, Phase 13 automatic acquisition, and Phase 14 confidence products.

## 13. Determinism and behavior invariants

Preserve all of these:

### Rendering determinism

```text
same source
+ same art settings
+ same seed
= same drawing
```

### Stroke-prefix stability

Increasing requested line count must not reshuffle previously generated strokes.

### Procedural determinism

Procedural and mathematical fields must not consume sequential random state in a way that shifts later strokes.

### Source safety

Opening a project for one source must not silently render against a different source.

### LiDAR/art separation

Sensor settings may require a scan.

Art settings must not require a scan.

### Dense rendering

Minimum stroke spacing is a preference, not a hard veto. The coverage grid remains authoritative.

## 14. Security / safety invariants

Keep the local server local.

Do not weaken:

- `127.0.0.1` binding,
- Host-header validation,
- same-loopback Origin validation for browser mutation requests,
- strict JSON/octet-stream media types on mutation endpoints,
- upload-size limit,
- JSON-body-size limit,
- static path traversal checks,
- non-blocking operation lock,
- generic public error messages with local error IDs.

Do not add arbitrary Python engine upload/loading.

Accepted model formats remain:

```text
.stl
.obj
```

Current upload cap:

```text
25 MB
```

Current mesh cap:

```text
250,000 triangles
```

## 15. Important provenance / reuse notes

The owner has explicitly confirmed that the `steveonw` GitHub repositories referenced by this project are their own repositories and are authorized source material for this application.

**For the owner's repositories, do not treat repository-to-repository licensing uncertainty as a blocker.** Another AI may directly inspect, copy, adapt, refactor, or combine useful code from them when that produces a better implementation.

Core owner-controlled references include:

- `steveonw/lidar-engine` — LiDAR sensing engine lineage.
- `steveonw/jubilant-funicular` — local-server/state/error-handling architecture ideas.
- `steveonw/Math-tools` — mathematical/vector/geometry utilities and field concepts.
- `steveonw/lidar-numpy` — confidence/multi-lens ideas.
- `steveonw/lidar-probe` — active-view selection ideas.
- `steveonw/LocalChatBox` — desktop/runtime packaging ideas.
- `steveonw/Read-Aloud-Main` — **primary Phase 11 cache reference**: content-addressed expensive-result caching, memory accounting/eviction, cache-isolation and stress tests; also a strong later reference for portable localhost launchers, app/install fingerprints, integrity checking, save APIs, process reuse, and runtime hardening.
- `steveonw/text-to-3d` — viewer/geometry/verification ideas; still not a required LLM dependency.
- `steveonw/other-tools` — procedural/hash/world-generation utilities may be reused directly where useful.
- other `steveonw` repositories may also be mined for useful subsystems if they materially help a roadmap phase.

Reuse guidance:

- Prefer the best implementation already present in the owner's repos instead of rewriting code merely to avoid cross-repo reuse.
- It is acceptable to copy a focused subsystem and adapt it into this application.
- Preserve the architectural rule: reuse useful subsystems, not whole applications blindly.
- Keep tests and behavior invariants when transplanting code.
- For code that is genuinely from a third party (including third-party code vendored inside an owner repo), preserve required notices/attribution and follow that third party's license terms.
- Do not remove existing license or attribution notices from already vendored third-party components.

## 16. Original design principles

Keep these intact:

> LiDAR determines what the object is.

> Mathematical/procedural systems determine how lines move over it.

> Coverage and sensor evidence determine where strokes are useful.

> The browser is the artist; the Python LiDAR engine is the sensor.

> Build one solid application. Reuse useful subsystems, not entire repositories.

## 17. Known intentional boundaries

- Project files reference sources; they do not embed source/model bytes.
- Project JSON does not yet embed cached scan products.
- Local image bytes are not placed in localStorage.
- The server is single-user/local and maintains one active operation at a time.
- Single-view confidence remains available, and Phase 14 additionally provides per-view multi-view fused confidence.
- Phase 13 automatic selection measures view-space angular coverage; it does not know registered unseen object surfaces.
- Phase 14 reconstructs approximate world-space evidence from per-pixel mean depth; it does not retain the original raw LiDAR ray point cloud.
- Combined Views is a deterministic 2D evidence compositor/overlay; it is distinct from Phase 14 confidence reprojection.
- The current LiDAR camera is pinhole-based single-view scanning.
- LLM support is optional future work, not infrastructure.

## 18. Phase 0 roadmap quirk

The original single-file reference is still present and should be preserved.

The detailed Phase 0 checkboxes in `ROADMAP.md` were not all backfilled even though the milestone summary marks the original renderer as protected.

Do not interpret those unchecked Phase 0 sub-items as permission to restart or rewrite the original renderer.

## 19. How to finish a phase

For every major phase:

1. Branch from the latest phase branch.
2. Implement only that phase.
3. Add focused regression tests.
4. Run direct smoke/syntax checks.
5. Open a stacked PR against the previous phase branch.
6. Wait for the exact branch-head GitHub Actions run.
7. Fix failures before marking the roadmap.
8. Only after CI is green:
   - check the phase items in `ROADMAP.md`,
   - add a short validation note,
   - verify the final roadmap commit is also green.
9. Do not begin the next phase in the same branch.

## 20. Immediate instruction for the next AI

Start here:

```text
Phase 15 — 3D inspection viewer
```

Branch from `phase-14-confidence-fusion` and base the Phase 15 PR on `phase-14-confidence-fusion`.

First inspect:

```text
server/state.py
server/lidar_bridge.py
server/confidence_fusion.py
frontend/app.js
frontend/multiview.js
frontend/lidar_client.js
tests/test_lidar_bridge.py
tests/test_browser_regressions.py
ROADMAP.md
```

Also inspect owner-controlled `steveonw/Math-tools` for camera/viewer interaction ideas and `steveonw/text-to-3d` for useful non-LLM Three.js viewer/scaffold patterns.

Preserve the Phase 11 content-addressed LRU cache, Phase 12/13 scan IDs and multi-view acquisition, and Phase 14 confidence fusion. The viewer should inspect those products rather than introducing a second scan or reconstruction pipeline.

Do not touch Phase 16 3D Ink.

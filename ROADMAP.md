# LiDAR Ink Studio Roadmap

The build goal is to create a local, deterministic LiDAR + mathematical line-art studio first.

The project should not depend on an LLM to work. LLM scene generation remains optional and separate.

## Development rule

Only one unchecked major phase should be active at a time.

Do not start the next phase until the current phase has:

- [ ] A working demo
- [ ] A basic test
- [ ] No known data-loss bug
- [ ] A saved checkpoint/commit

---

## Phase 0 — Preserve the working Line Art Studio

- [ ] Freeze the current Line Art Studio HTML as the reference version
- [ ] Make a separate development copy
- [ ] Confirm image input works
- [ ] Confirm presets work
- [ ] Confirm curved streamlines work
- [ ] Confirm PNG export works
- [ ] Confirm SVG export works
- [ ] Confirm the same seed reproduces the same result
- [ ] Save several known test images/settings

**Done when:** the existing app is reproducible and remains available as a fallback.

---

## Phase 1 — Split the frontend into clean pieces

Target structure:

```text
frontend/
  index.html
  styles.css
  app.js
  line_renderer.js
  analysis_maps.js
  export.js
```

- [x] Move layout into `index.html`
- [x] Move styling into `styles.css`
- [x] Move UI/event logic into `app.js`
- [x] Move stroke rendering into `line_renderer.js`
- [x] Move image/analysis-map construction into `analysis_maps.js`
- [x] Move PNG/SVG export into `export.js`
- [x] Keep the actual drawing algorithm unchanged
- [x] Create one central settings object
- [x] Add build/version information
- [x] Add a basic status/error panel

**Done when:** normal image -> line-art output still matches the reference version.

**Phase 1 validation:** module syntax and functional smoke checks pass. The original single-file build remains untouched for side-by-side visual comparison.

---

## Phase 2 — Build the local server shell

Use the useful local-server architecture from `jubilant-funicular`.

Target structure:

```text
run_studio.py

server/
  api.py
  state.py
  errors.py
```

- [x] Bind to `127.0.0.1` by default
- [x] Serve the frontend from the Python process
- [x] Add central server state
- [x] Add serialized/locked expensive operations
- [x] Add consistent JSON errors and error IDs

Initial API:

```text
GET  /api/health
GET  /api/state
POST /api/reset
```

**Done when:** running

```bash
python run_studio.py
```

opens the whole application.

**Phase 2 validation:** Python compilation passes and the stdlib server test suite passes 6/6 tests covering health/state/reset, busy-write locking, static frontend serving, JSON 404 responses, and path-traversal blocking.

---

## Phase 3 — Minimal LiDAR bridge

Connect `lidar-engine`.

- [x] Add STL upload
- [x] Add OBJ upload
- [x] Load the model once on the server
- [x] Return a shaded map
- [x] Return a depth map
- [x] Return a geometry-edge map

Initial API:

```text
POST /api/scene/upload
POST /api/lidar/scan
GET  /api/lidar/maps
```

Initial mapping into Line Art Studio:

```text
shaded
   -> tone / color

edge_score_geom
   -> edgeStrength

depth gradient
   -> strokeDirection
```

**Done when:**

```text
STL / OBJ
   -> LiDAR scan
   -> line artwork
   -> SVG
```

works end-to-end.

**Phase 3 validation:** GitHub Actions passes the real cube OBJ -> vendored LiDAR engine -> shaded/depth/edge PNG integration test, the HTTP/API suite, JavaScript syntax/DOM checks, and a synthetic LiDAR depth-tangent/edge-map smoke test. The LiDAR maps feed the same renderer/export path used by the Phase 1 image source; visual art-quality comparison remains a manual review step.

## v0.1 checkpoint

Do not start the advanced math or 3D Ink work until this checkpoint is solid.

---

## Phase 4 — Proper LiDAR controls

- [x] Camera controls
- [x] Smart sampling controls
- [x] Scan resolution
- [x] Geometry-edge strength
- [x] Depth influence
- [x] Depth variance/confidence if reliable

Add LiDAR-oriented presets:

- [x] Technical Pencil
- [x] Depth Contours
- [x] Sensor Sketch
- [x] Architectural
- [x] Uncertain Scribble

Add source selectors:

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

**Done when:** LiDAR information clearly changes how the drawing is constructed.

**Phase 4 validation:** GitHub Actions passes JavaScript syntax checks, the browser-side LiDAR map-composition smoke test, the server/API suite, and a real smart-sampled cube OBJ scan through the vendored LiDAR engine. Scan controls require an explicit rescan; density/direction/edge/depth art controls remix the current scan without rerunning LiDAR.

---

## Phase 5 — Better deterministic randomness

Borrow the coordinate-stable randomness idea from `other-tools/Quiet Roads`.

- [x] Add a deterministic `randomAt(x, y, seed)`
- [x] Replace unstable random choices where appropriate
- [x] Keep local variation stable for the same seed
- [x] Avoid scrambling the whole image when stroke count changes

**Done when:** editing settings changes the artwork predictably rather than completely reshuffling it.

**Phase 5 validation:** GitHub Actions passes deterministic hash call-order tests, repeated-render equality, short-vs-long high-quality stroke-prefix equality, preview-geometry stability under opacity/weight amplification, all frontend syntax/map tests, and the existing real LiDAR integration suite. Local path noise is coordinate/seed based and candidate sampling is stroke-index/seed based.

---

## Phase 6 — Procedural flow fields

Borrow the useful procedural-field ideas from the world-generator tools.

- [x] Add seeded Simplex/fBm-style noise
- [x] Create `proceduralFlow(x, y)`
- [x] Add Flow Scale
- [x] Add Turbulence
- [x] Add Octaves
- [x] Keep Seed visible and repeatable

Conceptually:

```text
final direction =
    surface tangent
  + procedural flow
```

**Done when:** strokes can look natural or turbulent while still respecting object geometry.

**Phase 6 validation:** GitHub Actions passes procedural-flow repeatability, zero-turbulence preservation, nearby-sample smoothness, scale/octave behavior, stable-randomness regression checks, frontend LiDAR-map tests, the server/API suite, and the real cube OBJ LiDAR integration test. The procedural field is deterministic and layers on top of the existing image/LiDAR direction field.

---

## Phase 7 — Mathematical flow system

Use `Math-tools` selectively.

Start with:

- [x] Vector-field helpers
- [x] Radial flow
- [x] Vortex flow
- [x] Spiral flow
- [x] Wave flow

Later add optional polar influences:

- [x] Rose
- [x] Cardioid
- [x] Logarithmic spiral

Create one field mixer:

```text
Surface Flow       80%
Depth Contour      50%
Procedural Noise   20%
Spiral Field       10%
```

**Done when:** all artistic direction systems use one common field API.

**Phase 7 validation:** GitHub Actions passes the unified field API tests, radial/vortex orientation checks, deterministic wave behavior, rose/cardioid/log-spiral finiteness, surface-only/depth-only/radial-only mixer tests, procedural weight behavior, combined-field determinism, stable stroke-prefix regression checks, frontend LiDAR-map tests, the server/API suite, and the real cube OBJ LiDAR integration test.

## v0.2 checkpoint

The LiDAR + mathematical art system is now established.

---

## Phase 8 — Improve stroke seeding

- [x] Generate stroke-position candidates
- [x] Score candidates using remaining coverage
- [x] Score candidates using darkness
- [x] Score candidates using geometry edge
- [x] Score candidates using depth change
- [x] Score candidates using confidence
- [x] Add minimum-spacing logic
- [x] Keep the existing coverage grid as the final authority
- [x] Compare old and new sampling efficiency

**Done when:** fewer attempted strokes are wasted and coverage becomes more deliberate.

**Phase 8 validation:** GitHub Actions passes evidence-weight tests for remaining coverage, darkness, geometry edge, depth change, and confidence; minimum-spacing near/far and dense-fallback tests; deterministic short-vs-long stroke-prefix regression; the Phase 7-vs-Phase 8 efficiency fixture; all flow/LiDAR frontend tests; the server/API suite; and the real cube OBJ LiDAR integration test. In the deterministic efficiency fixture, useful selections improve from about 90.7% to 96.8% and average selected remaining need improves from about 0.327 to 0.366.

---

## Phase 9 — Undo, redo, autosave

Borrow application-state ideas from Quilt Designer.

- [x] Add Undo
- [x] Add Redo
- [x] Add Ctrl+Z
- [x] Add Ctrl+Y
- [x] Add versioned project state
- [x] Add debounced autosave
- [x] Add restore after reload/crash
- [x] Make settings changes undoable

**Done when:** normal experimentation no longer risks losing the current setup.

**Phase 9 validation:** GitHub Actions passes versioned project-state validation, undo/redo and redo-branch behavior, slider coalescing, debounced autosave and restore, source-hint replacement without extra undo entries, blocked-storage fallback, keyboard/DOM checks, all deterministic rendering/flow/stroke-placement tests, the server/API suite, and the real cube OBJ LiDAR integration test. Browser settings restore after reload; an in-memory LiDAR scan is reconstructed when the local server still holds it. Local image bytes are intentionally not persisted and must be reselected after reload.

---

## Phase 10 — Real project files

Define a versioned project format:

```text
project.json
```

Store:

- [x] Source model reference
- [x] Camera
- [x] LiDAR settings
- [x] Art settings
- [x] Flow mixer
- [x] Palette
- [x] Seed
- [x] Export settings

Optionally store cached scan products later:

```text
scans/
  shaded.png
  depth.bin
  edge.png
  confidence.bin
```

**Done when:** a project can be saved, closed, reopened, and reproduced.

**Phase 10 validation:** GitHub Actions passes portable project v2 save/open round trips, Phase 9 v1 migration, camera/LiDAR/art/flow/palette/seed/export restoration, source identity matching, future-version and foreign-format rejection, the checked-in cube project fixture, history/autosave regression, all deterministic renderer/flow/stroke-placement tests, the server/API suite, and the real cube OBJ LiDAR integration test. Project files reference source files rather than embedding them; a mismatched source blocks rendering until the referenced image/model is loaded, and stale restored LiDAR scans are marked for rescan.

**Phase 10 post-review stabilization:** real Chromium regressions now cover autosave source freedom, explicit-project source locking, installed-scan freshness, camera round-trips, and byte-identical repeat PNG rendering. Server hardening now enforces scan-id channel isolation, strict finite JSON, non-finite/degenerate mesh rejection, model SHA-256 identity, and two-sided hit-normal orientation so imported triangle winding cannot flatten the shaded LiDAR channel. Failed model uploads preserve the prior scene, asynchronous server restore is generation-guarded, and reference-render hashes/fixture generators are preserved under `tests/reference/` and `scripts/make_reference_fixtures.py`.

## v0.3 checkpoint

The application is now usable as a persistent creative tool.

---

## Phase 11 — LiDAR scan caching

Cache scans based on:

```text
model
camera
resolution
LiDAR settings
```

- [x] Art changes reuse the existing LiDAR scan
- [x] Show "Scan cached"
- [x] Show "Scan running"
- [x] Show "Scan stale"

Example:

```text
Fine Pencil
   -> Architectural
   -> Dense Scribble
```

should not raycast three times.

**Done when:** changing art styles becomes fast.

**Phase 11 validation:** GitHub Actions passes bounded-LRU cache tests, identical-request engine bypass, all-sensor-input cache-key isolation, same-filename/different-model SHA-256 isolation, reset/eviction behavior, five-channel cache restore, API cache metadata checks, and real Chromium regressions for Scan running / Scan cached / Scan stale states. The browser also verifies that art-only preset changes reuse the installed scan without issuing a new `/api/lidar/scan` request.

---

## Phase 11.5 — LiDAR art mapping polish

Focused visual-quality pass before multi-view.

- [x] Optional clean-background mode uses the LiDAR no-hit mask
- [x] Stroke origins and paths stay inside the occupied LiDAR region when clean background is enabled
- [x] Confidence density can be smoothed without bleeding into empty background
- [x] Depth Contours gain deterministic iso-depth bands for smooth surfaces
- [x] Mathematical fields can center on the projected LiDAR object
- [x] Math emphasis can strengthen Vortex / Rose / Log Spiral and related fields
- [x] All new controls remain art-only and do not invalidate or rerun the Phase 11 scan cache

Defaults preserve pre-11.5 project behavior. LiDAR-specific presets opt into the new polish controls.

**Done when:** LiDAR drawings gain cleaner silhouettes and stronger sensor-driven structure without extra raycasts.

**Phase 11.5 validation:** GitHub Actions passes shallow-depth contour-gain tests, masked confidence-smoothing roughness tests, hard background-mask stroke containment, object-centered/math-emphasis tests, all previous deterministic renderer and project tests, and real Chromium verification that the new art controls issue no additional `/api/lidar/scan` request.

---

## Phase 12 — Fixed multi-view scanning

Start with predictable views:

- [x] Front
- [x] Back
- [x] Left
- [x] Right
- [x] Top
- [x] Keep each scan independently inspectable
- [x] Add current-view mode
- [x] Add combined-view mode
- [x] Add per-view debug coloring

**Done when:** several viewpoints can contribute to one drawing.

**Phase 12 validation:** GitHub Actions passes fixed-view camera tests on the real cube, five-entry cache creation and full cache-only replay with the LiDAR engine disabled, archived scan metadata/channel retrieval by `scan_id`, deterministic combined-evidence and debug-attribution tests, project-file round trips for view settings, and real Chromium regressions for current-view switching, combined mode, debug coloring, correct stale/fresh behavior, and fully cached repeat five-view scans.

---

## Phase 13 — Automatic view selection

Borrow the useful active-perception concept from `lidar-probe`.

```text
scan
  -> measure weak coverage
  -> choose another useful camera
  -> scan again
  -> stop at target coverage
```

- [x] Add coverage scoring
- [x] Generate candidate cameras
- [x] Avoid nearly duplicate viewpoints
- [x] Choose the most useful next view
- [x] Add an Auto Scan button
- [x] Add stopping criteria

**Done when:** the application can choose useful viewpoints without manual placement.

**Phase 13 validation:** GitHub Actions passes deterministic candidate generation, angular duplicate rejection, quality-weighted view-space coverage and stopping-rule tests, real-cube automatic acquisition with independently retrievable scan IDs/channels, full cache-only replay with LiDAR engine loading disabled, the automatic-scan API contract, deterministic debug colors for arbitrary auto-view names, and real Chromium verification of Auto Scan selection, local view switching, sensor stale/fresh behavior, and fully cached repeat acquisition.

**Post-review stabilization:** the same branch also fixes and tests low-ray confidence collapse, flat-variance over-penalization, hard-mask stale-point chords, human-readable auto-view labels, undo/redo preservation of automatic view IDs, server/browser current-view consistency, failed-scan summary recovery, canonical sensor floats (including 0°/360° yaw equivalence), first-view expected-gain metadata, deep-JSON rejection, and loopback POST hardening with Origin/media-type checks.

Phase 13 deliberately measures **quality-weighted view-space coverage**, not registered object-surface coverage. Each selected camera still runs through the Phase 11 cached single-view scan path. The current planner remains intentionally view-space based; model-aware unseen-surface selection and true multi-view evidence fusion are not silently folded into this stabilization pass. Phase 14 remains responsible for actual multi-view confidence fusion.

---

## Phase 14 — Confidence fusion

Borrow selected multi-view ideas from `lidar-numpy`.

- [x] Fuse evidence from multiple scans
- [x] Produce confidence as a first-class map
- [x] Allow confidence to affect stroke length
- [x] Allow confidence to affect opacity
- [x] Allow confidence to affect fragmentation

Concept:

```text
high confidence
  -> long / clean / dark

medium confidence
  -> normal

low confidence
  -> short / broken / faint
```

**Done when:** sensor certainty is visibly represented in the drawing.

**Phase 14 validation:** cached scans retain compact metric depth + confidence evidence inside the bounded Phase 11 LRU. Fusion reconstructs approximate world-space hit points, reprojects evidence across acquired camera frames, rejects farther projected evidence behind the nearest depth layer, preserves a lone source's confidence, and raises certainty only when additional views agree. GitHub Actions passes cross-camera reprojection tests, cache-only fusion with LiDAR engine loading deliberately disabled, fusion API/PNG tests, cache byte-accounting tests, project-state round trips, deterministic confidence-style smoke tests, and real Chromium checks that confidence-art controls and view switching never rescan or re-fuse.

The existing Phase 12 **Combined Views** image remains a 2D evidence compositor. Phase 14 confidence fusion is a separate geometric evidence layer derived from cached metric depth. Per-pixel depth is a camera-pixel mean reconstructed through the pixel center, so this is intentionally an approximate world-space reprojection rather than a full retained raw-ray point cloud.

## v0.4 checkpoint

The sensing system now understands and combines multiple viewpoints.

---

## Phase 15 — 3D inspection viewer

Add Three.js without adding an LLM dependency.

Show:

- [x] Source mesh
- [x] LiDAR camera
- [x] Ray/hit preview
- [x] Point cloud
- [x] Selected scan

Interaction:

- [x] Orbit controls
- [x] Camera direction gizmo
- [x] Click/select scan viewpoints
- [x] Reuse useful camera/viewer ideas from Math-tools
- [x] Reuse non-LLM viewer/scaffold ideas from text-to-3d if useful

**Done when:** users can visually position and inspect the sensor before rendering.

**Phase 15 validation:** the studio now includes an offline Three.js inspection workspace over the existing normalized scene and cached scan products. It displays a deterministic mesh preview, selected LiDAR camera/frustum and direction gizmo, confidence-colored cached hit cloud, bounded hit-ray preview, and all acquired fixed/automatic viewpoints. Orbit, pan, zoom, layer toggles, dropdown selection, viewpoint buttons, and clickable 3D camera markers are inspection-only interactions; selecting a multi-view camera synchronizes the existing Current View without rerunning LiDAR or confidence fusion.

Inspection data remains deliberately bounded and deterministic: at most 20,000 mesh triangles, 12,000 cached hit points, and 320 cached hit rays are sent to the browser. The point/ray display reuses Phase 14's per-pixel mean metric-depth evidence and therefore remains an approximate inspection representation, not a retained raw-ray point cloud or a second geometry/reconstruction pipeline. GitHub Actions passes offline-viewer smoke coverage, deterministic snapshot tests, engine-disabled cache-only inspection, API contracts, and real Chromium verification of mesh-only inspection before scanning, multi-view point/ray inspection, browser-side scan-inspection caching, local viewpoint switching, and return to the 2D art canvas.

---

## Phase 16 — 3D Ink

This is a major standalone phase.

Store stroke data in world space:

```text
XYZ
surface normal
tangent
depth
confidence
material
```

- [x] Follow surface tangents
- [x] Grow strokes across actual geometry
- [x] Render lines in Three.js
- [x] Add 2D Ink mode
- [x] Add 3D Ink mode

**Done when:** the user can orbit around a model whose illustration exists on the 3D surface.

**Phase 16 validation:** the completed deterministic 2D stroke prefix can now be projected through the selected LiDAR camera onto the authoritative normalized triangle mesh. Each retained world-space point stores XYZ, camera-facing visible-surface normal, a tangent projected into the local surface plane, direct geometric camera-ray depth, cached selected-scan confidence, material RGB, and piece ID. Paths are densely sampled and split at misses, piece boundaries, and large depth discontinuities so the Three.js drawing follows actual hit geometry instead of bridging empty space.

The UI now has explicit **2D Ink** and **3D Ink** modes. 2D Ink preserves the existing canvas renderer and PNG/SVG workflow. 3D Ink reuses the offline Phase 15 Three.js viewer as a visualization host, with a separately toggleable world-space ink layer; a tiny render-only normal lift avoids z-fighting while stored XYZ remains on the hit surface. Combined Views stays explicitly 2D-only because it has no single camera projection.

Projection is bounded to the deterministic first 5,000 completed 2D strokes and at most 80,000 dense projected samples. The new `POST /api/ink3d/project` route has its own 4 MB JSON cap and uses the existing operation gate; the normal 64 KB sensor/control JSON cap is unchanged. 3D Ink uses direct mesh intersections and cached confidence evidence and performs no new LiDAR burst, smart-sampling pass, or confidence fusion. GitHub Actions passes real-mesh projection/determinism/metadata tests, no-rescan bridge coverage, API and frontend packing tests, and real Chromium verification of 2D → 3D Ink → art-only refresh → 2D with zero additional LiDAR/fusion requests.

## v0.5 checkpoint

The project becomes a true 3D line-art studio.

---

## Phase 17 — Simple geometry creation

Before relying on LLM-generated scenes, add deterministic built-in geometry tools.

Possible generators:

- [ ] Sphere
- [ ] Box
- [ ] Cylinder
- [ ] Lathe/profile
- [ ] Height field

Use the Math-tools curve/revolution ideas where useful.

Everything should enter the same LiDAR pipeline as an uploaded model.

**Done when:** basic 3D objects can be created inside the studio and scanned normally.

---

# Optional branch — LLM Scene Assistant

This is not part of the core application roadmap.

The studio must still work with no API key, no local model, no internet, and no LLM.

Possible architecture:

```text
LLM
 -> scene geometry
 -> OBJ / STL / scene JSON
 -> normal LiDAR Ink pipeline
```

- [ ] LLM may create or modify geometry
- [ ] Output crosses a standard scene boundary
- [ ] No separate rendering path
- [ ] No LiDAR logic inside the LLM layer
- [ ] Failure of the LLM layer cannot break the studio

This should be treated as a later experimental plugin rather than a core phase.

---

# Later polish

## Art-quality follow-ups from reference-render review

These are **not** Phase 11 requirements. Preserve them for later visual-polish work after scan caching is solid.

- [x] Add an optional clean-background mode for LiDAR sources so known no-hit background does not receive faint paper-grain strokes
- [x] Let mathematical fields optionally center on the projected object/occupied scan region instead of always the canvas center
- [x] Improve visible readability/strength tuning for Vortex, Rose, and Log Spiral fields
- [x] Improve Depth Contours coverage on smooth/slowly varying surfaces without destroying contour structure
- [x] Reduce cell-scale speckle when Confidence is used as a density source
- [x] Keep explicit scan-state UI unambiguous: current/cached/running/stale should be visually distinct
- [ ] Consider treating the versioned project JSON as a supported automation/headless input contract, since automated reference rendering worked cleanly through it

Manual reference-review observations (environment-specific, **not performance SLAs**):

```text
60k–140k high-quality line renders: roughly ~1.5 s
640×480 single-view LiDAR scans: roughly 5–14 s
automated review sessions: zero uncaught page errors observed
```

The review concluded that the 2D renderer/art engine is currently stronger than the LiDAR sensor-to-art mapping. Prefer improving the LiDAR evidence/mapping path before adding more decorative flow fields.

## Mathematical experimental modes

- [ ] Recaman spacing/pattern influence
- [ ] Polar ornaments
- [ ] Fractal flow
- [ ] Topographic patterns
- [ ] Mathematical hatching

## Shareable style codes

- [ ] Compact seed/settings codes
- [ ] Versioned format
- [ ] Restore a style from a short code

## Desktop packaging

Use useful packaging/runtime-management ideas from `LocalChatBox` only after the Python/browser version is stable.

- [ ] Desktop wrapper
- [ ] Start/stop backend automatically
- [ ] Runtime diagnostics
- [ ] Installer
- [ ] No terminal required for normal use

---

# Milestone summary

```text
1. Existing renderer protected                 [x]
2. Frontend cleaned up                         [x]
3. Local server                                [x]
4. STL/OBJ -> LiDAR -> line art                [x]
---------------------------------------------------
FIRST MAJOR CHECKPOINT / v0.1

5. LiDAR controls                              [x]
6. Stable seeded randomness                    [x]
7. Procedural noise                            [x]
8. Mathematical flow mixer                     [x]
9. Better stroke placement                     [x]
---------------------------------------------------
ART SYSTEM CHECKPOINT / v0.2

10. Undo / autosave                            [x]
11. Project files                              [x]
12. Scan caching                               [x]
   LiDAR art mapping polish (Phase 11.5)        [x]
---------------------------------------------------
USABILITY CHECKPOINT / v0.3

13. Fixed multi-view                           [x]
14. Auto Scan                                  [ ]
15. Confidence fusion                          [ ]
---------------------------------------------------
SENSOR CHECKPOINT / v0.4

16. 3D viewer                                  [ ]
17. 3D Ink                                     [ ]
18. Basic internal geometry tools              [ ]
---------------------------------------------------
3D STUDIO CHECKPOINT / v0.5+

Optional:
LLM scene helper                               [ ]
Desktop installer                              [ ]
Experimental math modes                        [ ]
```

## Core principle

Build one solid LiDAR + mathematical line-art application and selectively reuse good subsystems from the other projects.

Do not merge entire repositories just because they contain a useful idea.

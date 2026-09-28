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

- [ ] Art changes reuse the existing LiDAR scan
- [ ] Show "Scan cached"
- [ ] Show "Scan running"
- [ ] Show "Scan stale"

Example:

```text
Fine Pencil
   -> Architectural
   -> Dense Scribble
```

should not raycast three times.

**Done when:** changing art styles becomes fast.

---

## Phase 12 — Fixed multi-view scanning

Start with predictable views:

- [ ] Front
- [ ] Back
- [ ] Left
- [ ] Right
- [ ] Top
- [ ] Keep each scan independently inspectable
- [ ] Add current-view mode
- [ ] Add combined-view mode
- [ ] Add per-view debug coloring

**Done when:** several viewpoints can contribute to one drawing.

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

- [ ] Add coverage scoring
- [ ] Generate candidate cameras
- [ ] Avoid nearly duplicate viewpoints
- [ ] Choose the most useful next view
- [ ] Add an Auto Scan button
- [ ] Add stopping criteria

**Done when:** the application can choose useful viewpoints without manual placement.

---

## Phase 14 — Confidence fusion

Borrow selected multi-view ideas from `lidar-numpy`.

- [ ] Fuse evidence from multiple scans
- [ ] Produce confidence as a first-class map
- [ ] Allow confidence to affect stroke length
- [ ] Allow confidence to affect opacity
- [ ] Allow confidence to affect fragmentation

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

## v0.4 checkpoint

The sensing system now understands and combines multiple viewpoints.

---

## Phase 15 — 3D inspection viewer

Add Three.js without adding an LLM dependency.

Show:

- [ ] Source mesh
- [ ] LiDAR camera
- [ ] Ray/hit preview
- [ ] Point cloud
- [ ] Selected scan

Interaction:

- [ ] Orbit controls
- [ ] Camera direction gizmo
- [ ] Click/select scan viewpoints
- [ ] Reuse useful camera/viewer ideas from Math-tools
- [ ] Reuse non-LLM viewer/scaffold ideas from text-to-3d if useful

**Done when:** users can visually position and inspect the sensor before rendering.

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

- [ ] Follow surface tangents
- [ ] Grow strokes across actual geometry
- [ ] Render lines in Three.js
- [ ] Add 2D Ink mode
- [ ] Add 3D Ink mode

**Done when:** the user can orbit around a model whose illustration exists on the 3D surface.

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
12. Scan caching                               [ ]
---------------------------------------------------
USABILITY CHECKPOINT / v0.3

13. Fixed multi-view                           [ ]
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

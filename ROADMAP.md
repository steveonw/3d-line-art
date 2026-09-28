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

- [ ] Move layout into `index.html`
- [ ] Move styling into `styles.css`
- [ ] Move UI/event logic into `app.js`
- [ ] Move stroke rendering into `line_renderer.js`
- [ ] Move image/analysis-map construction into `analysis_maps.js`
- [ ] Move PNG/SVG export into `export.js`
- [ ] Keep the actual drawing algorithm unchanged
- [ ] Create one central settings object
- [ ] Add build/version information
- [ ] Add a basic status/error panel

**Done when:** normal image -> line-art output still matches the reference version.

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

- [ ] Bind to `127.0.0.1` by default
- [ ] Serve the frontend from the Python process
- [ ] Add central server state
- [ ] Add serialized/locked expensive operations
- [ ] Add consistent JSON errors and error IDs

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

---

## Phase 3 — Minimal LiDAR bridge

Connect `lidar-engine`.

- [ ] Add STL upload
- [ ] Add OBJ upload
- [ ] Load the model once on the server
- [ ] Return a shaded map
- [ ] Return a depth map
- [ ] Return a geometry-edge map

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

## v0.1 checkpoint

Do not start the advanced math or 3D Ink work until this checkpoint is solid.

---

## Phase 4 — Proper LiDAR controls

- [ ] Camera controls
- [ ] Smart sampling controls
- [ ] Scan resolution
- [ ] Geometry-edge strength
- [ ] Depth influence
- [ ] Depth variance/confidence if reliable

Add LiDAR-oriented presets:

- [ ] Technical Pencil
- [ ] Depth Contours
- [ ] Sensor Sketch
- [ ] Architectural
- [ ] Uncertain Scribble

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

---

## Phase 5 — Better deterministic randomness

Borrow the coordinate-stable randomness idea from `other-tools/Quiet Roads`.

- [ ] Add a deterministic `randomAt(x, y, seed)`
- [ ] Replace unstable random choices where appropriate
- [ ] Keep local variation stable for the same seed
- [ ] Avoid scrambling the whole image when stroke count changes

**Done when:** editing settings changes the artwork predictably rather than completely reshuffling it.

---

## Phase 6 — Procedural flow fields

Borrow the useful procedural-field ideas from the world-generator tools.

- [ ] Add seeded Simplex/fBm-style noise
- [ ] Create `proceduralFlow(x, y)`
- [ ] Add Flow Scale
- [ ] Add Turbulence
- [ ] Add Octaves
- [ ] Keep Seed visible and repeatable

Conceptually:

```text
final direction =
    surface tangent
  + procedural flow
```

**Done when:** strokes can look natural or turbulent while still respecting object geometry.

---

## Phase 7 — Mathematical flow system

Use `Math-tools` selectively.

Start with:

- [ ] Vector-field helpers
- [ ] Radial flow
- [ ] Vortex flow
- [ ] Spiral flow
- [ ] Wave flow

Later add optional polar influences:

- [ ] Rose
- [ ] Cardioid
- [ ] Logarithmic spiral

Create one field mixer:

```text
Surface Flow       80%
Depth Contour      50%
Procedural Noise   20%
Spiral Field       10%
```

**Done when:** all artistic direction systems use one common field API.

## v0.2 checkpoint

The LiDAR + mathematical art system is now established.

---

## Phase 8 — Improve stroke seeding

- [ ] Generate stroke-position candidates
- [ ] Score candidates using remaining coverage
- [ ] Score candidates using darkness
- [ ] Score candidates using geometry edge
- [ ] Score candidates using depth change
- [ ] Score candidates using confidence
- [ ] Add minimum-spacing logic
- [ ] Keep the existing coverage grid as the final authority
- [ ] Compare old and new sampling efficiency

**Done when:** fewer attempted strokes are wasted and coverage becomes more deliberate.

---

## Phase 9 — Undo, redo, autosave

Borrow application-state ideas from Quilt Designer.

- [ ] Add Undo
- [ ] Add Redo
- [ ] Add Ctrl+Z
- [ ] Add Ctrl+Y
- [ ] Add versioned project state
- [ ] Add debounced autosave
- [ ] Add restore after reload/crash
- [ ] Make settings changes undoable

**Done when:** normal experimentation no longer risks losing the current setup.

---

## Phase 10 — Real project files

Define a versioned project format:

```text
project.json
```

Store:

- [ ] Source model reference
- [ ] Camera
- [ ] LiDAR settings
- [ ] Art settings
- [ ] Flow mixer
- [ ] Palette
- [ ] Seed
- [ ] Export settings

Optionally store cached scan products later:

```text
scans/
  shaded.png
  depth.bin
  edge.png
  confidence.bin
```

**Done when:** a project can be saved, closed, reopened, and reproduced.

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
1. Existing renderer protected                 [ ]
2. Frontend cleaned up                         [ ]
3. Local server                                [ ]
4. STL/OBJ -> LiDAR -> line art                [ ]
---------------------------------------------------
FIRST MAJOR CHECKPOINT / v0.1

5. LiDAR controls                              [ ]
6. Stable seeded randomness                    [ ]
7. Procedural noise                            [ ]
8. Mathematical flow mixer                     [ ]
9. Better stroke placement                     [ ]
---------------------------------------------------
ART SYSTEM CHECKPOINT / v0.2

10. Undo / autosave                            [ ]
11. Project files                              [ ]
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

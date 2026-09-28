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
branch: phase-10-stabilization
PR:     #12 — Phase 10 stabilization: fix project and LiDAR state regressions
base:   phase-10-stabilization
CI:     passed
```

PR #11 remains the portable-project Phase 10 branch immediately below this stabilization PR.

Resume from **Phase 11 — LiDAR scan caching**.

Do **not** start Phase 12 multi-view work until Phase 11 is implemented, tested, committed, and green.

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
#12 phase-10-stabilization   ← CURRENT HEAD
```

For Phase 11:

1. Branch from `phase-10-stabilization`.
2. Suggested branch name:

   ```text
   phase-11-scan-cache
   ```

3. Open the new PR against:

   ```text
   phase-10-project-files
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

## 10. Current server state limitation

`server/state.py` currently holds:

- one current scene object,
- one current scan metadata object,
- one current set of scan-channel PNG bytes.

Uploading a new scene clears the current server scan. Scene metadata now includes SHA-256 of the uploaded raw OBJ/STL bytes. Channel retrieval checks the requested `scan_id`; a stale ID returns HTTP 409 instead of silently serving the current scan.

This is the main place Phase 11 will evolve.

## 11. Next task: Phase 11 — LiDAR scan caching

Roadmap requirement:

Cache scans based on:

```text
model
camera
resolution
LiDAR settings
```

UI must be able to show:

```text
Scan cached
Scan running
Scan stale
```

Changing only art style must reuse the existing scan.

Example:

```text
Fine Pencil
   → Architectural
   → Dense Scribble
```

must not raycast three times.

### Recommended Phase 11 cache key

Use a stable server-side key containing only sensor inputs.

Conceptually:

```text
scene identity
+ width
+ height
+ rays_per_pixel
+ smart_sampling
+ yaw_deg
+ elevation_deg
+ distance_scale
+ fov_deg
+ sensor seed
```

Do **not** include art-only settings such as:

```text
palette
line count
stroke length
stroke weight
opacity
flow mixer
procedural flow
density-source browser remix
direction-source browser remix
geometry-edge display strength
depth influence
art seed
```

Those must remain fast browser-side edits.

### Scene identity

Do not key only on the filename if the server can cheaply retain a stronger identity.

Phase 10 stabilization already computes SHA-256 of the uploaded raw STL/OBJ bytes and stores it in scene metadata.

Phase 11 should reuse that existing fingerprint as the model component of the cache key. This avoids collisions between two different files named `model.obj`.

### Recommended first cache scope

Keep Phase 11 simple and local:

- in-memory cache only,
- bounded/LRU or small fixed maximum,
- cache metadata + existing PNG channel bytes,
- clear cache on explicit server reset,
- replacing the scene may leave old cache entries only if they are safely namespaced by model fingerprint; otherwise clear them.

Disk cache persistence can be a later enhancement unless the roadmap is explicitly changed.


### Primary Phase 11 reference: Read-Aloud-Main

Before inventing the cache machinery, inspect:

```text
steveonw/Read-Aloud-Main
```

especially:

```text
web/app.js
scripts/web_tests.js
scripts/stress_browser.js
cmd/launcher/main.go
```

This is owner-authorized source material and may be copied/adapted directly.

Useful patterns already implemented there:

- content-specific cache keys that include only inputs that change the expensive result,
- a `Map`-backed in-memory cache,
- byte accounting,
- a soft memory cap,
- oldest-entry eviction,
- protecting entries that are actively needed,
- avoiding duplicate expensive work when an equivalent request is already in flight,
- keeping valid results from cancelled/stale runs in cache even when they should not become current UI state,
- cache-isolation tests proving different settings do not collide,
- stress tests for cache growth and eviction,
- application and installation fingerprints,
- localhost launcher hardening and asset-integrity checks.

The Read Aloud sentence cache key follows this principle:

```text
voice + speaker + delivery + speed + exact spoken text
```

The LiDAR equivalent should follow the same rule:

```text
model fingerprint
+ width
+ height
+ rays_per_pixel
+ smart_sampling
+ yaw
+ elevation
+ distance
+ fov
+ sensor seed
```

Do not copy TTS-specific machinery. Reuse the cache architecture and tests.

A particularly useful Read Aloud behavior is:

```text
request A starts
user changes settings
request A finishes
    ├─ do not make A the current UI result
    └─ keep A in cache under A's exact key
```

For LiDAR this means a scan that finishes after camera controls changed can still be retained as a valid cache entry, provided the result is associated with its original immutable scan key. If the user returns to those exact sensor settings later, that result can become an instant hit.

### Suggested server changes

Likely touch:

```text
server/state.py
server/lidar_bridge.py
server/api.py
```

Possible responsibilities:

`server/state.py`

- store scene fingerprint,
- store a bounded map of cache key → scan metadata + channel bytes,
- expose cache hit/current/stale status in the workspace snapshot,
- helper methods for lookup/store/clear.

`server/lidar_bridge.py`

- normalize scan options first,
- build cache key,
- lookup before raycasting,
- on hit: restore cached scan as current and return its map summary,
- on miss: run the existing LiDAR path, then cache the resulting metadata/channels.

`server/api.py`

- API shape may stay the same if `POST /api/lidar/scan` returns a cache-hit marker.
- Avoid adding unnecessary endpoints unless the UI needs them.

Example response addition:

```json
{
  "ok": true,
  "scan": {
    "...": "...",
    "cache": "hit"
  }
}
```

or a boolean like `cache_hit`.

Choose one consistent representation and test it.

### Suggested frontend changes

Likely touch:

```text
frontend/app.js
frontend/lidar_client.js
```

The existing `scanSummary` can show:

```text
Scan cached
Scan running
Scan stale
```

Important distinction:

- **cached** = server reused an exact sensor-result key,
- **running** = engine is raycasting,
- **stale** = current visible scan does not match current camera/sensor controls.

Art-only controls should not mark the sensor scan stale.

### Minimum Phase 11 tests

Add server/unit tests proving:

1. Same scene + identical sensor options:
   - first request computes scan,
   - second request hits cache,
   - engine/raycast path is not executed again.

2. Art-only changes:
   - do not cause a scan request,
   - existing current scan remains reusable.

3. Changing any real sensor input causes a miss:
   - yaw,
   - elevation,
   - distance,
   - FOV,
   - resolution,
   - rays per pixel,
   - smart sampling,
   - sensor seed.

4. Different model bytes with the same filename do not collide.

5. Server reset clears cache/current scan as intended.

6. Cache hit restores all required channels:

   ```text
   shaded
   depth
   edge
   variance
   confidence
   ```

7. The real cube OBJ integration test still passes.

8. Existing deterministic frontend tests remain green.

## 12. Phase 11 non-goals

Do not start these in the cache branch:

- fixed multi-view scanning,
- Auto Scan,
- confidence fusion,
- Three.js viewer,
- world-space strokes,
- 3D Ink,
- internal geometry generators,
- LLM scene generation,
- desktop packaging.

Those have later roadmap phases.

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
- Confidence is currently a single-view proxy, not later multi-view confidence fusion.
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
Phase 11 — LiDAR scan caching
```

First inspect:

```text
server/state.py
server/lidar_bridge.py
server/api.py
frontend/app.js
frontend/lidar_client.js
tests/test_lidar_bridge.py
tests/test_server.py
ROADMAP.md
```

Then inspect the cache implementation and tests in `steveonw/Read-Aloud-Main`, especially `web/app.js` and `scripts/web_tests.js`, and adapt the useful cache patterns rather than redesigning them from scratch.

Implement a minimal, deterministic, bounded in-memory scan cache keyed only by scene identity + sensor inputs.

Do not touch Phase 12.

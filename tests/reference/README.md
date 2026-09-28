# Reference-render review fixtures

This directory records the useful findings from the external Phase 10 reference-render bundle without committing the full multi-megabyte PNG gallery.

The supplied bundle drove the real browser UI with Playwright and exported full-resolution PNGs and LiDAR sensor maps. It established two especially useful regression targets:

1. **Renderer determinism** — two separate high-quality renders of the same source/settings/seed produced byte-identical PNG files.
2. **Winding-independent LiDAR tone** — inward/mixed triangle winding previously flattened the shaded channel because hit normals were used as-is. The stabilization branch now orients visible hit normals against their incoming rays before shading/channel computation.

## Why the large PNGs are not CI goldens

Exact browser PNG bytes are useful within one pinned runtime, but can become brittle across Chromium/Pillow/platform upgrades. CI therefore tests the stronger behavioral invariants:

- `tests/test_browser_regressions.py` renders the same source/settings/seed twice in one real Chromium session and requires identical SHA-256 output.
- `tests/test_lidar_bridge.py` scans the inward-wound sample cube and requires more than a flat single object tone in the shaded map.
- scan/map and deterministic geometry tests continue to verify the underlying engine and renderer.

`phase10_reference_manifest.json` preserves hashes from the supplied review bundle for manual comparison and provenance. They are informational, not cross-version CI requirements.

## Reproducing broader reference scenes

Run:

```bash
python scripts/make_reference_fixtures.py
```

This regenerates procedural meshes and a synthetic shaded 2D source under:

```text
artifacts/reference-fixtures/
```

Those fixtures are intentionally generated rather than checked in as large OBJ/PNG files.

The original review used trefoil, torus, still-life, ripple, cube, and a synthetic shaded image to exercise:

- LiDAR presets,
- camera orbit changes,
- sensor channels,
- procedural/math flow fields,
- tone-vs-depth behavior,
- deterministic repeat rendering.

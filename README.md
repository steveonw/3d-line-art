# 3D Line Art / LiDAR Ink Studio

This repository is being developed in small roadmap phases.

The original single-file Line Art Studio reference build is kept at:

```text
line_art_5_3_streamlines.html
```

The active split frontend is under:

```text
frontend/
```

## Phase 2 local server

Run the studio with Python 3:

```bash
python run_studio.py
```

The server binds only to:

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

### Current API

```text
GET  /api/health
GET  /api/state
POST /api/reset
```

The server is intentionally local-only. Expensive write operations share a non-blocking operation gate so future LiDAR scans cannot collide.

Unexpected server errors receive a short public error ID and are logged locally to:

```text
.lidar-ink/errors.jsonl
```

## Tests

The Phase 2 server uses only the Python standard library.

Run:

```bash
python -m unittest discover -s tests -v
```

See `ROADMAP.md` for the staged build plan.

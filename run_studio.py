#!/usr/bin/env python3
"""Launch the local LiDAR Ink Studio frontend and API server."""

from __future__ import annotations

import argparse
import threading
import webbrowser
from pathlib import Path

from server.api import HOST, PORT, create_server

ROOT = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT / "frontend"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run LiDAR Ink Studio locally.")
    parser.add_argument(
        "--port",
        type=int,
        default=PORT,
        help=f"local HTTP port (default: {PORT})",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="start the server without opening a browser",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not FRONTEND_DIR.is_dir():
        raise SystemExit(f"Frontend directory not found: {FRONTEND_DIR}")

    try:
        server = create_server(FRONTEND_DIR, host=HOST, port=args.port)
    except OSError as error:
        raise SystemExit(
            f"Could not start LiDAR Ink Studio on {HOST}:{args.port}: {error}"
        ) from error

    actual_port = server.server_address[1]
    url = f"http://{HOST}:{actual_port}/"
    print(f"LiDAR Ink Studio: {url}")
    print("Press Ctrl+C to stop.")

    if not args.no_browser:
        timer = threading.Timer(0.25, lambda: webbrowser.open(url))
        timer.daemon = True
        timer.start()

    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        print("\nStopping LiDAR Ink Studio.")
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env bash
set -euo pipefail

echo
echo "LiDAR Ink Studio v0.1 test"
echo "=========================="
echo

if command -v py >/dev/null 2>&1; then
  PY=(py -3)
elif command -v python >/dev/null 2>&1; then
  PY=(python)
elif command -v python3 >/dev/null 2>&1; then
  PY=(python3)
else
  echo "Python 3 was not found."
  echo "Install Python 3, then reopen Git Bash."
  exit 1
fi

echo "Using Python:"
"${PY[@]}" --version
echo

echo "[1/3] Installing dependencies..."
"${PY[@]}" -m pip install -r requirements.txt
echo

echo "[2/3] Running v0.1 tests..."
"${PY[@]}" -m unittest discover -s tests -v
echo

echo "[3/3] Starting LiDAR Ink Studio..."
echo
echo "Open this in your browser if it does not open automatically:"
echo "  http://127.0.0.1:8777/"
echo
echo "Then:"
echo "  1. Under 3D Model, choose samples/cube.obj"
echo "  2. Click Scan LiDAR"
echo "  3. Wait for the line-art preview"
echo "  4. Try Render High Quality"
echo "  5. Try Save SVG"
echo
echo "Press Ctrl+C in Git Bash when you are finished."
echo

"${PY[@]}" run_studio.py

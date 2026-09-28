from __future__ import annotations

import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server.api import HOST, create_server
from server.errors import ErrorRecorder
from server.state import StudioState


class ServerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.frontend = root / "frontend"
        self.frontend.mkdir()
        (self.frontend / "index.html").write_text(
            "<!doctype html><title>Phase 2 Test</title>",
            encoding="utf-8",
        )
        (self.frontend / "app.js").write_text(
            "window.phase2Test = true;",
            encoding="utf-8",
        )
        (root / "secret.txt").write_text("outside frontend", encoding="utf-8")

        self.state = StudioState()
        recorder = ErrorRecorder(root / "errors.jsonl")
        self.server = create_server(
            self.frontend,
            host=HOST,
            port=0,
            state=self.state,
            error_recorder=recorder,
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://{HOST}:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()

    def request(self, path: str, *, method: str = "GET") -> tuple[int, bytes, str]:
        request = Request(self.base + path, method=method)
        try:
            with urlopen(request, timeout=2) as response:
                return (
                    response.status,
                    response.read(),
                    response.headers.get("Content-Type", ""),
                )
        except HTTPError as error:
            return error.code, error.read(), error.headers.get("Content-Type", "")

    def json_request(self, path: str, *, method: str = "GET") -> tuple[int, dict]:
        status, body, _ = self.request(path, method=method)
        return status, json.loads(body.decode("utf-8"))

    def test_health(self) -> None:
        status, payload = self.json_request("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["server_version"], "0.1-phase2")
        self.assertEqual(payload["api_version"], 1)

    def test_state_and_reset(self) -> None:
        status, before = self.json_request("/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(before["state"]["revision"], 0)
        self.assertEqual(before["state"]["reset_count"], 0)

        status, after = self.json_request("/api/reset", method="POST")
        self.assertEqual(status, 200)
        self.assertEqual(after["state"]["revision"], 1)
        self.assertEqual(after["state"]["reset_count"], 1)
        self.assertFalse(after["state"]["busy"])

    def test_busy_write_returns_conflict(self) -> None:
        self.assertTrue(self.state.try_begin_operation("test-operation"))
        try:
            status, payload = self.json_request("/api/reset", method="POST")
        finally:
            self.state.end_operation()

        self.assertEqual(status, 409)
        self.assertEqual(payload["code"], "busy")
        self.assertEqual(payload["state"]["active_operation"], "test-operation")

    def test_static_frontend_is_served(self) -> None:
        status, body, content_type = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn(b"Phase 2 Test", body)
        self.assertIn("text/html", content_type)

        status, body, content_type = self.request("/app.js")
        self.assertEqual(status, 200)
        self.assertIn(b"phase2Test", body)
        self.assertIn("javascript", content_type)

    def test_unknown_api_is_json_404(self) -> None:
        status, payload = self.json_request("/api/nope")
        self.assertEqual(status, 404)
        self.assertEqual(payload["code"], "not_found")

    def test_path_traversal_is_blocked(self) -> None:
        status, body, _ = self.request("/%2e%2e/secret.txt")
        self.assertEqual(status, 404)
        self.assertNotIn(b"outside frontend", body)


if __name__ == "__main__":
    unittest.main()

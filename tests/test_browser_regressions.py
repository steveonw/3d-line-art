"""Headless-browser regressions for Phase 10 project/source state."""

from __future__ import annotations

import hashlib
import json
import tempfile
import threading
import unittest
from pathlib import Path

from PIL import Image

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - optional outside CI/dev installs
    sync_playwright = None

from server.api import create_server
from server.errors import ErrorRecorder
from server.state import StudioState


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
CUBE_OBJ = ROOT / "samples" / "cube.obj"
CUBE_PROJECT = ROOT / "samples" / "cube.lidar-ink.json"

UI_TIMEOUT_MS = 15_000
SCAN_TIMEOUT_MS = 90_000


@unittest.skipIf(sync_playwright is None, "playwright is not installed")
class BrowserRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.playwright = sync_playwright().start()
        try:
            cls.browser = cls.playwright.chromium.launch()
        except Exception as error:
            cls.playwright.stop()
            raise unittest.SkipTest(f"Chromium unavailable: {error}") from error

    @classmethod
    def tearDownClass(cls) -> None:
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        tmp = Path(self.tmp.name)
        self.server = create_server(
            FRONTEND,
            port=0,
            state=StudioState(),
            error_recorder=ErrorRecorder(tmp / "errors.jsonl"),
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        port = self.server.server_address[1]
        self.url = f"http://127.0.0.1:{port}/"

        self.image_a = tmp / "a.png"
        self.image_b = tmp / "b.png"
        Image.new("RGB", (200, 150), (40, 80, 160)).save(self.image_a)
        Image.new("RGB", (220, 160), (200, 120, 40)).save(self.image_b)

        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        self.page.set_default_timeout(UI_TIMEOUT_MS)
        self.page_errors: list[str] = []
        self.page.on("pageerror", lambda error: self.page_errors.append(str(error)))

    def tearDown(self) -> None:
        self.context.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.tmp.cleanup()
        self.assertEqual(self.page_errors, [], "uncaught page errors")

    def open_app(self) -> None:
        self.page.goto(self.url)
        self.page.wait_for_function("document.body.dataset.phase10Ready === 'true'")

    def reload_app(self) -> None:
        self.page.reload()
        self.page.wait_for_function("document.body.dataset.phase10Ready === 'true'")

    def load_image(self, path: Path) -> None:
        with Image.open(path) as img:
            width, height = img.size
        self.page.set_input_files("#imageInput", str(path))
        self.page.wait_for_function(
            "([w, h]) => { const c = document.getElementById('canvas');"
            " return c.width === w && c.height === h; }",
            arg=[width, height],
        )

    def open_project(self, path: Path) -> None:
        self.page.set_input_files("#projectFileInput", str(path))
        self.page.wait_for_function(
            "name => document.getElementById('projectStatus').textContent.includes('Opened ' + name)",
            arg=path.name,
        )

    def upload_cube_and_scan(self) -> None:
        self.page.set_input_files("#modelInput", str(CUBE_OBJ))
        self.page.wait_for_function("!document.getElementById('scanBtn').disabled")
        self.page.click("#scanBtn")
        self.page.wait_for_function(
            "document.getElementById('scanSummary').textContent.startsWith('Scan ')"
            " && !document.getElementById('scanSummary').textContent.startsWith('Scan running')"
            " && !document.getElementById('scanBtn').disabled",
            timeout=SCAN_TIMEOUT_MS,
        )

    def write_project(self, name: str, mutate=None) -> Path:
        project = json.loads(CUBE_PROJECT.read_text(encoding="utf-8"))
        project["settings"]["lidar"]["scanResolution"] = "160x120"
        project["settings"]["lidar"]["raysPerPixel"] = 1
        project["settings"]["lidar"]["smartSampling"] = False
        if mutate:
            mutate(project)
        path = Path(self.tmp.name) / name
        path.write_text(json.dumps(project), encoding="utf-8")
        return path

    def is_disabled(self, selector: str) -> bool:
        return self.page.is_disabled(selector)

    def text(self, selector: str) -> str:
        return self.page.text_content(selector) or ""

    def render_png_sha256(self) -> str:
        self.page.click("#renderBtn")
        self.page.wait_for_function(
            "document.getElementById('status').textContent.startsWith('High quality done')",
            timeout=SCAN_TIMEOUT_MS,
        )
        with self.page.expect_download(timeout=SCAN_TIMEOUT_MS) as download_info:
            self.page.click("#saveBtn")
        path = Path(download_info.value.path())
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def test_autosave_restore_does_not_lock_future_sources(self) -> None:
        self.open_app()
        self.load_image(self.image_a)
        self.page.wait_for_function("!document.getElementById('renderBtn').disabled")
        self.reload_app()
        self.load_image(self.image_b)
        self.assertFalse(
            self.is_disabled("#renderBtn"),
            f"new image blocked after autosave restore: {self.text('#projectStatus')!r}",
        )

    def test_autosave_lock_does_not_persist_across_reloads(self) -> None:
        self.open_app()
        self.load_image(self.image_a)
        self.reload_app()
        self.load_image(self.image_b)
        self.reload_app()
        self.assertNotIn(
            "a.png",
            self.text("#projectStatus"),
            "autosave still demands the original image after switching sources",
        )

    def test_explicit_project_still_blocks_mismatched_source(self) -> None:
        size = self.image_a.stat().st_size

        def reference_image_a(project: dict) -> None:
            project["source"] = {
                "kind": "image",
                "name": "a.png",
                "size": size,
                "lastModified": None,
                "type": "image/png",
                "sha256": None,
            }

        project = self.write_project("image-a.lidar-ink.json", reference_image_a)
        self.open_app()
        self.open_project(project)
        self.load_image(self.image_b)
        self.assertTrue(
            self.is_disabled("#renderBtn"),
            "explicit project rendered against the wrong image",
        )
        self.load_image(self.image_a)
        self.assertFalse(self.is_disabled("#renderBtn"))

    def test_opening_project_with_same_camera_keeps_scan_fresh(self) -> None:
        project = self.write_project("cube.lidar-ink.json")
        self.open_app()
        self.open_project(project)
        self.upload_cube_and_scan()
        self.open_project(project)
        self.assertNotIn("Scan stale", self.text("#scanSummary"))
        self.assertFalse(self.is_disabled("#saveBtn"))

    def test_opening_project_with_different_camera_marks_scan_stale(self) -> None:
        base = self.write_project("cube.lidar-ink.json")

        def move_camera(project: dict) -> None:
            project["settings"]["lidar"]["cameraYaw"] = 200

        moved = self.write_project("cube-yaw200.lidar-ink.json", move_camera)
        self.open_app()
        self.open_project(base)
        self.upload_cube_and_scan()
        self.open_project(moved)
        self.assertEqual(self.page.input_value("#cameraYaw"), "200")
        self.assertIn("Scan stale", self.text("#scanSummary"))
        self.assertTrue(self.is_disabled("#renderBtn"))
        self.assertTrue(self.is_disabled("#saveBtn"))

    def test_slider_returning_to_scanned_value_is_not_stale(self) -> None:
        project = self.write_project("cube.lidar-ink.json")
        self.open_app()
        self.open_project(project)
        self.upload_cube_and_scan()
        original = self.page.input_value("#cameraYaw")
        for value in ("120", original):
            self.page.fill("#cameraYaw", value)
            self.page.dispatch_event("#cameraYaw", "input")
            self.page.dispatch_event("#cameraYaw", "change")
        self.assertNotIn("settings changed", self.text("#scanSummary"))
        self.assertFalse(self.is_disabled("#renderBtn"))

    def test_repeated_scan_uses_cache_and_shows_cached_state(self) -> None:
        project = self.write_project("cube-cache.lidar-ink.json")
        self.open_app()
        self.open_project(project)

        scan_requests = []
        self.page.on(
            "request",
            lambda request: scan_requests.append(request.url)
            if request.url.endswith("/api/lidar/scan")
            else None,
        )

        self.upload_cube_and_scan()
        self.assertIn("Scan ready", self.text("#scanSummary"))
        self.assertEqual(len(scan_requests), 1)

        self.page.click("#scanBtn")
        self.page.wait_for_function(
            "document.getElementById('scanSummary').textContent.startsWith('Scan cached')",
            timeout=SCAN_TIMEOUT_MS,
        )
        self.assertEqual(len(scan_requests), 2)

    def test_fixed_multiview_is_inspectable_combinable_and_cached(self) -> None:
        project = self.write_project("cube-multiview.lidar-ink.json")
        self.open_app()
        self.open_project(project)
        self.page.set_input_files("#modelInput", str(CUBE_OBJ))
        self.page.wait_for_function("!document.getElementById('scanMultiBtn').disabled")

        multiview_requests = []
        single_scan_requests = []
        self.page.on(
            "request",
            lambda request: (
                multiview_requests.append(request.url)
                if request.url.endswith("/api/lidar/multiview")
                else (
                    single_scan_requests.append(request.url)
                    if request.url.endswith("/api/lidar/scan")
                    else None
                )
            ),
        )

        self.page.click("#scanMultiBtn")
        self.page.wait_for_function(
            "document.getElementById('multiViewSummary').textContent.includes('Front ready')"
            " && document.getElementById('multiViewSummary').textContent.includes('Top ready')"
            " && !document.getElementById('scanMultiBtn').disabled",
            timeout=SCAN_TIMEOUT_MS,
        )

        self.assertEqual(len(multiview_requests), 1)
        self.assertEqual(len(single_scan_requests), 0)
        self.assertFalse(self.is_disabled("#multiViewMode"))
        self.assertFalse(self.is_disabled("#multiViewCurrent"))
        self.assertIn("Current: Front", self.text("#multiViewSummary"))
        self.assertFalse(self.is_disabled("#renderBtn"))

        before = len(multiview_requests)
        self.page.select_option("#multiViewCurrent", "back")
        self.page.wait_for_function(
            "document.getElementById('multiViewSummary').textContent.includes('Current: Back')"
        )
        self.assertEqual(len(multiview_requests), before)
        self.assertNotIn("Scan stale", self.text("#scanSummary"))

        self.page.select_option("#multiViewMode", "combined")
        self.page.wait_for_function(
            "document.getElementById('multiViewSummary').textContent.startsWith('Combined')"
        )
        self.assertEqual(len(multiview_requests), before)
        self.assertTrue(self.is_disabled("#multiViewCurrent"))
        self.assertFalse(self.is_disabled("#renderBtn"))

        self.page.check("#multiViewDebugColors")
        self.assertEqual(len(multiview_requests), before)
        self.assertTrue(self.page.is_checked("#multiViewDebugColors"))
        self.assertFalse(self.is_disabled("#renderBtn"))

        # Single-view orbit/elevation controls do not affect fixed named cameras.
        self.page.fill("#cameraYaw", "137")
        self.page.dispatch_event("#cameraYaw", "input")
        self.assertNotIn("Scan stale", self.text("#scanSummary"))

        # Shared sensor controls do affect all five fixed views.
        self.page.fill("#cameraDistance", "3.6")
        self.page.dispatch_event("#cameraDistance", "input")
        self.assertIn("Scan stale", self.text("#scanSummary"))
        self.assertTrue(self.is_disabled("#renderBtn"))

        # Restore the shared setting and repeat the five-view request. Every
        # fixed view should be served from the Phase 11 scan cache.
        self.page.fill("#cameraDistance", "3")
        self.page.dispatch_event("#cameraDistance", "input")
        self.assertNotIn("Scan stale", self.text("#scanSummary"))
        self.page.click("#scanMultiBtn")
        self.page.wait_for_function(
            "document.getElementById('multiViewSummary').textContent.includes('Front cached')"
            " && document.getElementById('multiViewSummary').textContent.includes('Back cached')"
            " && document.getElementById('multiViewSummary').textContent.includes('Left cached')"
            " && document.getElementById('multiViewSummary').textContent.includes('Right cached')"
            " && document.getElementById('multiViewSummary').textContent.includes('Top cached')"
            " && !document.getElementById('scanMultiBtn').disabled",
            timeout=SCAN_TIMEOUT_MS,
        )
        self.assertEqual(len(multiview_requests), 2)
        self.assertEqual(len(single_scan_requests), 0)
        self.assertIn("Scan cached", self.text("#scanSummary"))

    def test_art_preset_change_reuses_current_scan_without_scan_request(self) -> None:
        project = self.write_project("cube-art-reuse.lidar-ink.json")
        self.open_app()
        self.open_project(project)

        scan_requests = []
        self.page.on(
            "request",
            lambda request: scan_requests.append(request.url)
            if request.url.endswith("/api/lidar/scan")
            else None,
        )

        self.upload_cube_and_scan()
        before = len(scan_requests)
        before_status = self.text("#scanSummary")

        self.page.select_option("#preset", "sensorSketch")
        self.page.wait_for_function(
            "document.getElementById('preset').value === 'sensorSketch'"
        )

        self.assertEqual(
            len(scan_requests),
            before,
            "LiDAR art-only preset change unexpectedly requested a new scan",
        )
        self.assertTrue(self.page.is_checked("#cleanBackground"))
        self.assertTrue(self.page.is_checked("#objectCenteredFields"))
        self.assertEqual(self.page.input_value("#confidenceSmoothing"), "0.8")

        self.page.fill("#depthContourStrength", "0.75")
        self.page.dispatch_event("#depthContourStrength", "input")
        self.page.fill("#mixMathEmphasis", "2")
        self.page.dispatch_event("#mixMathEmphasis", "input")

        self.assertEqual(
            len(scan_requests),
            before,
            "Phase 11.5 art controls unexpectedly requested a new LiDAR scan",
        )
        self.assertNotIn("Scan stale", self.text("#scanSummary"))
        self.assertEqual(self.text("#scanSummary"), before_status)
        self.assertFalse(self.is_disabled("#renderBtn"))

    def test_scan_status_shows_running_then_stale(self) -> None:
        project = self.write_project("cube-status.lidar-ink.json")
        self.open_app()
        self.open_project(project)
        self.page.set_input_files("#modelInput", str(CUBE_OBJ))
        self.page.wait_for_function("!document.getElementById('scanBtn').disabled")

        self.page.click("#scanBtn")
        self.page.wait_for_function(
            "document.getElementById('scanSummary').textContent.startsWith('Scan running')",
            timeout=UI_TIMEOUT_MS,
        )
        self.page.wait_for_function(
            "document.getElementById('scanSummary').textContent.startsWith('Scan ready')",
            timeout=SCAN_TIMEOUT_MS,
        )

        self.page.fill("#cameraYaw", "120")
        self.page.dispatch_event("#cameraYaw", "input")
        self.assertIn("Scan stale", self.text("#scanSummary"))

    def test_same_settings_repeat_to_byte_identical_png(self) -> None:
        def lightweight_image_project(project: dict) -> None:
            project["source"] = {"kind": "none"}
            project["settings"]["lineCount"] = 8000
            project["settings"]["preset"] = "finePencil"
            project["settings"]["mode"] = "black"
            project["settings"]["palette"] = "original"
            project["settings"]["procedural"]["turbulence"] = 0
            project["export"]["pngScale"] = "1"

        project = self.write_project(
            "determinism-image.lidar-ink.json",
            lightweight_image_project,
        )

        self.open_app()
        self.open_project(project)
        self.load_image(self.image_a)

        first = self.render_png_sha256()
        second = self.render_png_sha256()

        self.assertEqual(
            first,
            second,
            "same source/settings/seed did not produce byte-identical PNG output",
        )


if __name__ == "__main__":
    unittest.main()

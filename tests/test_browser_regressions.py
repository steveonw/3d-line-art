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

    def select_control_tab(self, tab: str) -> None:
        self.page.click(f'#controlDockTabs button[data-control-tab="{tab}"]')
        self.page.wait_for_function(
            "tab => document.body.dataset.controlDockTab === tab",
            arg=tab,
        )

    def upload_cube_and_scan(self) -> None:
        self.page.set_input_files("#modelInput", str(CUBE_OBJ))
        self.page.wait_for_function("!document.getElementById('scanBtn').disabled")
        self.select_control_tab("lidar")
        self.select_control_tab("lidar")
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
        self.select_control_tab("export")
        self.page.click("#renderBtn")
        self.page.wait_for_function(
            "document.getElementById('status').textContent.startsWith('High quality done')",
            timeout=SCAN_TIMEOUT_MS,
        )
        with self.page.expect_download(timeout=SCAN_TIMEOUT_MS) as download_info:
            self.page.click("#saveBtn")
        path = Path(download_info.value.path())
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def test_control_dock_moves_without_moving_workspace(self) -> None:
        self.open_app()
        self.page.wait_for_function("document.body.dataset.controlDockReady === 'true'")
        self.load_image(self.image_a)
        self.page.wait_for_function("!document.getElementById('canvasShell').hidden")

        def canvas_rect():
            return self.page.evaluate(
                """() => {
                  const r = document.getElementById('canvasShell').getBoundingClientRect();
                  return { left: r.left, top: r.top, width: r.width, height: r.height };
                }"""
            )

        def assert_same_rect(before, after, message):
            for key in ("left", "top", "width", "height"):
                self.assertAlmostEqual(
                    before[key],
                    after[key],
                    delta=0.75,
                    msg=f"{message}: {key} changed from {before[key]} to {after[key]}",
                )

        baseline = canvas_rect()
        self.assertEqual(self.page.evaluate("window.scrollY"), 0)

        self.page.click('#controlDockTabs button[data-control-tab="art"]')
        self.page.wait_for_function("document.body.dataset.controlDockTab === 'art'")
        self.page.evaluate(
            "document.getElementById('controlDockBody').scrollTop = "
            "document.getElementById('controlDockBody').scrollHeight"
        )
        self.assertEqual(self.page.evaluate("window.scrollY"), 0)
        assert_same_rect(baseline, canvas_rect(), "scrolling Control Dock moved preview")

        self.page.click("#controlDockRight")
        self.page.wait_for_function("document.body.dataset.controlDockMode === 'right'")
        assert_same_rect(baseline, canvas_rect(), "right docking moved preview")

        self.page.click("#controlDockFloat")
        self.page.wait_for_function("document.body.dataset.controlDockMode === 'float'")
        dock = self.page.locator("#controlDock").bounding_box()
        head = self.page.locator("#controlDockHead").bounding_box()
        self.assertIsNotNone(dock)
        self.assertIsNotNone(head)
        start_left = dock["x"]
        self.page.mouse.move(head["x"] + 80, head["y"] + 22)
        self.page.mouse.down()
        self.page.mouse.move(head["x"] + 180, head["y"] + 100, steps=5)
        self.page.mouse.up()
        moved = self.page.locator("#controlDock").bounding_box()
        self.assertGreater(abs(moved["x"] - start_left), 20)
        assert_same_rect(baseline, canvas_rect(), "dragging Control Dock moved preview")

        self.page.click("#controlDockLeft")
        self.page.wait_for_function("document.body.dataset.controlDockMode === 'left'")
        assert_same_rect(baseline, canvas_rect(), "left docking moved preview")

        self.page.click("#controlDockMinimize")
        self.page.wait_for_function(
            "document.getElementById('controlDock').classList.contains('minimized')"
        )
        assert_same_rect(baseline, canvas_rect(), "minimizing Control Dock moved preview")

        self.page.click("#controlDockMinimize")
        self.page.click("#controlDockClose")
        self.page.wait_for_function(
            "document.getElementById('controlDock').hidden"
            " && !document.getElementById('controlDockLaunch').hidden"
        )
        assert_same_rect(baseline, canvas_rect(), "closing Control Dock moved preview")

        self.page.click("#controlDockLaunch")
        self.page.wait_for_function(
            "!document.getElementById('controlDock').hidden"
            " && document.body.dataset.controlDockMode === 'left'"
        )
        assert_same_rect(baseline, canvas_rect(), "reopening Control Dock moved preview")

        self.page.click('#controlDockTabs button[data-control-tab="lidar"]')
        self.page.click("#controlDockRight")
        self.reload_app()
        self.page.wait_for_function(
            "document.body.dataset.controlDockReady === 'true'"
            " && document.body.dataset.controlDockMode === 'right'"
            " && document.body.dataset.controlDockTab === 'lidar'"
        )
        self.assertFalse(self.page.locator("#lidarScanControls").get_attribute("hidden"))
        self.assertTrue(self.page.locator("#modelTransformSection").get_attribute("hidden") is not None)

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

    def test_equivalent_zero_and_360_yaw_remain_fresh(self) -> None:
        project = self.write_project(
            "cube-yaw-zero.lidar-ink.json",
            lambda data: data["settings"]["lidar"].update({"cameraYaw": 0}),
        )
        self.open_app()
        self.open_project(project)
        self.upload_cube_and_scan()
        self.page.fill("#cameraYaw", "360")
        self.page.dispatch_event("#cameraYaw", "input")
        self.assertNotIn("Scan stale", self.text("#scanSummary"))
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

    def test_model_transform_moves_authoritative_geometry_and_invalidates_scan(self) -> None:
        project = self.write_project("cube-transform.lidar-ink.json")
        self.open_app()
        self.open_project(project)
        self.upload_cube_and_scan()
        self.page.wait_for_function(
            "document.body.dataset.modelTransformReady === 'true'"
            " && !document.getElementById('applyModelTransformBtn').disabled"
        )

        transform_requests = []
        scan_requests = []
        inspection_scene_requests = []

        def record(request):
            url = request.url
            if url.endswith("/api/scene/transform"):
                transform_requests.append(url)
            elif url.endswith("/api/lidar/scan"):
                scan_requests.append(url)
            elif url.endswith("/api/inspection/scene"):
                inspection_scene_requests.append(url)

        self.page.on("request", record)
        self.select_control_tab("model")
        self.page.click("#inspectionToggle")
        self.page.wait_for_function(
            "!document.getElementById('inspectionShell').hidden"
            " && document.querySelectorAll('#inspectionViewport canvas').length === 1"
            " && document.getElementById('inspectionStatus').textContent.includes('hit rays')",
            timeout=UI_TIMEOUT_MS,
        )
        before_inspection = len(inspection_scene_requests)

        self.page.fill("#modelPositionX", "2")
        self.page.fill("#modelPositionY", "1")
        self.page.fill("#modelPositionZ", "-1")
        self.page.fill("#modelRotationX", "90")
        self.page.fill("#modelRotationY", "35")
        self.page.fill("#modelRotationZ", "15")
        self.page.fill("#modelScale", "1.2")
        self.assertIn("pending", self.text("#modelTransformStatus"))

        self.page.click("#applyModelTransformBtn")
        self.page.wait_for_function(
            "document.getElementById('modelTransformStatus').textContent.startsWith('Applied')"
            " && document.getElementById('scanSummary').textContent.includes('Scan stale')"
            " && !document.getElementById('scanBtn').disabled",
            timeout=UI_TIMEOUT_MS,
        )
        self.assertEqual(len(transform_requests), 1)
        self.assertEqual(len(scan_requests), 0)
        self.assertGreater(len(inspection_scene_requests), before_inspection)
        self.assertTrue(self.is_disabled("#renderBtn"))
        self.assertTrue(
            self.is_disabled('#inkSpaceControl button[data-space="3d"]')
        )

        self.assertFalse(self.is_disabled("#undoBtn"))
        self.select_control_tab("source")
        self.page.click("#undoBtn")
        self.page.wait_for_function(
            "document.getElementById('modelPositionX').value === '0'"
            " && document.getElementById('modelRotationX').value === '0'"
            " && document.getElementById('modelScale').value === '1'"
            " && document.getElementById('modelTransformStatus').textContent.includes('Reset')",
            timeout=UI_TIMEOUT_MS,
        )
        self.assertEqual(len(transform_requests), 2)
        self.assertFalse(self.is_disabled("#redoBtn"))

        self.page.click("#redoBtn")
        self.page.wait_for_function(
            "document.getElementById('modelPositionX').value === '2'"
            " && document.getElementById('modelRotationX').value === '90'"
            " && document.getElementById('modelScale').value === '1.2'"
            " && document.getElementById('modelTransformStatus').textContent.startsWith('Applied')",
            timeout=UI_TIMEOUT_MS,
        )
        self.assertEqual(len(transform_requests), 3)
        self.assertEqual(len(scan_requests), 0)

        state = self.page.evaluate(
            """async () => {
              const response = await fetch('/api/state');
              if (!response.ok) throw new Error('state failed');
              return (await response.json()).state.workspace;
            }"""
        )
        transform = state["scene"]["transform"]
        self.assertEqual(transform["position"]["x"], 2.0)
        self.assertEqual(transform["position"]["y"], 1.0)
        self.assertEqual(transform["position"]["z"], -1.0)
        self.assertEqual(transform["rotation"]["x"], 90.0)
        self.assertEqual(transform["rotation"]["y"], 35.0)
        self.assertEqual(transform["rotation"]["z"], 15.0)
        self.assertEqual(transform["scale"], 1.2)
        self.assertEqual(state["scan"]["status"], "idle")
        self.assertNotEqual(
            state["scene"]["geometry_sha256"],
            state["scene"]["sha256"],
        )

        self.page.click("#scanBtn")
        self.page.wait_for_function(
            "document.getElementById('scanSummary').textContent.startsWith('Scan ')"
            " && !document.getElementById('scanSummary').textContent.includes('running')"
            " && !document.querySelector('#inkSpaceControl button[data-space=\\\"3d\\\"]').disabled",
            timeout=SCAN_TIMEOUT_MS,
        )
        self.assertEqual(len(scan_requests), 1)

        self.select_control_tab("model")
        self.page.click("#resetModelTransformBtn")
        self.page.wait_for_function(
            "document.getElementById('modelTransformStatus').textContent.includes('Reset')"
            " && document.getElementById('modelPositionX').value === '0'"
            " && document.getElementById('modelRotationX').value === '0'"
            " && document.getElementById('modelScale').value === '1'"
            " && document.getElementById('scanSummary').textContent.includes('Scan stale')",
            timeout=UI_TIMEOUT_MS,
        )
        self.assertEqual(len(transform_requests), 4)
        self.assertEqual(len(scan_requests), 1)

    def test_generated_lathe_runs_through_scan_inspection_and_3d_ink(self) -> None:
        self.open_app()
        self.page.wait_for_function(
            "document.body.dataset.phase17Ready === 'true'"
            " && !document.getElementById('generateGeometryBtn').disabled"
        )

        generate_requests = []
        upload_requests = []
        scan_requests = []
        ink_requests = []

        def record(request):
            url = request.url
            if url.endswith("/api/scene/generate"):
                generate_requests.append(url)
            elif "/api/scene/upload" in url:
                upload_requests.append(url)
            elif url.endswith("/api/lidar/scan"):
                scan_requests.append(url)
            elif url.endswith("/api/ink3d/project"):
                ink_requests.append(url)

        self.page.on("request", record)

        self.select_control_tab("model")
        self.page.select_option("#geometryType", "lathe")
        self.page.fill("#geometrySegments", "18")
        self.page.fill(
            "#geometryProfile",
            "0,-1; 0.72,-0.85; 0.95,-0.25; 0.55,0.2; 0.8,0.75; 0,1",
        )
        self.page.click("#generateGeometryBtn")
        self.page.wait_for_function(
            "document.getElementById('modelStatus').textContent.includes('generated-lathe.obj')"
            " && !document.getElementById('scanBtn').disabled"
            " && document.getElementById('geometryStatus').textContent.startsWith('Created lathe')",
            timeout=UI_TIMEOUT_MS,
        )
        self.assertEqual(len(generate_requests), 1)
        self.assertEqual(len(upload_requests), 0)
        self.assertIn("normalized through the standard OBJ pipeline", self.text("#geometryStatus"))

        self.page.click("#inspectionToggle")
        self.page.wait_for_function(
            "!document.getElementById('inspectionShell').hidden"
            " && document.getElementById('inspectionStatus').textContent.includes('Mesh ready')",
            timeout=UI_TIMEOUT_MS,
        )
        self.assertIn("generated-lathe.obj", self.text("#inspectionHudTitle"))

        self.select_control_tab("lidar")
        self.page.select_option("#scanResolution", "160x120")
        self.page.select_option("#raysPerPixel", "1")
        self.page.click("#scanBtn")
        self.page.wait_for_function(
            "document.getElementById('scanSummary').textContent.startsWith('Scan ')"
            " && !document.getElementById('scanSummary').textContent.startsWith('Scan running')"
            " && !document.querySelector('#inkSpaceControl button[data-space=\\\"3d\\\"]').disabled",
            timeout=SCAN_TIMEOUT_MS,
        )
        self.assertEqual(len(scan_requests), 1)
        self.assertIn("Current scan", self.text("#inspectionScanSelect"))

        self.select_control_tab("model")
        self.page.click('#inkSpaceControl button[data-space="3d"]')
        self.page.wait_for_function(
            "document.getElementById('ink3dStatus').textContent.startsWith('3D Ink ready')"
            " && document.querySelector('#inkSpaceControl button[data-space=\\\"3d\\\"]').classList.contains('active')",
            timeout=SCAN_TIMEOUT_MS,
        )
        self.assertEqual(len(ink_requests), 1)
        self.assertEqual(len(scan_requests), 1)
        self.assertIn("surface strokes", self.text("#inspectionHudDetail"))

    def test_generated_geometry_autosave_regenerates_after_server_reset(self) -> None:
        self.open_app()
        generate_requests = []
        transform_requests = []

        def record(request):
            if request.url.endswith("/api/scene/generate"):
                generate_requests.append(request.url)
            elif request.url.endswith("/api/scene/transform"):
                transform_requests.append(request.url)

        self.page.on("request", record)

        self.select_control_tab("model")
        self.page.select_option("#geometryType", "box")
        self.page.fill("#geometryWidth", "2")
        self.page.fill("#geometryHeight", "3")
        self.page.fill("#geometryDepth", "1.5")
        self.page.click("#generateGeometryBtn")
        self.page.wait_for_function(
            "document.getElementById('modelStatus').textContent.includes('generated-box.obj')"
            " && !document.getElementById('scanBtn').disabled"
        )
        self.assertEqual(len(generate_requests), 1)

        self.page.fill("#modelPositionX", "1.5")
        self.page.fill("#modelPositionY", "0.5")
        self.page.fill("#modelRotationY", "45")
        self.page.fill("#modelRotationZ", "-20")
        self.page.fill("#modelScale", "1.1")
        self.page.click("#applyModelTransformBtn")
        self.page.wait_for_function(
            "document.getElementById('modelTransformStatus').textContent.startsWith('Applied')"
        )
        self.assertEqual(len(transform_requests), 1)

        self.page.evaluate(
            """async () => {
              const response = await fetch('/api/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}'
              });
              if (!response.ok) throw new Error('reset failed');
            }"""
        )
        self.reload_app()
        self.page.wait_for_function(
            "document.body.dataset.phase17Ready === 'true'"
            " && document.getElementById('modelStatus').textContent.includes('generated-box.obj')"
            " && document.getElementById('geometryStatus').textContent.includes('Restored generated box')"
            " && document.getElementById('modelPositionX').value === '1.5'"
            " && document.getElementById('modelRotationY').value === '45'"
            " && document.getElementById('modelScale').value === '1.1'"
            " && document.getElementById('modelTransformStatus').textContent.includes('Restored model transform')"
            " && !document.getElementById('scanBtn').disabled",
            timeout=UI_TIMEOUT_MS,
        )
        self.assertEqual(
            len(generate_requests),
            2,
            "autosave recovery should regenerate the saved procedural scene after a server reset",
        )
        self.assertEqual(
            len(transform_requests),
            2,
            "autosave recovery should reapply the saved authoritative model transform",
        )
        workspace = self.page.evaluate(
            """async () => {
              const response = await fetch('/api/state');
              if (!response.ok) throw new Error('state failed');
              return (await response.json()).state.workspace;
            }"""
        )
        self.assertEqual(workspace["scene"]["transform"]["position"]["x"], 1.5)
        self.assertEqual(workspace["scene"]["transform"]["rotation"]["y"], 45.0)
        self.assertEqual(workspace["scene"]["transform"]["rotation"]["z"], -20.0)
        self.assertEqual(workspace["scene"]["transform"]["scale"], 1.1)

    def test_3d_ink_projects_current_art_without_rescanning(self) -> None:
        project = self.write_project("cube-3d-ink.lidar-ink.json")
        self.open_app()
        self.open_project(project)
        self.upload_cube_and_scan()
        self.page.wait_for_function(
            "document.body.dataset.phase16Ready === 'true'"
            " && !document.querySelector('#inkSpaceControl button[data-space=\\\"3d\\\"]').disabled",
            timeout=SCAN_TIMEOUT_MS,
        )

        ink_requests = []
        scan_requests = []
        fusion_requests = []

        def record(request):
            url = request.url
            if url.endswith("/api/ink3d/project"):
                ink_requests.append(url)
            elif url.endswith("/api/lidar/scan"):
                scan_requests.append(url)
            elif url.endswith("/api/lidar/fusion"):
                fusion_requests.append(url)

        self.page.on("request", record)

        self.select_control_tab("model")
        self.page.click('#inkSpaceControl button[data-space="3d"]')
        self.page.wait_for_function(
            "document.querySelector('#inkSpaceControl button[data-space=\\\"3d\\\"]').classList.contains('active')"
            " && !document.getElementById('inspectionShell').hidden"
            " && document.getElementById('ink3dStatus').textContent.startsWith('3D Ink ready')"
            " && document.getElementById('inspectionHudDetail').textContent.includes('surface strokes')",
            timeout=SCAN_TIMEOUT_MS,
        )

        self.assertEqual(len(ink_requests), 1)
        self.assertEqual(len(scan_requests), 0)
        self.assertEqual(len(fusion_requests), 0)
        self.assertTrue(self.page.is_checked("#inspectionShowInk"))
        self.assertTrue(self.page.is_hidden("#canvasShell"))
        self.assertFalse(self.page.is_hidden("#inspectionShell"))

        before_ink = len(ink_requests)
        before_scan = len(scan_requests)
        self.page.evaluate(
            """() => {
              const slider = document.getElementById('strokeLength');
              slider.value = String(Number(slider.value) + 0.5);
              slider.dispatchEvent(new Event('input', { bubbles: true }));
            }"""
        )
        self.page.wait_for_function(
            "document.getElementById('ink3dStatus').textContent.startsWith('3D Ink ready')",
            timeout=SCAN_TIMEOUT_MS,
        )
        self.page.wait_for_function(
            "count => performance.getEntriesByType('resource').filter("
            "e => e.name.endsWith('/api/ink3d/project')).length >= count",
            arg=before_ink + 1,
            timeout=SCAN_TIMEOUT_MS,
        )
        self.assertGreaterEqual(len(ink_requests), before_ink + 1)
        self.assertEqual(len(scan_requests), before_scan)
        self.assertEqual(len(fusion_requests), 0)

        after_refresh = len(ink_requests)
        self.page.uncheck("#inspectionShowInk")
        self.page.check("#inspectionShowInk")
        self.assertEqual(len(ink_requests), after_refresh)
        self.assertEqual(len(scan_requests), before_scan)

        self.page.click('#inkSpaceControl button[data-space="2d"]')
        self.page.wait_for_function(
            "document.querySelector('#inkSpaceControl button[data-space=\\\"2d\\\"]').classList.contains('active')"
            " && document.getElementById('inspectionShell').hidden"
            " && !document.getElementById('canvasShell').hidden"
        )
        self.assertEqual(len(scan_requests), before_scan)

    def test_3d_inspector_uses_local_mesh_and_cached_scan_views(self) -> None:
        project = self.write_project("cube-inspection.lidar-ink.json")
        self.open_app()
        self.open_project(project)
        self.page.set_input_files("#modelInput", str(CUBE_OBJ))
        self.page.wait_for_function(
            "document.body.dataset.phase15Ready === 'true'"
            " && !document.getElementById('inspectionToggle').disabled"
        )

        scene_requests = []
        scan_inspection_requests = []
        multiview_requests = []
        fusion_requests = []
        single_scan_requests = []

        def record(request):
            url = request.url
            if "/api/inspection/scene" in url:
                scene_requests.append(url)
            elif "/api/inspection/scan" in url:
                scan_inspection_requests.append(url)
            elif url.endswith("/api/lidar/multiview"):
                multiview_requests.append(url)
            elif url.endswith("/api/lidar/fusion"):
                fusion_requests.append(url)
            elif url.endswith("/api/lidar/scan"):
                single_scan_requests.append(url)

        self.page.on("request", record)

        self.select_control_tab("model")
        self.page.click("#inspectionToggle")
        self.page.wait_for_function(
            "!document.getElementById('inspectionShell').hidden"
            " && document.querySelectorAll('#inspectionViewport canvas').length === 1"
            " && document.getElementById('inspectionStatus').textContent.includes('Mesh ready')",
            timeout=UI_TIMEOUT_MS,
        )
        self.assertEqual(len(scene_requests), 1)
        self.assertEqual(len(scan_inspection_requests), 0)
        self.assertTrue(self.is_disabled("#inspectionScanSelect"))
        self.assertIn("run LiDAR", self.text("#inspectionHudDetail"))

        self.select_control_tab("lidar")
        self.page.click("#scanMultiBtn")
        self.page.wait_for_function(
            "!document.getElementById('scanMultiBtn').disabled"
            " && document.getElementById('inspectionStatus').textContent.includes('hit rays')"
            " && !document.getElementById('inspectionScanSelect').disabled",
            timeout=SCAN_TIMEOUT_MS,
        )

        self.assertEqual(len(multiview_requests), 1)
        self.assertEqual(len(fusion_requests), 1)
        self.assertEqual(len(single_scan_requests), 0)
        self.assertEqual(len(scene_requests), 1)
        self.assertEqual(len(scan_inspection_requests), 1)
        self.assertIn("hit points", self.text("#inspectionHudDetail"))

        self.select_control_tab("model")
        before_multi = len(multiview_requests)
        before_fusion = len(fusion_requests)
        self.page.locator("#inspectionViewpoints button", has_text="Back").click()
        self.page.wait_for_function(
            "document.getElementById('multiViewCurrent').value === 'back'"
            " && document.getElementById('inspectionStatus').textContent.startsWith('Back')",
            timeout=UI_TIMEOUT_MS,
        )
        self.assertEqual(len(multiview_requests), before_multi)
        self.assertEqual(len(fusion_requests), before_fusion)
        self.assertEqual(len(single_scan_requests), 0)
        self.assertEqual(len(scan_inspection_requests), 2)

        self.page.locator("#inspectionViewpoints button", has_text="Front").click()
        self.page.wait_for_function(
            "document.getElementById('multiViewCurrent').value === 'front'"
            " && document.getElementById('inspectionStatus').textContent.startsWith('Front')",
            timeout=UI_TIMEOUT_MS,
        )
        self.assertEqual(
            len(scan_inspection_requests),
            2,
            "returning to an inspected scan should use the browser inspection cache",
        )

        self.page.uncheck("#inspectionShowPoints")
        self.page.uncheck("#inspectionShowRays")
        self.assertEqual(len(multiview_requests), before_multi)
        self.assertEqual(len(fusion_requests), before_fusion)
        self.assertEqual(len(scan_inspection_requests), 2)

        self.page.click("#inspectionToggle")
        self.page.wait_for_function(
            "document.getElementById('inspectionShell').hidden"
            " && !document.getElementById('canvasShell').hidden"
        )

    def test_fixed_multiview_is_inspectable_combinable_and_cached(self) -> None:
        project = self.write_project("cube-multiview.lidar-ink.json")
        self.open_app()
        self.open_project(project)
        self.page.set_input_files("#modelInput", str(CUBE_OBJ))
        self.page.wait_for_function("!document.getElementById('scanMultiBtn').disabled")

        multiview_requests = []
        fusion_requests = []
        single_scan_requests = []
        self.select_control_tab("lidar")
        self.page.on(
            "request",
            lambda request: (
                multiview_requests.append(request.url)
                if request.url.endswith("/api/lidar/multiview")
                else (
                    fusion_requests.append(request.url)
                    if request.url.endswith("/api/lidar/fusion")
                    else (
                        single_scan_requests.append(request.url)
                        if request.url.endswith("/api/lidar/scan")
                        else None
                    )
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
        self.assertEqual(len(fusion_requests), 1)
        self.assertEqual(len(single_scan_requests), 0)
        self.assertFalse(self.is_disabled("#multiViewMode"))
        self.assertFalse(self.is_disabled("#multiViewCurrent"))
        self.assertIn("Current: Front", self.text("#multiViewSummary"))
        self.assertFalse(self.is_disabled("#renderBtn"))
        self.assertFalse(self.is_disabled("#useFusedConfidence"))
        self.assertIn("fused confidence", self.text("#modelStatus").lower())

        before = len(multiview_requests)
        before_fusion = len(fusion_requests)
        self.select_control_tab("art")
        self.page.check("#useFusedConfidence")
        self.page.fill("#confidenceLength", "0.65")
        self.page.dispatch_event("#confidenceLength", "input")
        self.page.fill("#confidenceOpacity", "0.55")
        self.page.dispatch_event("#confidenceOpacity", "input")
        self.page.fill("#confidenceFragmentation", "0.35")
        self.page.dispatch_event("#confidenceFragmentation", "input")
        self.assertEqual(len(multiview_requests), before)
        self.assertEqual(len(fusion_requests), before_fusion)
        self.assertEqual(len(single_scan_requests), 0)
        self.assertNotIn("Scan stale", self.text("#scanSummary"))
        self.assertFalse(self.is_disabled("#renderBtn"))

        self.select_control_tab("lidar")
        self.page.select_option("#multiViewCurrent", "back")
        self.page.wait_for_function(
            "document.getElementById('multiViewSummary').textContent.includes('Current: Back')"
        )
        self.assertEqual(len(multiview_requests), before)
        self.assertEqual(len(fusion_requests), before_fusion)
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
        self.assertEqual(len(fusion_requests), 2)
        self.assertEqual(len(single_scan_requests), 0)
        self.assertIn("Scan cached", self.text("#scanSummary"))

    def test_auto_scan_selects_views_and_reuses_cached_results(self) -> None:
        project = self.write_project("cube-auto-view.lidar-ink.json")
        self.open_app()
        self.open_project(project)
        self.page.set_input_files("#modelInput", str(CUBE_OBJ))
        self.page.wait_for_function("!document.getElementById('scanAutoBtn').disabled")

        auto_requests = []
        fusion_requests = []
        single_scan_requests = []
        self.select_control_tab("lidar")
        self.page.on(
            "request",
            lambda request: (
                auto_requests.append(request.url)
                if request.url.endswith("/api/lidar/auto")
                else (
                    fusion_requests.append(request.url)
                    if request.url.endswith("/api/lidar/fusion")
                    else (
                        single_scan_requests.append(request.url)
                        if request.url.endswith("/api/lidar/scan")
                        else None
                    )
                )
            ),
        )

        self.page.click("#scanAutoBtn")
        self.page.wait_for_function(
            "document.getElementById('multiViewSummary').textContent.includes('ready')"
            " && !document.getElementById('scanAutoBtn').disabled"
            " && document.body.dataset.phase14Ready === 'true'",
            timeout=SCAN_TIMEOUT_MS,
        )

        self.assertEqual(len(auto_requests), 1)
        self.assertEqual(len(fusion_requests), 1)
        self.assertEqual(len(single_scan_requests), 0)
        options = self.page.locator("#multiViewCurrent option").all()
        self.assertGreaterEqual(len(options), 3)
        self.assertLessEqual(len(options), 6)
        first_value = options[0].get_attribute("value")
        second_value = options[1].get_attribute("value")
        self.assertTrue(first_value.startswith("auto_"))
        self.assertTrue(second_value.startswith("auto_"))
        self.assertIn("views", self.text("#scanSummary"))
        self.assertFalse(self.is_disabled("#renderBtn"))
        self.assertFalse(self.is_disabled("#useFusedConfidence"))

        self.select_control_tab("art")
        self.page.check("#useFusedConfidence")
        self.page.fill("#confidenceLength", "0.4")
        self.page.dispatch_event("#confidenceLength", "input")
        self.assertEqual(len(auto_requests), 1)
        self.assertEqual(len(fusion_requests), 1)

        self.select_control_tab("lidar")
        self.page.select_option("#multiViewCurrent", second_value)
        second_label = options[1].text_content().strip()
        self.page.wait_for_function(
            "label => document.getElementById('multiViewSummary').textContent"
            ".includes('Current: ' + label)",
            arg=second_label,
        )
        self.assertNotIn("current: auto_", self.text("#multiViewSummary").lower())
        self.assertEqual(len(auto_requests), 1)
        self.assertNotIn("Scan stale", self.text("#scanSummary"))

        self.select_control_tab("art")
        self.page.fill("#confidenceSmoothing", "0.45")
        self.page.dispatch_event("#confidenceSmoothing", "input")
        self.page.wait_for_function("!document.getElementById('undoBtn').disabled")
        self.select_control_tab("source")
        self.page.click("#undoBtn")
        self.page.wait_for_function(
            "value => document.getElementById('multiViewCurrent').value === value",
            arg=second_value,
        )
        self.assertIn(second_label, self.text("#multiViewSummary"))

        self.select_control_tab("lidar")
        # Orbit/elevation do not stale an acquired automatic view set because
        # Auto Scan owns camera placement just like fixed multi-view scanning.
        self.page.fill("#cameraYaw", "133")
        self.page.dispatch_event("#cameraYaw", "input")
        self.assertNotIn("Scan stale", self.text("#scanSummary"))

        # Shared sensor settings do stale the set.
        self.page.fill("#cameraDistance", "3.6")
        self.page.dispatch_event("#cameraDistance", "input")
        self.assertIn("Scan stale", self.text("#scanSummary"))
        self.assertTrue(self.is_disabled("#renderBtn"))

        self.page.fill("#cameraDistance", "3")
        self.page.dispatch_event("#cameraDistance", "input")
        self.assertNotIn("Scan stale", self.text("#scanSummary"))

        self.page.click("#scanAutoBtn")
        self.page.wait_for_function(
            "document.getElementById('multiViewSummary').textContent.includes('cached')"
            " && !document.getElementById('scanAutoBtn').disabled",
            timeout=SCAN_TIMEOUT_MS,
        )
        self.assertEqual(len(auto_requests), 2)
        self.assertEqual(len(fusion_requests), 2)
        self.assertEqual(len(single_scan_requests), 0)
        self.assertIn("Scan cached", self.text("#scanSummary"))

    def test_failed_auto_scan_clears_running_summary(self) -> None:
        project = self.write_project("cube-auto-failure.lidar-ink.json")
        self.open_app()
        self.open_project(project)
        self.page.set_input_files("#modelInput", str(CUBE_OBJ))
        self.page.wait_for_function("!document.getElementById('scanAutoBtn').disabled")

        self.select_control_tab("lidar")
        self.page.route(
            "**/api/lidar/auto",
            lambda route: route.fulfill(
                status=500,
                content_type="application/json",
                body='{"ok":false,"error":"forced auto failure"}',
            ),
        )
        self.page.click("#scanAutoBtn")
        self.page.wait_for_function(
            "!document.getElementById('scanAutoBtn').disabled"
            " && document.getElementById('status').textContent.includes('Auto Scan failed')"
        )
        self.assertNotIn("running", self.text("#scanSummary").lower())

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

        self.select_control_tab("art")
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
        self.select_control_tab("lidar")

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

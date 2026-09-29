(() => {
  'use strict';

  const BUILD_VERSION = '5.3-phase17';
  document.body.dataset.build = BUILD_VERSION;

  const MAX_IMAGE_SIDE = 1100;
  const FRAME_BUDGET_MS = 11;
  const PREVIEW_MAX_LINES = 15000;
  const PREVIEW_DEBOUNCE_MS = 200;
  const UINT32_MAX = 4294967295;
  const SVG_WARNING_LINES = 100000;
  const COVERAGE_CELL = 3;
  const MAX_STREAM_POINTS = 6;

  const settings = {
    preset: 'finePencil',
    mode: 'color',
    palette: 'original',
    lineCount: 50000,
    strokeLength: 7,
    strokeWeight: 1.0,
    detail: 1.9,
    opacity: 0.55,
    colorStrength: 1.0,
    paletteStrength: 1.0,
    directionNoise: 0.22,
    angleQuantize: 0,
    sampleBias: 0.70,
    flowStrength: 0.65,
    seed: 2841,
    inkSpace: '2d',
    procedural: {
      scale: 120,
      turbulence: 0,
      octaves: 4
    },
    flowMixer: {
      surface: 1.0,
      depth: 0.0,
      procedural: 1.0,
      radial: 0.0,
      vortex: 0.0,
      spiral: 0.0,
      wave: 0.0,
      rose: 0.0,
      cardioid: 0.0,
      logSpiral: 0.0,
      mathEmphasis: 1.0
    },
    lidar: {
      scanResolution: '320x240',
      raysPerPixel: 2,
      smartSampling: false,
      cameraYaw: 45,
      cameraElevation: 20,
      cameraDistance: 3.0,
      cameraFov: 55,
      densitySource: 'tone',
      directionSource: 'mixed',
      geometryEdgeStrength: 1.0,
      depthInfluence: 0.75,
      depthContourStrength: 0.0,
      confidenceSmoothing: 0.0,
      useFusedConfidence: false,
      confidenceLength: 0.0,
      confidenceOpacity: 0.0,
      confidenceFragmentation: 0.0,
      cleanBackground: false,
      objectCenteredFields: false,
      multiViewMode: 'current',
      multiViewCurrent: 'front',
      multiViewDebugColors: false
    }
  };

  const DEFAULT_SETTINGS = JSON.parse(JSON.stringify(settings));
  const DEFAULT_EXPORT_SETTINGS = Object.freeze({ pngScale: '2' });
  const AUTOSAVE_KEY = 'lidar-ink-studio:project-autosave:v1';
  const PROJECT_FILE_MAX_BYTES = 1024 * 1024;

  const presets = {
    finePencil: {
      mode: 'black', palette: 'original', lineCount: 70000, strokeLength: 5.5,
      strokeWeight: 0.75, detail: 2.2, opacity: 0.42, colorStrength: 1.0,
      paletteStrength: 1.0, directionNoise: 0.16, angleQuantize: 0, sampleBias: 0.78, flowStrength: 0.78
    },
    softSketch: {
      mode: 'black', palette: 'muted', lineCount: 42000, strokeLength: 8.5,
      strokeWeight: 0.85, detail: 1.45, opacity: 0.28, colorStrength: 1.0,
      paletteStrength: 0.7, directionNoise: 0.35, angleQuantize: 0, sampleBias: 0.62, flowStrength: 0.62
    },
    denseScribble: {
      mode: 'black', palette: 'original', lineCount: 140000, strokeLength: 6.5,
      strokeWeight: 0.95, detail: 1.65, opacity: 0.30, colorStrength: 1.0,
      paletteStrength: 1.0, directionNoise: 0.62, angleQuantize: 0, sampleBias: 0.72, flowStrength: 0.48
    },
    colorThreads: {
      mode: 'color', palette: 'original', lineCount: 90000, strokeLength: 12,
      strokeWeight: 1.05, detail: 1.55, opacity: 0.48, colorStrength: 1.25,
      paletteStrength: 1.0, directionNoise: 0.25, angleQuantize: 0, sampleBias: 0.67, flowStrength: 0.90
    },
    architectural: {
      mode: 'black', palette: 'monochrome', lineCount: 60000, strokeLength: 11,
      strokeWeight: 0.85, detail: 2.6, opacity: 0.52, colorStrength: 1.0,
      paletteStrength: 1.0, directionNoise: 0.08, angleQuantize: Math.PI / 4, sampleBias: 0.80, flowStrength: 0.18
    },
    chaotic: {
      mode: 'color', palette: 'limited', lineCount: 105000, strokeLength: 15,
      strokeWeight: 1.15, detail: 1.15, opacity: 0.36, colorStrength: 1.35,
      paletteStrength: 0.9, directionNoise: 1.15, angleQuantize: 0, sampleBias: 0.55, flowStrength: 0.72
    },
    technicalPencil: {
      mode: 'black', palette: 'monochrome', lineCount: 85000, strokeLength: 5.5,
      strokeWeight: 0.68, detail: 2.8, opacity: 0.46, colorStrength: 1.0,
      paletteStrength: 1.0, directionNoise: 0.10, angleQuantize: 0, sampleBias: 0.82, flowStrength: 0.82,
      lidar: { densitySource: 'tone', directionSource: 'mixed', geometryEdgeStrength: 1.55, depthInfluence: 0.72, depthContourStrength: 0.35, confidenceSmoothing: 0.35, cleanBackground: true, objectCenteredFields: true }
    },
    depthContours: {
      mode: 'black', palette: 'monochrome', lineCount: 95000, strokeLength: 9,
      strokeWeight: 0.65, detail: 1.7, opacity: 0.36, colorStrength: 1.0,
      paletteStrength: 1.0, directionNoise: 0.05, angleQuantize: 0, sampleBias: 0.84, flowStrength: 0.96,
      lidar: { densitySource: 'depthChange', directionSource: 'depthTangent', geometryEdgeStrength: 0.45, depthInfluence: 1.0, depthContourStrength: 0.90, confidenceSmoothing: 0.30, cleanBackground: true, objectCenteredFields: true }
    },
    sensorSketch: {
      mode: 'black', palette: 'muted', lineCount: 70000, strokeLength: 7.5,
      strokeWeight: 0.82, detail: 2.0, opacity: 0.38, colorStrength: 1.0,
      paletteStrength: 0.75, directionNoise: 0.28, angleQuantize: 0, sampleBias: 0.72, flowStrength: 0.78,
      lidar: { densitySource: 'confidence', directionSource: 'mixed', geometryEdgeStrength: 1.05, depthInfluence: 0.68, depthContourStrength: 0.35, confidenceSmoothing: 0.80, useFusedConfidence: true, confidenceLength: 0.45, confidenceOpacity: 0.55, confidenceFragmentation: 0.35, cleanBackground: true, objectCenteredFields: true }
    },
    architecturalScan: {
      mode: 'black', palette: 'monochrome', lineCount: 72000, strokeLength: 11,
      strokeWeight: 0.80, detail: 3.0, opacity: 0.50, colorStrength: 1.0,
      paletteStrength: 1.0, directionNoise: 0.06, angleQuantize: Math.PI / 4, sampleBias: 0.84, flowStrength: 0.28,
      lidar: { densitySource: 'geometryEdge', directionSource: 'mixed', geometryEdgeStrength: 1.85, depthInfluence: 0.38, depthContourStrength: 0.50, confidenceSmoothing: 0.40, cleanBackground: true, objectCenteredFields: true }
    },
    uncertainScribble: {
      mode: 'black', palette: 'muted', lineCount: 110000, strokeLength: 6.5,
      strokeWeight: 0.92, detail: 1.65, opacity: 0.27, colorStrength: 1.0,
      paletteStrength: 0.65, directionNoise: 0.92, angleQuantize: 0, sampleBias: 0.60, flowStrength: 0.56,
      lidar: { densitySource: 'tone', directionSource: 'mixed', geometryEdgeStrength: 0.85, depthInfluence: 0.48, depthContourStrength: 0.30, confidenceSmoothing: 0.55, cleanBackground: true, objectCenteredFields: true }
    }
  };

  const sliderDefs = [
    { key: 'strokeLength', label: 'Stroke Length', min: 2, max: 24, step: 0.5, format: v => Number(v).toFixed(1) },
    { key: 'strokeWeight', label: 'Stroke Weight', min: 0.2, max: 3.0, step: 0.05, format: v => Number(v).toFixed(2) },
    { key: 'detail', label: 'Detail', min: 0.5, max: 4.0, step: 0.05, format: v => Number(v).toFixed(2) },
    { key: 'opacity', label: 'Opacity', min: 0.05, max: 1.0, step: 0.01, format: v => Math.round(Number(v) * 100) + '%' },
    { key: 'colorStrength', label: 'Color Strength', min: 0, max: 2.0, step: 0.05, format: v => Number(v).toFixed(2) },
    { key: 'paletteStrength', label: 'Palette Strength', min: 0, max: 1.0, step: 0.05, format: v => Math.round(Number(v) * 100) + '%' },
    { key: 'flowStrength', label: 'Stroke Flow', min: 0, max: 1.0, step: 0.05, format: v => Math.round(Number(v) * 100) + '%' }
  ];

  const mixerDefs = [
    { key: 'surface', id: 'mixSurface' },
    { key: 'depth', id: 'mixDepth' },
    { key: 'procedural', id: 'mixProcedural' },
    { key: 'radial', id: 'mixRadial' },
    { key: 'vortex', id: 'mixVortex' },
    { key: 'spiral', id: 'mixSpiral' },
    { key: 'wave', id: 'mixWave' },
    { key: 'rose', id: 'mixRose' },
    { key: 'cardioid', id: 'mixCardioid' },
    { key: 'logSpiral', id: 'mixLogSpiral' },
    { key: 'mathEmphasis', id: 'mixMathEmphasis', min: 0.25, max: 3 }
  ];

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const imageInput = document.getElementById('imageInput');
  const modelInput = document.getElementById('modelInput');
  const geometryType = document.getElementById('geometryType');
  const geometryRadius = document.getElementById('geometryRadius');
  const geometryWidth = document.getElementById('geometryWidth');
  const geometryHeight = document.getElementById('geometryHeight');
  const geometryDepth = document.getElementById('geometryDepth');
  const geometrySegments = document.getElementById('geometrySegments');
  const geometryRings = document.getElementById('geometryRings');
  const geometryProfile = document.getElementById('geometryProfile');
  const geometryPattern = document.getElementById('geometryPattern');
  const geometryAmplitude = document.getElementById('geometryAmplitude');
  const geometryFrequency = document.getElementById('geometryFrequency');
  const geometryGrid = document.getElementById('geometryGrid');
  const generateGeometryBtn = document.getElementById('generateGeometryBtn');
  const geometryStatus = document.getElementById('geometryStatus');
  const inkSpaceControl = document.getElementById('inkSpaceControl');
  const buildInk3DBtn = document.getElementById('buildInk3DBtn');
  const ink3dStatus = document.getElementById('ink3dStatus');
  const scanBtn = document.getElementById('scanBtn');
  const scanMultiBtn = document.getElementById('scanMultiBtn');
  const scanAutoBtn = document.getElementById('scanAutoBtn');
  const multiViewMode = document.getElementById('multiViewMode');
  const multiViewCurrent = document.getElementById('multiViewCurrent');
  const multiViewDebugColors = document.getElementById('multiViewDebugColors');
  const multiViewSummary = document.getElementById('multiViewSummary');
  const inspectionToggle = document.getElementById('inspectionToggle');
  const inspectionScanSelect = document.getElementById('inspectionScanSelect');
  const inspectionShowMesh = document.getElementById('inspectionShowMesh');
  const inspectionShowPoints = document.getElementById('inspectionShowPoints');
  const inspectionShowRays = document.getElementById('inspectionShowRays');
  const inspectionShowCameras = document.getElementById('inspectionShowCameras');
  const inspectionShowInk = document.getElementById('inspectionShowInk');
  const inspectionResetView = document.getElementById('inspectionResetView');
  const inspectionViewpoints = document.getElementById('inspectionViewpoints');
  const inspectionStatus = document.getElementById('inspectionStatus');
  const inspectionShell = document.getElementById('inspectionShell');
  const inspectionViewport = document.getElementById('inspectionViewport');
  const inspectionHudTitle = document.getElementById('inspectionHudTitle');
  const inspectionHudDetail = document.getElementById('inspectionHudDetail');
  const modelStatus = document.getElementById('modelStatus');
  const scanSummary = document.getElementById('scanSummary');
  const scanResolution = document.getElementById('scanResolution');
  const raysPerPixel = document.getElementById('raysPerPixel');
  const smartSampling = document.getElementById('smartSampling');
  const cameraYaw = document.getElementById('cameraYaw');
  const cameraYawValue = document.getElementById('cameraYawValue');
  const cameraElevation = document.getElementById('cameraElevation');
  const cameraElevationValue = document.getElementById('cameraElevationValue');
  const cameraDistance = document.getElementById('cameraDistance');
  const cameraDistanceValue = document.getElementById('cameraDistanceValue');
  const cameraFov = document.getElementById('cameraFov');
  const cameraFovValue = document.getElementById('cameraFovValue');
  const densitySource = document.getElementById('densitySource');
  const directionSource = document.getElementById('directionSource');
  const geometryEdgeStrength = document.getElementById('geometryEdgeStrength');
  const geometryEdgeStrengthValue = document.getElementById('geometryEdgeStrengthValue');
  const depthInfluence = document.getElementById('depthInfluence');
  const depthInfluenceValue = document.getElementById('depthInfluenceValue');
  const depthContourStrength = document.getElementById('depthContourStrength');
  const depthContourStrengthValue = document.getElementById('depthContourStrengthValue');
  const confidenceSmoothing = document.getElementById('confidenceSmoothing');
  const confidenceSmoothingValue = document.getElementById('confidenceSmoothingValue');
  const useFusedConfidence = document.getElementById('useFusedConfidence');
  const confidenceLength = document.getElementById('confidenceLength');
  const confidenceLengthValue = document.getElementById('confidenceLengthValue');
  const confidenceOpacity = document.getElementById('confidenceOpacity');
  const confidenceOpacityValue = document.getElementById('confidenceOpacityValue');
  const confidenceFragmentation = document.getElementById('confidenceFragmentation');
  const confidenceFragmentationValue = document.getElementById('confidenceFragmentationValue');
  const cleanBackground = document.getElementById('cleanBackground');
  const objectCenteredFields = document.getElementById('objectCenteredFields');
  const presetSelect = document.getElementById('preset');
  const modeControl = document.getElementById('modeControl');
  const paletteSelect = document.getElementById('palette');
  const lineCountRange = document.getElementById('lineCountRange');
  const lineCountNumber = document.getElementById('lineCountNumber');
  const lineCountDisplay = document.getElementById('lineCountDisplay');
  const slidersRoot = document.getElementById('sliders');
  const flowScale = document.getElementById('flowScale');
  const flowScaleValue = document.getElementById('flowScaleValue');
  const flowTurbulence = document.getElementById('flowTurbulence');
  const flowTurbulenceValue = document.getElementById('flowTurbulenceValue');
  const flowOctaves = document.getElementById('flowOctaves');
  const flowOctavesValue = document.getElementById('flowOctavesValue');
  const mixerControls = Object.fromEntries(
    mixerDefs.map(def => [def.key, {
      input: document.getElementById(def.id),
      value: document.getElementById(def.id + 'Value')
    }])
  );
  const seedInput = document.getElementById('seedInput');
  const variationBtn = document.getElementById('variationBtn');
  const openProjectBtn = document.getElementById('openProjectBtn');
  const saveProjectBtn = document.getElementById('saveProjectBtn');
  const projectFileInput = document.getElementById('projectFileInput');
  const projectStatus = document.getElementById('projectStatus');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const autosaveStatus = document.getElementById('autosaveStatus');
  const historyHelp = document.getElementById('historyHelp');
  const renderBtn = document.getElementById('renderBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const saveBtn = document.getElementById('saveBtn');
  const saveSvgBtn = document.getElementById('saveSvgBtn');
  const pngScaleSelect = document.getElementById('pngScale');
  const statusEl = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  const statLines = document.getElementById('statLines');
  const statPercent = document.getElementById('statPercent');
  const statTime = document.getElementById('statTime');
  const exportNote = document.getElementById('exportNote');
  const emptyState = document.getElementById('emptyState');
  const canvasShell = document.getElementById('canvasShell');

  let sourceImage = null;
  let sourceCanvas = null;
  let sourcePixels = null;
  let luminance = null;
  let edgeStrength = null;
  let colorInkNeed = null;
  let strokeDirection = null;
  let directionCoherence = null;

  let previewTimer = 0;
  let renderSerial = 0;
  let loadSerial = 0;
  let loadingImage = false;
  let modelLoading = false;
  let scanRunning = false;
  let sceneLoaded = false;
  let sourceKind = 'none';
  let sourceName = null;
  let sourceReference = null;
  let modelReference = null;
  let requiredSourceReference = null;
  let lidarSourceMaps = null;
  let installedScanSignature = null;
  let installedScanId = null;
  let installedScanMetadata = null;
  let installedScanLabel = null;
  let installedScanCacheHit = false;
  let installedScanMode = 'single';
  let installedMultiViewSignature = null;
  let multiViewBundle = null;
  let scanDirty = false;
  let activeRender = null;

  let inspectionViewer = null;
  let inspectionOpen = false;
  let inspectionLoading = false;
  let inspectionSceneCache = null;
  let inspectionSceneSha = null;
  const inspectionScanCache = new Map();
  let inspectionSerial = 0;

  let ink3dSnapshot = null;
  let ink3dDirty = true;
  let ink3dLoading = false;
  let ink3dSerial = 0;

  let displayStrokeStore = null;
  let displayRenderMeta = null;
  let highQualityStrokeStore = null;
  let highQualityRenderMeta = null;
  let highQualityStale = false;
  let projectDownloadUrl = null;

  const renderer = LineArtRenderer.createRenderer({
    ctx,
    coverageCell: COVERAGE_CELL,
    maxStreamPoints: MAX_STREAM_POINTS
  });

  const exporter = LineArtExport.createExporter({
    frameBudgetMs: FRAME_BUDGET_MS,
    maxStreamPoints: MAX_STREAM_POINTS,
    svgWarningLines: SVG_WARNING_LINES,
    getExportTarget,
    getScale: () => pngScaleSelect.value,
    isRenderActive: () => !!activeRender,
    setStatus,
    setStats,
    refreshButtons,
    formatCount
  });


  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function blend(a, b, t) { return a + (b - a) * t; }
  function formatCount(v) { return Math.round(v).toLocaleString(); }
  function nextFrame() { return new Promise(resolve => requestAnimationFrame(resolve)); }

  function normalizeSeed(v) {
    let n = Math.floor(Number(v));
    if (!Number.isFinite(n)) n = 1;
    n = clamp(n, 1, UINT32_MAX);
    return n >>> 0 || 1;
  }

  function canonicalSensorFloat(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return n;
    const rounded = Math.round(n * 1e6) / 1e6;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function canonicalYaw(value) {
    const n = canonicalSensorFloat(value);
    if (!Number.isFinite(n)) return n;
    return canonicalSensorFloat(((n % 360) + 360) % 360);
  }

  function safeMultiViewName(value) {
    return typeof value === 'string' && /^[a-z0-9_]{1,48}$/.test(value);
  }

  function randomSeed() {
    if (globalThis.crypto?.getRandomValues) {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] || 1;
    }
    return ((Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0) || 1;
  }

  let historyReady = false;
  let historyApplying = false;
  let historyUiLocked = false;
  let restoredSourceHint = null;

  async function sha256File(file) {
    if (!file || !globalThis.crypto?.subtle || typeof file.arrayBuffer !== 'function') {
      return null;
    }
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return null;
    }
  }

  async function fileSourceReference(file, kind, knownSha256 = null) {
    if (!file) {
      return {
        kind: 'none',
        name: null,
        size: null,
        lastModified: null,
        type: null,
        sha256: null
      };
    }
    return {
      kind,
      name: file.name || null,
      size: Number.isFinite(file.size) ? file.size : null,
      lastModified: Number.isFinite(file.lastModified) ? file.lastModified : null,
      type: file.type || null,
      sha256: knownSha256 || await sha256File(file)
    };
  }

  function generatedSourceReference(scene) {
    return {
      kind: 'lidar',
      name: scene?.name || 'generated.obj',
      size: null,
      lastModified: null,
      type: 'text/plain',
      sha256: scene?.sha256 || null,
      generator: scene?.generator || null
    };
  }

  function serverSceneReference(scene) {
    if (!scene?.loaded) return null;
    return {
      kind: 'lidar',
      name: scene.name || '3D model',
      size: null,
      lastModified: null,
      type: null,
      sha256: scene.sha256 || null,
      generator: scene.generator || null
    };
  }

  function readGeometrySpec() {
    return LineArtGeometryBuilder.buildSpec({
      type: geometryType.value,
      radius: geometryRadius.value,
      width: geometryWidth.value,
      height: geometryHeight.value,
      depth: geometryDepth.value,
      segments: geometrySegments.value,
      rings: geometryRings.value,
      profile: geometryProfile.value,
      pattern: geometryPattern.value,
      amplitude: geometryAmplitude.value,
      frequency: geometryFrequency.value,
      grid: geometryGrid.value
    });
  }

  function syncGeometryBuilderFields() {
    const type = geometryType.value;
    document.querySelectorAll('[data-geometry-types]').forEach(group => {
      const types = String(group.dataset.geometryTypes || '').split(/\s+/).filter(Boolean);
      group.hidden = !types.includes(type);
    });
    const ringsField = geometryRings.closest('.control-field');
    if (ringsField) ringsField.hidden = type !== 'sphere';
    generateGeometryBtn.textContent = modelLoading ? 'Creating…' : 'Create Geometry';
  }

  function currentSourceReference() {
    if (requiredSourceReference) return requiredSourceReference;
    if (sourceReference) return sourceReference;
    if (modelReference && sceneLoaded && !sourceImage) return modelReference;
    if (sourceKind === 'none' && restoredSourceHint) return restoredSourceHint;
    return { kind: sourceKind, name: sourceName };
  }

  function projectSourceReady() {
    if (!requiredSourceReference || requiredSourceReference.kind === 'none') return true;
    if (!sourceReference || sourceKind !== requiredSourceReference.kind) return false;
    return LineArtProjectState.sourceMatches(requiredSourceReference, sourceReference);
  }

  function projectModelReady() {
    if (!requiredSourceReference || requiredSourceReference.kind !== 'lidar') return true;
    return !!modelReference &&
      LineArtProjectState.sourceMatches(requiredSourceReference, modelReference);
  }

  function captureProjectState() {
    return LineArtProjectState.create(
      settings,
      currentSourceReference(),
      { pngScale: pngScaleSelect?.value || DEFAULT_EXPORT_SETTINGS.pngScale }
    );
  }

  function scanSettingsSignature(value = settings) {
    const s = value.lidar;
    return JSON.stringify([
      s.scanResolution,
      s.raysPerPixel,
      s.smartSampling,
      canonicalYaw(s.cameraYaw),
      canonicalSensorFloat(s.cameraElevation),
      canonicalSensorFloat(s.cameraDistance),
      canonicalSensorFloat(s.cameraFov),
      42
    ]);
  }

  function scanMetadataSignature(scan) {
    return JSON.stringify([
      `${scan.width}x${scan.height}`,
      scan.rays_per_pixel,
      !!scan.smart_sampling,
      canonicalYaw(scan.camera?.yaw_deg),
      canonicalSensorFloat(scan.camera?.elevation_deg),
      canonicalSensorFloat(scan.camera?.distance_scale),
      canonicalSensorFloat(scan.camera?.fov_deg),
      Number(scan.seed ?? 42),
      scan.scene?.sha256 || scan.scene?.name || null
    ]);
  }

  function multiViewSettingsSignature(value = settings) {
    const s = value.lidar;
    return JSON.stringify([
      s.scanResolution,
      s.raysPerPixel,
      s.smartSampling,
      canonicalSensorFloat(s.cameraDistance),
      canonicalSensorFloat(s.cameraFov),
      42
    ]);
  }

  function multiViewMetadataSignature(multiview) {
    const order = multiview?.order || LineArtMultiView.VIEW_ORDER;
    const scan = multiview?.views?.[order[0]];
    if (!scan) return null;
    return JSON.stringify([
      `${scan.width}x${scan.height}`,
      scan.rays_per_pixel,
      !!scan.smart_sampling,
      canonicalSensorFloat(scan.camera?.distance_scale),
      canonicalSensorFloat(scan.camera?.fov_deg),
      Number(scan.seed ?? 42),
      scan.scene?.sha256 || scan.scene?.name || null
    ]);
  }

  function installedModelMatchesCurrent() {
    if (sourceKind !== 'lidar' || !sourceReference || !modelReference) return true;
    return LineArtProjectState.sourceMatches(sourceReference, modelReference);
  }

  function rememberInstalledScan(scan) {
    installedScanMode = 'single';
    installedScanSignature = scanMetadataSignature(scan);
    installedScanId = scan.scan_id || null;
    installedScanMetadata = scan ? { ...scan } : null;
    installedMultiViewSignature = null;
    multiViewBundle = null;
    updateMultiViewSummary();
    installedScanLabel = `${scan.width}×${scan.height}${scan.smart_sampling ? ' · smart' : ''}`;
    installedScanCacheHit = !!scan.cache_hit;
    return updateScanFreshness();
  }

  function rememberInstalledMultiView(multiview) {
    installedScanMode = 'multi';
    installedScanMetadata = null;
    installedMultiViewSignature = multiViewMetadataSignature(multiview);
    const order = multiview?.order || [];
    const scans = order.map(name => multiview.views?.[name]).filter(Boolean);
    const first = scans[0];
    installedScanLabel = first
      ? `${scans.length} views · ${first.width}×${first.height}${first.smart_sampling ? ' · smart' : ''}`
      : '5 views';
    installedScanCacheHit = scans.length > 0 && scans.every(scan => !!scan.cache_hit);
    return updateScanFreshness();
  }

  function clearInstalledScan() {
    installedScanSignature = null;
    installedScanId = null;
    installedScanMetadata = null;
    installedScanLabel = null;
    installedScanCacheHit = false;
    installedScanMode = 'single';
    installedMultiViewSignature = null;
    multiViewBundle = null;
    scanDirty = false;
  }

  function updateScanFreshness() {
    if (sourceKind !== 'lidar') {
      scanDirty = false;
      if (sceneLoaded) {
        scanSummary.textContent = 'Scan stale · ready to scan';
        scanBtn.textContent = 'Scan LiDAR';
        scanMultiBtn.textContent = 'Scan 5 Views';
      }
      return scanDirty;
    }

    const modelMatch = installedModelMatchesCurrent();

    if (installedScanMode === 'multi' && installedMultiViewSignature) {
      const parsedInstalled = JSON.parse(installedMultiViewSignature);
      const installedSensor = JSON.stringify(parsedInstalled.slice(0, 6));
      const currentSensor = multiViewSettingsSignature(settings);
      scanDirty = installedSensor !== currentSensor || !modelMatch;

      if (scanDirty) {
        scanSummary.textContent = `Scan stale · ${installedScanLabel || '5 views'}`;
      } else {
        const modeLabel = settings.lidar.multiViewMode === 'combined'
          ? 'Combined'
          : multiViewViewLabel(settings.lidar.multiViewCurrent || 'front');
        scanSummary.textContent = installedScanCacheHit
          ? `Scan cached · ${installedScanLabel} · ${modeLabel}`
          : `Scan ready · ${installedScanLabel} · ${modeLabel}`;
      }
      scanBtn.textContent = 'Scan LiDAR';
      scanMultiBtn.textContent = 'Rescan 5 Views';
      return scanDirty;
    }

    if (!installedScanSignature) {
      scanDirty = !!sourceImage;
      scanSummary.textContent = sceneLoaded
        ? 'Scan stale · ready to scan'
        : 'No LiDAR scene';
      scanBtn.textContent = 'Scan LiDAR';
      scanMultiBtn.textContent = 'Scan 5 Views';
      return scanDirty;
    }

    const parsedInstalled = JSON.parse(installedScanSignature);
    const installedSensor = JSON.stringify(parsedInstalled.slice(0, 8));
    const currentSensor = scanSettingsSignature(settings);
    const sensorMatch = installedSensor === currentSensor;

    scanDirty = !sensorMatch || !modelMatch;
    if (scanDirty) {
      scanSummary.textContent = `Scan stale · ${installedScanLabel || 'scan'}`;
    } else if (installedScanCacheHit) {
      scanSummary.textContent = `Scan cached · ${installedScanLabel || 'scan'}`;
    } else {
      scanSummary.textContent = `Scan ready · ${installedScanLabel || 'scan'}`;
    }
    scanBtn.textContent = 'Rescan LiDAR';
    scanMultiBtn.textContent = multiViewBundle ? 'Use / Rescan 5 Views' : 'Scan 5 Views';
    return scanDirty;
  }

  function normalizeRestoredSettings(next) {
    next.lineCount = clamp(Math.round(Number(next.lineCount) / 1000) * 1000, 1000, 400000);
    next.seed = normalizeSeed(next.seed);
    next.mode = next.mode === 'black' ? 'black' : 'color';
    next.inkSpace = next.inkSpace === '3d' ? '3d' : '2d';

    const palettes = new Set(['original', 'muted', 'warm', 'cool', 'monochrome', 'limited']);
    if (!palettes.has(next.palette)) next.palette = DEFAULT_SETTINGS.palette;

    for (const def of sliderDefs) {
      next[def.key] = clamp(Number(next[def.key]), Number(def.min), Number(def.max));
    }

    next.procedural.scale = clamp(Number(next.procedural.scale), 20, 320);
    next.procedural.turbulence = clamp(Number(next.procedural.turbulence), 0, 1);
    next.procedural.octaves = clamp(Math.round(Number(next.procedural.octaves)), 1, 7);

    for (const def of mixerDefs) {
      next.flowMixer[def.key] = clamp(
        Number(next.flowMixer[def.key]),
        Number(def.min ?? 0),
        Number(def.max ?? 1)
      );
    }

    const resolutions = new Set(['160x120', '320x240', '480x360', '640x480']);
    if (!resolutions.has(next.lidar.scanResolution)) next.lidar.scanResolution = '320x240';
    next.lidar.raysPerPixel = [1, 2, 4].includes(Number(next.lidar.raysPerPixel))
      ? Number(next.lidar.raysPerPixel)
      : 2;
    next.lidar.smartSampling = !!next.lidar.smartSampling;
    next.lidar.cameraYaw = clamp(Number(next.lidar.cameraYaw), 0, 360);
    next.lidar.cameraElevation = clamp(Number(next.lidar.cameraElevation), 5, 80);
    next.lidar.cameraDistance = clamp(Number(next.lidar.cameraDistance), 1.4, 6);
    next.lidar.cameraFov = clamp(Number(next.lidar.cameraFov), 25, 90);

    const densitySources = new Set(['tone', 'geometryEdge', 'depthChange', 'confidence']);
    if (!densitySources.has(next.lidar.densitySource)) next.lidar.densitySource = 'tone';
    const directionSources = new Set(['imageStructure', 'depthTangent', 'mixed']);
    if (!directionSources.has(next.lidar.directionSource)) next.lidar.directionSource = 'mixed';
    next.lidar.geometryEdgeStrength = clamp(Number(next.lidar.geometryEdgeStrength), 0, 2);
    next.lidar.depthInfluence = clamp(Number(next.lidar.depthInfluence), 0, 1);
    next.lidar.depthContourStrength = clamp(Number(next.lidar.depthContourStrength), 0, 1);
    next.lidar.confidenceSmoothing = clamp(Number(next.lidar.confidenceSmoothing), 0, 1);
    next.lidar.useFusedConfidence = !!next.lidar.useFusedConfidence;
    next.lidar.confidenceLength = clamp(Number(next.lidar.confidenceLength), 0, 1);
    next.lidar.confidenceOpacity = clamp(Number(next.lidar.confidenceOpacity), 0, 1);
    next.lidar.confidenceFragmentation = clamp(Number(next.lidar.confidenceFragmentation), 0, 1);
    next.lidar.cleanBackground = !!next.lidar.cleanBackground;
    next.lidar.objectCenteredFields = !!next.lidar.objectCenteredFields;
    next.lidar.multiViewMode = next.lidar.multiViewMode === 'combined'
      ? 'combined'
      : 'current';
    if (!safeMultiViewName(next.lidar.multiViewCurrent)) {
      next.lidar.multiViewCurrent = 'front';
    }
    next.lidar.multiViewDebugColors = !!next.lidar.multiViewDebugColors;

    if (next.preset !== 'custom' && !presets[next.preset]) next.preset = 'custom';
    return next;
  }

  function renderHistoryStatus(status) {
    historyUiLocked = !!historyUiLocked;
    undoBtn.disabled = historyUiLocked || !status.canUndo;
    redoBtn.disabled = historyUiLocked || !status.canRedo;

    autosaveStatus.dataset.state = status.autosaveState;
    if (status.autosaveState === 'pending') {
      autosaveStatus.textContent = 'Saving...';
      historyHelp.textContent = 'Settings autosave locally after edits.';
    } else if (status.autosaveState === 'saved') {
      autosaveStatus.textContent = 'Autosaved';
      historyHelp.textContent = status.lastSavedAt
        ? `Last local save ${new Date(status.lastSavedAt).toLocaleTimeString()}`
        : 'Settings restored from local autosave.';
    } else if (status.autosaveState === 'error') {
      autosaveStatus.textContent = 'Autosave unavailable';
      historyHelp.textContent = status.lastError || 'Local browser storage could not be used.';
    } else {
      autosaveStatus.textContent = 'Autosave ready';
      historyHelp.textContent = 'Settings autosave locally after edits.';
    }
  }

  const history = LineArtHistory.createHistory({
    storageKey: AUTOSAVE_KEY,
    limit: 80,
    autosaveDelayMs: 250,
    coalesceWindowMs: 550,
    onStatus: renderHistoryStatus
  });

  function recordSettingsChange(coalesceKey = null) {
    if (!historyReady || historyApplying) return;
    history.record(captureProjectState(), { coalesceKey });
  }

  function autosaveCurrentState() {
    if (!historyReady || historyApplying) return;
    history.replaceCurrent(captureProjectState(), { autosave: true });
  }

  function applyProjectSnapshot(snapshot, { preview = true } = {}) {
    const restored = LineArtProjectState.restore(
      snapshot,
      DEFAULT_SETTINGS,
      DEFAULT_EXPORT_SETTINGS
    );
    if (!restored) return false;

    historyApplying = true;
    try {
      Object.assign(settings, normalizeRestoredSettings(restored.settings));
      pngScaleSelect.value = restored.export.pngScale;
      syncUI();

      if (projectSourceReady() && sourceKind === 'lidar' && lidarSourceMaps) {
        if (installedScanMode === 'multi' && multiViewBundle) {
          activateMultiViewSource({ preview: false });
        } else {
          const maps = composeCurrentLidarMaps();
          applyRendererMaps(maps);
        }
      }

      updateScanFreshness();

      if (highQualityStrokeStore) highQualityStale = true;
      updateExportNote();
    } finally {
      historyApplying = false;
    }

    if (
      preview &&
      sourceImage &&
      projectSourceReady() &&
      !(sourceKind === 'lidar' && scanDirty)
    ) schedulePreview();
    refreshButtons();
    return true;
  }

  function undoSettings() {
    const snapshot = history.undo();
    if (!snapshot) return;
    if (activeRender) stopRender(false);
    applyProjectSnapshot(snapshot);
  }

  function redoSettings() {
    const snapshot = history.redo();
    if (!snapshot) return;
    if (activeRender) stopRender(false);
    applyProjectSnapshot(snapshot);
  }

  function setProjectStatus(message, warning = false) {
    projectStatus.textContent = message;
    projectStatus.classList.toggle('warning', !!warning);
  }

  function requiredSourceLabel(reference = requiredSourceReference) {
    if (!reference || reference.kind === 'none') return 'source';
    const kind = reference.kind === 'lidar' ? '3D model' : 'image';
    return reference.name ? `${kind} "${reference.name}"` : kind;
  }

  function saveProjectFile() {
    const snapshot = captureProjectState();
    const documentState = {
      ...snapshot,
      meta: {
        appVersion: BUILD_VERSION,
        savedAt: new Date().toISOString()
      }
    };
    const json = LineArtProjectState.serialize(documentState, { pretty: true });
    const blob = new Blob([json + '\n'], { type: 'application/json;charset=utf-8' });

    if (projectDownloadUrl) URL.revokeObjectURL(projectDownloadUrl);
    projectDownloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const filename = LineArtProjectState.projectFileName(snapshot.source);
    anchor.href = projectDownloadUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setProjectStatus(`Saved ${filename}`);
  }

  async function openProjectFile(file) {
    if (!file) return;
    projectFileInput.value = '';

    if (file.size > PROJECT_FILE_MAX_BYTES) {
      setProjectStatus('Project file is too large. Expected a settings-only JSON file under 1 MB.', true);
      return;
    }

    let restored;
    try {
      const text = await file.text();
      restored = LineArtProjectState.deserialize(
        text,
        DEFAULT_SETTINGS,
        DEFAULT_EXPORT_SETTINGS
      );
    } catch (_) {
      restored = null;
    }

    if (!restored) {
      setProjectStatus('Could not open that project: unsupported or invalid LiDAR Ink project JSON.', true);
      return;
    }

    if (activeRender) stopRender(false);
    ++loadSerial;
    clearTimeout(previewTimer);
    previewTimer = 0;

    historyApplying = true;
    try {
      Object.assign(settings, normalizeRestoredSettings(restored.settings));
      pngScaleSelect.value = restored.export.pngScale;
      restoredSourceHint = restored.source;
      requiredSourceReference = restored.source.kind === 'none' ? null : restored.source;
      syncUI();

      if (projectSourceReady() && sourceKind === 'lidar' && lidarSourceMaps) {
        const maps = composeCurrentLidarMaps();
        applyRendererMaps(maps);
      }

      updateScanFreshness();

      if (highQualityStrokeStore) highQualityStale = true;
      updateExportNote();
    } finally {
      historyApplying = false;
    }

    history.initialize(captureProjectState());
    historyReady = true;
    history.saveNow(captureProjectState());

    if (projectSourceReady()) {
      if (sourceKind === 'lidar' && scanDirty) {
        setProjectStatus(
          `Opened ${file.name}. Source matches, but the installed LiDAR scan is stale. Rescan LiDAR.`,
          true
        );
        setStatus('Project opened. Rescan LiDAR to match the saved sensor settings.', 0);
      } else {
        setProjectStatus(`Opened ${file.name}. Source reference is satisfied.`);
        setStatus('Project opened. Rebuilding preview from the referenced source.', 0);
        if (sourceImage) schedulePreview();
      }
    } else if (restored.source.kind === 'lidar') {
      setProjectStatus(
        `Opened ${file.name}. Load ${requiredSourceLabel(restored.source)} to reproduce the project.`,
        true
      );
      setStatus(`Project settings loaded. Waiting for ${requiredSourceLabel(restored.source)}.`, 0);
      await restoreServerScene();
      if (projectSourceReady()) {
        setProjectStatus(`Opened ${file.name}. Referenced LiDAR source restored from the local server.`);
      }
    } else if (restored.source.kind === 'image') {
      setProjectStatus(
        `Opened ${file.name}. Reselect ${requiredSourceLabel(restored.source)} to reproduce the project.`,
        true
      );
      setStatus(`Project settings loaded. Waiting for ${requiredSourceLabel(restored.source)}.`, 0);
    } else {
      setProjectStatus(`Opened ${file.name}. No source is referenced.`);
      setStatus('Project settings loaded.', 0);
    }

    refreshButtons();
  }


  const scanControlEls = [
    scanResolution, raysPerPixel, smartSampling,
    cameraYaw, cameraElevation, cameraDistance, cameraFov
  ];
  const lidarArtControlEls = [
    densitySource,
    directionSource,
    geometryEdgeStrength,
    depthInfluence,
    depthContourStrength,
    confidenceSmoothing,
    useFusedConfidence,
    confidenceLength,
    confidenceOpacity,
    confidenceFragmentation,
    cleanBackground,
    objectCenteredFields
  ];

  function syncLidarControls() {
    const s = settings.lidar;
    scanResolution.value = s.scanResolution;
    raysPerPixel.value = String(s.raysPerPixel);
    smartSampling.checked = !!s.smartSampling;
    cameraYaw.value = s.cameraYaw;
    cameraElevation.value = s.cameraElevation;
    cameraDistance.value = s.cameraDistance;
    cameraFov.value = s.cameraFov;
    densitySource.value = s.densitySource;
    directionSource.value = s.directionSource;
    geometryEdgeStrength.value = s.geometryEdgeStrength;
    depthInfluence.value = s.depthInfluence;
    depthContourStrength.value = s.depthContourStrength;
    confidenceSmoothing.value = s.confidenceSmoothing;
    useFusedConfidence.checked = !!s.useFusedConfidence;
    confidenceLength.value = s.confidenceLength;
    confidenceOpacity.value = s.confidenceOpacity;
    confidenceFragmentation.value = s.confidenceFragmentation;
    cleanBackground.checked = !!s.cleanBackground;
    objectCenteredFields.checked = !!s.objectCenteredFields;
    multiViewMode.value = s.multiViewMode;
    multiViewCurrent.value = s.multiViewCurrent;
    multiViewDebugColors.checked = !!s.multiViewDebugColors;
    cameraYawValue.textContent = `${Math.round(s.cameraYaw)}°`;
    cameraElevationValue.textContent = `${Math.round(s.cameraElevation)}°`;
    cameraDistanceValue.textContent = `${Number(s.cameraDistance).toFixed(1)}×`;
    cameraFovValue.textContent = `${Math.round(s.cameraFov)}°`;
    geometryEdgeStrengthValue.textContent = `${Math.round(s.geometryEdgeStrength * 100)}%`;
    depthInfluenceValue.textContent = `${Math.round(s.depthInfluence * 100)}%`;
    depthContourStrengthValue.textContent = `${Math.round(s.depthContourStrength * 100)}%`;
    confidenceSmoothingValue.textContent = `${Math.round(s.confidenceSmoothing * 100)}%`;
    confidenceLengthValue.textContent = `${Math.round(s.confidenceLength * 100)}%`;
    confidenceOpacityValue.textContent = `${Math.round(s.confidenceOpacity * 100)}%`;
    confidenceFragmentationValue.textContent = `${Math.round(s.confidenceFragmentation * 100)}%`;
  }

  function syncProceduralControls() {
    const p = settings.procedural;
    flowScale.value = p.scale;
    flowTurbulence.value = p.turbulence;
    flowOctaves.value = p.octaves;
    flowScaleValue.textContent = `${Math.round(p.scale)} px`;
    flowTurbulenceValue.textContent = `${Math.round(p.turbulence * 100)}%`;
    flowOctavesValue.textContent = String(p.octaves);
  }

  function syncFlowMixerControls() {
    for (const def of mixerDefs) {
      const control = mixerControls[def.key];
      const value = settings.flowMixer[def.key];
      control.input.value = value;
      control.value.textContent = `${Math.round(value * 100)}%`;
    }
  }

  function readScanControls() {
    const [width, height] = settings.lidar.scanResolution.split('x').map(Number);
    return {
      width,
      height,
      rays_per_pixel: settings.lidar.raysPerPixel,
      smart_sampling: settings.lidar.smartSampling,
      yaw_deg: settings.lidar.cameraYaw,
      elevation_deg: settings.lidar.cameraElevation,
      distance_scale: settings.lidar.cameraDistance,
      fov_deg: settings.lidar.cameraFov,
      seed: 42
    };
  }

  function applyRendererMaps(maps) {
    luminance = maps.luminance;
    edgeStrength = maps.edgeStrength;
    colorInkNeed = maps.colorInkNeed;
    strokeDirection = maps.strokeDirection;
    directionCoherence = maps.directionCoherence;
    renderer.setSource({
      sourceImage,
      sourcePixels,
      luminance,
      edgeStrength,
      colorInkNeed,
      strokeDirection,
      directionCoherence,
      depthDirection: maps.depthDirection || null,
      depthCoherence: maps.depthCoherence || null,
      depthChange: maps.depthChange || null,
      confidence: maps.confidence || null,
      strokeMask: maps.strokeMask || null,
      eligibleIndices: maps.eligibleIndices || null,
      fieldCenter: maps.fieldCenter || null,
      debugColorMap: maps.debugColorMap || null
    });
  }

  function lidarArtOptions() {
    return {
      densitySource: settings.lidar.densitySource,
      directionSource: settings.lidar.directionSource,
      geometryEdgeStrength: settings.lidar.geometryEdgeStrength,
      depthInfluence: settings.lidar.depthInfluence,
      depthContourStrength: settings.lidar.depthContourStrength,
      confidenceSmoothing: settings.lidar.confidenceSmoothing,
      cleanBackground: settings.lidar.cleanBackground,
      objectCenteredFields: settings.lidar.objectCenteredFields
    };
  }

  function composeOneLidarView(sourceMaps, fusedConfidence = null) {
    const source = settings.lidar.useFusedConfidence && fusedConfidence
      ? LineArtAnalysis.withConfidence(sourceMaps, fusedConfidence)
      : sourceMaps;
    return LineArtAnalysis.composeLidarAnalysisMaps(source, lidarArtOptions());
  }

  function composeCurrentLidarMaps() {
    if (
      installedScanMode === 'multi' &&
      multiViewBundle &&
      multiViewBundle.order.length
    ) {
      const currentName = resolveMultiViewCurrent();
      const current = multiViewBundle.views[currentName];
      if (!current) return null;

      if (settings.lidar.multiViewMode === 'combined') {
        const entries = multiViewBundle.order
          .map(name => multiViewBundle.views[name])
          .filter(Boolean)
          .map(view => ({
            name: view.name,
            maps: composeOneLidarView(view.sourceMaps, view.fusedConfidence)
          }));
        return LineArtMultiView.combineComposedViews(
          entries,
          multiViewBundle.width,
          multiViewBundle.height,
          { debugColors: settings.lidar.multiViewDebugColors }
        );
      }

      const maps = composeOneLidarView(current.sourceMaps, current.fusedConfidence);
      if (!settings.lidar.multiViewDebugColors) return maps;
      return {
        ...maps,
        debugColorMap: LineArtMultiView.debugColorMapForView(
          current.name,
          multiViewBundle.width * multiViewBundle.height
        )
      };
    }

    if (!lidarSourceMaps) return null;
    return composeOneLidarView(lidarSourceMaps);
  }

  function canvasFromPixels(pixels, width, height) {
    const nextCanvas = document.createElement('canvas');
    nextCanvas.width = width;
    nextCanvas.height = height;
    const nextCtx = nextCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: false
    });
    nextCtx.putImageData(pixels, 0, 0);
    return nextCanvas;
  }

  function multiViewViewLabel(name) {
    return multiViewBundle?.views?.[name]?.scan?.view?.label ||
      String(name || 'view').replace(/^./, letter => letter.toUpperCase());
  }

  function resolveMultiViewCurrent() {
    if (!multiViewBundle?.order?.length) return settings.lidar.multiViewCurrent;
    const requested = settings.lidar.multiViewCurrent;
    const resolved = multiViewBundle.order.includes(requested)
      ? requested
      : multiViewBundle.order[0];
    if (resolved !== requested) {
      settings.lidar.multiViewCurrent = resolved;
    }
    if (multiViewCurrent.value !== resolved) {
      multiViewCurrent.value = resolved;
    }
    return resolved;
  }

  function updateMultiViewSummary() {
    if (!multiViewBundle) {
      multiViewSummary.textContent = 'No multi-view scan loaded.';
      return;
    }
    const statuses = multiViewBundle.order.map(name => {
      const view = multiViewBundle.views[name];
      const label = multiViewViewLabel(name);
      return `${label} ${view?.scan?.cache_hit ? 'cached' : 'ready'}`;
    });
    const currentName = resolveMultiViewCurrent();
    const mode = settings.lidar.multiViewMode === 'combined'
      ? 'Combined'
      : `Current: ${multiViewViewLabel(currentName)}`;
    multiViewSummary.textContent = `${mode} · ${statuses.join(' · ')}`;
  }

  function activateMultiViewSource({
    historyKey = null,
    install = false,
    preview = true
  } = {}) {
    if (!multiViewBundle) return false;
    const currentName = resolveMultiViewCurrent();
    const current = multiViewBundle.views[currentName];
    if (!current) return false;

    rememberInstalledMultiView(multiViewBundle.metadata);
    lidarSourceMaps = current.sourceMaps;

    const pixels = settings.lidar.multiViewMode === 'combined'
      ? multiViewBundle.combinedPixels
      : current.pixels;
    const nextCanvas = canvasFromPixels(
      pixels,
      multiViewBundle.width,
      multiViewBundle.height
    );
    const maps = composeCurrentLidarMaps();
    const label = settings.lidar.multiViewMode === 'combined'
      ? `Combined ${multiViewBundle.order.length}-view LiDAR`
      : `${current.scan.view?.label || current.name} LiDAR view`;

    if (install || sourceKind !== 'lidar' || !sourceImage) {
      installSource(
        nextCanvas,
        pixels,
        maps,
        multiViewBundle.width,
        multiViewBundle.height,
        `${label} ready - ${multiViewBundle.width} x ${multiViewBundle.height}px. Building preview...`,
        'lidar',
        modelReference || {
          kind: 'lidar',
          name: current.scan.scene?.name || '3D model',
          sha256: current.scan.scene?.sha256 || null
        }
      );
    } else {
      if (sourceCanvas && sourceCanvas !== nextCanvas) {
        sourceCanvas.width = 0;
        sourceCanvas.height = 0;
      }
      sourceCanvas = nextCanvas;
      sourcePixels = pixels;
      sourceImage = {
        width: multiViewBundle.width,
        height: multiViewBundle.height
      };
      applyRendererMaps(maps);
      displayStrokeStore = null;
      displayRenderMeta = null;
      highQualityStrokeStore = null;
      highQualityRenderMeta = null;
      highQualityStale = false;
      resetInk3D('3D Ink waiting for the current view preview.');
      updateScanFreshness();
      updateLidarArtControlAvailability(false);
      refreshButtons();
      autosaveCurrentState();
      setStatus(
        `${label} ready - ${multiViewBundle.width} x ${multiViewBundle.height}px.`,
        0
      );
      if (preview && !scanDirty) schedulePreview();
    }

    updateMultiViewSummary();
    if (historyKey) recordSettingsChange(historyKey);
    return true;
  }

  function recomposeLidarSource({
    preview = true,
    markPreset = true,
    historyKey = null
  } = {}) {
    if (sourceKind !== 'lidar' || !lidarSourceMaps || !sourceImage) return;
    const maps = composeCurrentLidarMaps();
    applyRendererMaps(maps);
    markSettingsChanged(markPreset, historyKey);
    if (preview) schedulePreview();
  }

  function markScanControlsChanged(historyKey = null) {
    resetInk3D('3D Ink is stale because the sensor settings changed.');
    if ((installedScanSignature || installedMultiViewSignature) && sourceKind === 'lidar') {
      updateScanFreshness();
    } else {
      scanDirty = !!sceneLoaded;
      scanSummary.textContent = sceneLoaded ? 'Scan stale · no current scan' : 'No LiDAR scene';
      scanBtn.textContent = 'Scan LiDAR';
    }
    recordSettingsChange(historyKey);
    refreshButtons();
  }

  function updateLidarArtControlAvailability(locked = false) {
    const available = sourceKind === 'lidar' && !!lidarSourceMaps && !locked;
    lidarArtControlEls.forEach(el => { el.disabled = !available; });
    const fusionAvailable = available && !!multiViewBundle?.fusion;
    useFusedConfidence.disabled = !fusionAvailable;
    confidenceLength.disabled = !available;
    confidenceOpacity.disabled = !available;
    confidenceFragmentation.disabled = !available;
  }

  function syncInkSpaceButtons() {
    for (const button of inkSpaceControl.querySelectorAll('button[data-space]')) {
      const active = button.dataset.space === settings.inkSpace;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function currentInk3DScanId() {
    if (
      sourceKind !== 'lidar' ||
      scanDirty ||
      !sceneLoaded ||
      !projectModelReady()
    ) {
      return null;
    }
    if (multiViewBundle?.order?.length) {
      if (settings.lidar.multiViewMode === 'combined') return null;
      const view = multiViewBundle.views?.[resolveMultiViewCurrent()];
      return view?.scan?.scan_id || null;
    }
    return installedScanId || installedScanMetadata?.scan_id || null;
  }

  function resetInk3D(message = null) {
    ink3dSerial++;
    ink3dLoading = false;
    ink3dDirty = true;
    ink3dSnapshot = null;
    inspectionViewer?.setInkSnapshot(null);
    if (message) ink3dStatus.textContent = message;
  }

  function markInk3DDirty(message = '3D Ink is stale; rebuild after the 2D preview finishes.') {
    ink3dDirty = true;
    if (ink3dSnapshot) ink3dStatus.textContent = message;
  }

  function canBuildInk3D() {
    return (
      sourceKind === 'lidar' &&
      !!sourceImage &&
      !!displayStrokeStore &&
      !!displayRenderMeta &&
      !!currentInk3DScanId() &&
      settings.lidar.multiViewMode !== 'combined' &&
      !loadingImage &&
      !modelLoading &&
      !scanRunning &&
      !activeRender &&
      !ink3dLoading
    );
  }

  async function buildCurrentInk3D({ force = false } = {}) {
    const scanId = currentInk3DScanId();
    if (settings.lidar.multiViewMode === 'combined' && multiViewBundle) {
      ink3dStatus.textContent = '3D Ink needs a single Current View; Combined Views remains a 2D compositor.';
      return null;
    }
    if (!scanId) {
      ink3dStatus.textContent = scanDirty
        ? '3D Ink is unavailable while the LiDAR scan is stale.'
        : 'Run LiDAR and select a current view before building 3D Ink.';
      return null;
    }
    if (!displayStrokeStore || !displayRenderMeta) {
      ink3dStatus.textContent = 'Finish a 2D preview before building 3D Ink.';
      return null;
    }
    if (
      !force &&
      !ink3dDirty &&
      ink3dSnapshot?.scan_id === scanId
    ) {
      ensureInspectionViewer().setInkSnapshot(ink3dSnapshot);
      return ink3dSnapshot;
    }

    const serial = ++ink3dSerial;
    ink3dLoading = true;
    buildInk3DBtn.textContent = 'Building 3D Ink…';
    ink3dStatus.textContent = 'Projecting deterministic 2D strokes onto the real mesh…';
    refreshButtons();

    try {
      const payload = LineArtInk3D.buildProjectionPayload(
        displayStrokeStore,
        displayRenderMeta,
        scanId
      );
      const response = await LidarClient.projectInk3D(payload);
      if (serial !== ink3dSerial) return null;
      const snapshot = LineArtInk3D.validateSnapshot(response.ink3d);
      if (snapshot.scan_id !== scanId) {
        throw new Error('3D Ink response does not match the selected scan.');
      }

      ink3dSnapshot = snapshot;
      ink3dDirty = false;
      inspectionShowInk.checked = true;
      const viewer = ensureInspectionViewer();
      viewer.setInkSnapshot(snapshot);
      viewer.setLayers(inspectionLayerState());
      ink3dStatus.textContent =
        `3D Ink ready · ${formatCount(snapshot.stroke_count)} surface strokes · ` +
        `${formatCount(snapshot.point_count)} world points · ` +
        `${formatCount(snapshot.miss_count)} projected samples missed the mesh.`;
      updateInspectionHud(inspectionSceneCache, inspectionScanCache.get(scanId) || null);
      return snapshot;
    } catch (error) {
      if (serial !== ink3dSerial) return null;
      console.error(error);
      ink3dStatus.textContent = `3D Ink failed: ${error.message}`;
      throw error;
    } finally {
      if (serial === ink3dSerial) {
        ink3dLoading = false;
        buildInk3DBtn.textContent = ink3dSnapshot ? 'Refresh 3D Ink' : 'Build 3D Ink';
        refreshButtons();
      }
    }
  }

  async function setInkSpace(space) {
    const next = space === '3d' ? '3d' : '2d';
    if (next === '3d') {
      if (sourceKind !== 'lidar' || !sourceImage) {
        ink3dStatus.textContent = '3D Ink is available for a completed LiDAR source.';
        return false;
      }
      if (settings.lidar.multiViewMode === 'combined' && multiViewBundle) {
        ink3dStatus.textContent = 'Choose Current View before entering 3D Ink; Combined Views is 2D only.';
        return false;
      }
      if (!currentInk3DScanId() || scanDirty) {
        ink3dStatus.textContent = 'Run or refresh LiDAR before entering 3D Ink.';
        return false;
      }
      if (!displayStrokeStore || activeRender) {
        ink3dStatus.textContent = 'Finish the current 2D preview before entering 3D Ink.';
        return false;
      }

      settings.inkSpace = '3d';
      syncInkSpaceButtons();
      recordSettingsChange('inkSpace');
      await setInspectionOpen(true);
      if (!inspectionOpen) return false;
      await buildCurrentInk3D();
      return true;
    }

    settings.inkSpace = '2d';
    syncInkSpaceButtons();
    recordSettingsChange('inkSpace');
    if (inspectionOpen) await setInspectionOpen(false);
    else {
      canvasShell.hidden = !sourceImage;
      emptyState.hidden = !!sourceImage;
      inspectionShell.hidden = true;
    }
    refreshButtons();
    return true;
  }

  function inspectionEntries() {
    if (multiViewBundle?.order?.length) {
      return multiViewBundle.order
        .map(name => {
          const view = multiViewBundle.views?.[name];
          if (!view?.scan?.scan_id) return null;
          return {
            name,
            label: multiViewViewLabel(name),
            scan: view.scan
          };
        })
        .filter(Boolean);
    }
    if (installedScanMetadata?.scan_id) {
      return [{
        name: 'single',
        label: 'Current scan',
        scan: installedScanMetadata
      }];
    }
    return [];
  }

  function inspectionCurrentScanId() {
    if (multiViewBundle?.order?.length) {
      const current = multiViewBundle.views?.[resolveMultiViewCurrent()];
      return current?.scan?.scan_id || null;
    }
    return installedScanId || installedScanMetadata?.scan_id || null;
  }

  function inspectionCameraViews() {
    return inspectionEntries().map(entry => ({
      scanId: entry.scan.scan_id,
      name: entry.name,
      label: entry.label,
      position: entry.scan.camera_position,
      target: entry.scan.camera_target,
      fov: entry.scan.camera?.fov_deg,
      width: entry.scan.width,
      height: entry.scan.height
    }));
  }

  function inspectionLayerState() {
    return {
      mesh: inspectionShowMesh.checked,
      points: inspectionShowPoints.checked,
      rays: inspectionShowRays.checked,
      cameras: inspectionShowCameras.checked,
      ink: inspectionShowInk.checked
    };
  }

  function ensureInspectionViewer() {
    if (inspectionViewer) return inspectionViewer;
    if (!window.LineArtInspectionViewer) {
      throw new Error('3D inspection viewer is unavailable.');
    }
    inspectionViewer = LineArtInspectionViewer.createInspectionViewer({
      container: inspectionViewport,
      onSelectScan: scanId => {
        selectInspectionScanById(scanId).catch(error => {
          console.error(error);
          inspectionStatus.textContent = `Could not select scan: ${error.message}`;
        });
      }
    });
    inspectionViewer.setLayers(inspectionLayerState());
    return inspectionViewer;
  }

  function syncInspectionControls() {
    const entries = inspectionEntries();
    const selected = inspectionCurrentScanId();

    inspectionScanSelect.innerHTML = '';
    if (!entries.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No scan yet';
      inspectionScanSelect.appendChild(option);
    } else {
      for (const entry of entries) {
        const option = document.createElement('option');
        option.value = entry.scan.scan_id;
        option.textContent = entry.label;
        inspectionScanSelect.appendChild(option);
      }
      if (entries.some(entry => entry.scan.scan_id === selected)) {
        inspectionScanSelect.value = selected;
      }
    }

    inspectionViewpoints.innerHTML = '';
    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.scanId = entry.scan.scan_id;
      button.textContent = entry.label;
      button.classList.toggle('active', entry.scan.scan_id === selected);
      button.disabled = !inspectionOpen || inspectionLoading;
      button.addEventListener('click', () => {
        selectInspectionScanById(entry.scan.scan_id).catch(error => {
          console.error(error);
          inspectionStatus.textContent = `Could not select scan: ${error.message}`;
        });
      });
      inspectionViewpoints.appendChild(button);
    }

    if (inspectionViewer) {
      inspectionViewer.setCameraViews(inspectionCameraViews(), selected);
      inspectionViewer.setLayers(inspectionLayerState());
    }
  }

  function updateInspectionHud(sceneSnapshot = inspectionSceneCache, scanSnapshot = null) {
    const sceneInfo = sceneSnapshot?.scene;
    const preview = sceneSnapshot?.preview;
    const scanId = scanSnapshot?.scan_id || inspectionCurrentScanId();
    const entry = inspectionEntries().find(item => item.scan.scan_id === scanId);
    inspectionHudTitle.textContent = settings.inkSpace === '3d'
      ? `3D Ink · ${entry?.label || sceneInfo?.name || 'surface'}`
      : (entry
          ? `3D inspection · ${entry.label}`
          : `3D inspection · ${sceneInfo?.name || 'normalized mesh'}`);

    if (scanSnapshot) {
      const inkDetail = ink3dSnapshot
        ? ` · ${ink3dSnapshot.stroke_count} surface strokes / ${ink3dSnapshot.point_count} world points`
        : '';
      inspectionHudDetail.textContent =
        `${preview?.triangle_count || 0} mesh triangles · ` +
        `${scanSnapshot.points?.preview_count || 0}/${scanSnapshot.points?.source_count || 0} hit points · ` +
        `${scanSnapshot.rays?.count || 0} cached hit rays${inkDetail} · drag to orbit, Shift/right-drag to pan, wheel to zoom`;
    } else {
      inspectionHudDetail.textContent =
        `${preview?.triangle_count || 0} preview triangles · run LiDAR to add point cloud and hit rays · drag to orbit`;
    }
  }

  async function loadInspectionScene({ force = false } = {}) {
    const viewer = ensureInspectionViewer();
    const expectedSha = modelReference?.sha256 || null;
    if (
      !force &&
      inspectionSceneCache &&
      (!expectedSha || inspectionSceneSha === expectedSha)
    ) {
      viewer.setSceneSnapshot(inspectionSceneCache);
      syncInspectionControls();
      updateInspectionHud(inspectionSceneCache, null);
      return inspectionSceneCache;
    }

    const serial = ++inspectionSerial;
    inspectionLoading = true;
    refreshButtons();
    inspectionStatus.textContent = 'Loading normalized mesh preview…';
    try {
      const response = await LidarClient.getInspectionScene();
      if (serial !== inspectionSerial) return null;
      const snapshot = response.inspection;
      inspectionSceneCache = snapshot;
      inspectionSceneSha = snapshot?.scene?.sha256 || expectedSha;
      viewer.setSceneSnapshot(snapshot);
      syncInspectionControls();
      inspectionStatus.textContent =
        `Mesh ready · ${formatCount(snapshot.preview?.triangle_count || 0)} of ` +
        `${formatCount(snapshot.preview?.source_triangle_count || 0)} triangles shown.`;
      updateInspectionHud(snapshot, null);
      return snapshot;
    } finally {
      if (serial === inspectionSerial) {
        inspectionLoading = false;
        refreshButtons();
        syncInspectionControls();
      }
    }
  }

  async function loadInspectionScan(scanId) {
    const viewer = ensureInspectionViewer();
    if (!scanId) {
      viewer.setScanSnapshot({
        scan_id: null,
        points: { positions: [], confidence: [] },
        rays: { positions: [] }
      });
      updateInspectionHud(inspectionSceneCache, null);
      return null;
    }

    const serial = ++inspectionSerial;
    inspectionLoading = true;
    refreshButtons();
    syncInspectionControls();
    inspectionStatus.textContent = 'Loading cached hit cloud…';
    try {
      let snapshot = inspectionScanCache.get(scanId);
      if (!snapshot) {
        const response = await LidarClient.getInspectionScan(scanId);
        snapshot = response.inspection;
        inspectionScanCache.set(scanId, snapshot);
      }
      if (serial !== inspectionSerial) return null;

      viewer.setSelectedScan(scanId);
      viewer.setScanSnapshot(snapshot);
      const entry = inspectionEntries().find(item => item.scan.scan_id === scanId);
      inspectionStatus.textContent =
        `${entry?.label || 'Scan'} · ${formatCount(snapshot.points?.preview_count || 0)} points · ` +
        `${formatCount(snapshot.rays?.count || 0)} hit rays.`;
      updateInspectionHud(inspectionSceneCache, snapshot);
      syncInspectionControls();
      return snapshot;
    } finally {
      if (serial === inspectionSerial) {
        inspectionLoading = false;
        refreshButtons();
        syncInspectionControls();
      }
    }
  }

  async function selectInspectionScanById(scanId, { syncArt = true } = {}) {
    if (!scanId) return;
    const entries = inspectionEntries();
    const entry = entries.find(item => item.scan.scan_id === scanId);
    if (!entry) return;

    if (syncArt && multiViewBundle?.order?.includes(entry.name)) {
      settings.lidar.multiViewCurrent = entry.name;
      multiViewCurrent.value = entry.name;
      activateMultiViewSource({ historyKey: 'lidar:multiViewCurrent' });
    }

    inspectionScanSelect.value = scanId;
    inspectionViewer?.setSelectedScan(scanId);
    syncInspectionControls();
    await loadInspectionScan(scanId);
  }

  async function setInspectionOpen(nextOpen) {
    if (nextOpen && !sceneLoaded) return;
    inspectionOpen = !!nextOpen;
    inspectionToggle.textContent = inspectionOpen
      ? 'Close 3D Inspector'
      : 'Open 3D Inspector';

    if (!inspectionOpen) {
      inspectionSerial++;
      inspectionLoading = false;
      if (settings.inkSpace === '3d') {
        settings.inkSpace = '2d';
        syncInkSpaceButtons();
        recordSettingsChange('inkSpace');
      }
      inspectionShell.hidden = true;
      canvasShell.hidden = !sourceImage;
      emptyState.hidden = !!sourceImage;
      refreshButtons();
      syncInspectionControls();
      return;
    }

    stopRender(false);
    inspectionShell.hidden = false;
    canvasShell.hidden = true;
    emptyState.hidden = true;
    ensureInspectionViewer();
    syncInspectionControls();
    refreshButtons();

    try {
      await loadInspectionScene();
      if (!inspectionOpen) return;
      const scanId = inspectionCurrentScanId();
      await loadInspectionScan(scanId);
    } catch (error) {
      console.error(error);
      inspectionStatus.textContent = `3D inspection failed: ${error.message}`;
    }
  }

  function resetInspectionForScene() {
    inspectionSerial++;
    inspectionLoading = false;
    inspectionSceneCache = null;
    inspectionSceneSha = null;
    inspectionScanCache.clear();
    if (inspectionViewer) {
      inspectionViewer.setSceneSnapshot({
        preview: { positions: [], center: [0, 1, 0], radius: 1 }
      });
      inspectionViewer.setScanSnapshot({
        scan_id: null,
        points: { positions: [], confidence: [] },
        rays: { positions: [] }
      });
      inspectionViewer.setCameraViews([], null);
      inspectionViewer.setInkSnapshot(null);
    }
    resetInk3D();
    syncInspectionControls();
  }

  async function refreshInspectionAfterAcquisition() {
    syncInspectionControls();
    if (!inspectionOpen) return;
    const scanId = inspectionCurrentScanId();
    if (scanId) await selectInspectionScanById(scanId, { syncArt: false });
  }

  function markSettingsChanged(markPreset = true, historyKey = null) {
    if (markPreset && settings.preset !== 'custom') {
      settings.preset = 'custom';
      presetSelect.value = 'custom';
    }
    if (highQualityStrokeStore) highQualityStale = true;
    markInk3DDirty();
    updateExportNote();
    recordSettingsChange(historyKey);
  }

  function buildSliders() {
    slidersRoot.innerHTML = '';
    for (const def of sliderDefs) {
      const wrap = document.createElement('div');
      wrap.style.marginBottom = '14px';
      wrap.innerHTML = `
        <div class="label-row">
          <label for="${def.key}">${def.label}</label>
          <span class="value" id="${def.key}Value"></span>
        </div>
        <input id="${def.key}" type="range" min="${def.min}" max="${def.max}" step="${def.step}" />
      `;
      slidersRoot.appendChild(wrap);
      const input = wrap.querySelector('input');
      input.addEventListener('input', () => {
        settings[def.key] = Number(input.value);
        updateSliderValue(def);
        markSettingsChanged(true, `slider:${def.key}`);
        schedulePreview();
      });
    }
  }

  function updateSliderValue(def) {
    const input = document.getElementById(def.key);
    const value = document.getElementById(def.key + 'Value');
    input.value = settings[def.key];
    value.textContent = def.format(settings[def.key]);
  }

  function syncPaletteAvailability() {
    const isColor = settings.mode === 'color';
    paletteSelect.disabled = !isColor;
    document.getElementById('colorStrength').disabled = !isColor;
    document.getElementById('paletteStrength').disabled = !isColor || settings.palette === 'original';
  }

  function syncModeButtons() {
    for (const btn of modeControl.querySelectorAll('button')) {
      const active = btn.dataset.mode === settings.mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function syncUI() {
    presetSelect.value = settings.preset;
    paletteSelect.value = settings.palette;
    lineCountRange.value = settings.lineCount;
    lineCountNumber.value = settings.lineCount;
    lineCountDisplay.textContent = formatCount(settings.lineCount);
    seedInput.value = settings.seed;
    for (const def of sliderDefs) updateSliderValue(def);
    syncLidarControls();
    syncProceduralControls();
    syncFlowMixerControls();
    syncModeButtons();
    syncInkSpaceButtons();
    syncPaletteAvailability();
  }

  function applyPreset(name, preview = true) {
    const preset = presets[name];
    if (!preset) return;
    const { lidar, ...art } = preset;
    Object.assign(settings, art);
    if (lidar) Object.assign(settings.lidar, lidar);
    settings.preset = name;
    if (highQualityStrokeStore) highQualityStale = true;
    syncUI();
    if (sourceKind === 'lidar' && lidarSourceMaps) {
      const maps = composeCurrentLidarMaps();
      applyRendererMaps(maps);
    }
    updateExportNote();
    recordSettingsChange(null);
    if (preview) schedulePreview();
  }

  function setLineCount(value, preview = true, historyKey = 'lineCount') {
    const normalized = clamp(Math.round(Number(value) / 1000) * 1000, 1000, 400000);
    settings.lineCount = normalized;
    lineCountRange.value = normalized;
    lineCountNumber.value = normalized;
    lineCountDisplay.textContent = formatCount(normalized);
    markSettingsChanged(true, historyKey);
    if (preview) schedulePreview();
  }

  function setMode(mode, preview = true) {
    settings.mode = mode === 'black' ? 'black' : 'color';
    syncModeButtons();
    syncPaletteAvailability();
    markSettingsChanged(true, 'mode');
    if (preview) schedulePreview();
  }

  function setStatus(message, percent = null) {
    statusEl.textContent = message;
    if (percent !== null) {
      const p = clamp(percent, 0, 100);
      progressBar.style.width = p.toFixed(1) + '%';
      statPercent.textContent = Math.round(p) + '%';
    }
  }

  function setStats(lines = 0, percent = 0, seconds = 0) {
    statLines.textContent = formatCount(lines);
    statPercent.textContent = Math.round(clamp(percent, 0, 100)) + '%';
    statTime.textContent = `${Math.max(0, seconds).toFixed(1)}s`;
  }

  function getExportTarget() {
    if (highQualityStrokeStore && highQualityRenderMeta) {
      return { store: highQualityStrokeStore, meta: highQualityRenderMeta, kind: 'high' };
    }
    if (displayStrokeStore && displayRenderMeta) {
      return { store: displayStrokeStore, meta: displayRenderMeta, kind: displayRenderMeta.kind };
    }
    return null;
  }

  function updateExportNote() {
    const target = getExportTarget();
    exportNote.classList.remove('warning');
    if (!target) {
      exportNote.textContent = 'Exports use the last completed high-quality render when available.';
      return;
    }

    const estimate = LineArtExport.formatBytes(LineArtExport.estimateSvgBytes(target.store, target.meta));
    const large = target.store.count > SVG_WARNING_LINES;
    const stale = target.kind === 'high' && highQualityStale;
    const sourceText = target.kind === 'high'
      ? `last high-quality render (${formatCount(target.store.count)} lines)`
      : `current preview (${formatCount(target.store.count)} lines)`;

    if (stale) {
      exportNote.textContent = `Settings changed. Save still exports the ${sourceText}. Estimated SVG: ${estimate}.`;
    } else {
      exportNote.textContent = `Save exports the ${sourceText}. Estimated SVG: ${estimate}.`;
    }
    if (large) {
      exportNote.classList.add('warning');
      exportNote.textContent += ' Large SVGs can be slow in vector editors.';
    }
  }

  function setHighQualityControlsLocked(locked) {
    imageInput.disabled = locked;
    presetSelect.disabled = locked;
    lineCountRange.disabled = locked;
    lineCountNumber.disabled = locked;
    flowScale.disabled = locked;
    flowTurbulence.disabled = locked;
    flowOctaves.disabled = locked;
    for (const def of mixerDefs) mixerControls[def.key].input.disabled = locked;
    seedInput.disabled = locked;
    variationBtn.disabled = locked;
    pngScaleSelect.disabled = locked;
    document.querySelectorAll('.quick-counts button').forEach(btn => btn.disabled = locked);
    modeControl.querySelectorAll('button').forEach(btn => btn.disabled = locked);
    sliderDefs.forEach(def => {
      const el = document.getElementById(def.key);
      if (el) el.disabled = locked;
    });
    updateLidarArtControlAvailability(locked);
    if (locked) paletteSelect.disabled = true;
    else syncPaletteAvailability();
  }

  function refreshButtons() {
    const active = !!activeRender;
    const highActive = activeRender?.kind === 'high';
    const exportBusy = exporter.isBusy();
    const uiLocked = highActive || exportBusy || scanRunning || ink3dLoading;
    const sourceReady = projectSourceReady();
    const modelReady = projectModelReady();
    const sensorReady = !(sourceKind === 'lidar' && scanDirty);

    setHighQualityControlsLocked(uiLocked);
    imageInput.disabled = uiLocked;
    modelInput.disabled = uiLocked || modelLoading;
    openProjectBtn.disabled = uiLocked || modelLoading;
    saveProjectBtn.disabled = highActive || exportBusy || scanRunning || modelLoading || ink3dLoading;

    scanControlEls.forEach(el => {
      el.disabled = !sceneLoaded || !modelReady || modelLoading || scanRunning || highActive || exportBusy || ink3dLoading;
    });
    scanBtn.disabled = !sceneLoaded || !modelReady || modelLoading || scanRunning || active || exportBusy || ink3dLoading;
    scanMultiBtn.disabled = scanBtn.disabled;
    scanAutoBtn.disabled = scanBtn.disabled;

    const inspectionLocked = modelLoading || scanRunning || highActive || exportBusy || ink3dLoading;
    inspectionToggle.disabled = !sceneLoaded || inspectionLocked;
    const inspectionHasScans = inspectionEntries().length > 0;
    inspectionScanSelect.disabled =
      !inspectionOpen || inspectionLoading || !inspectionHasScans || inspectionLocked;
    [
      inspectionShowMesh,
      inspectionShowPoints,
      inspectionShowRays,
      inspectionShowCameras,
      inspectionShowInk,
      inspectionResetView
    ].forEach(el => {
      el.disabled = !inspectionOpen || inspectionLoading || inspectionLocked;
    });
    inspectionViewpoints.querySelectorAll('button').forEach(button => {
      button.disabled = !inspectionOpen || inspectionLoading || inspectionLocked;
    });

    const inkButtons = inkSpaceControl.querySelectorAll('button[data-space]');
    const ink2dButton = inkSpaceControl.querySelector('button[data-space="2d"]');
    const ink3dButton = inkSpaceControl.querySelector('button[data-space="3d"]');
    const inkCompatible =
      sourceKind === 'lidar' &&
      !!sourceImage &&
      !!displayStrokeStore &&
      !!displayRenderMeta &&
      !!currentInk3DScanId() &&
      sensorReady &&
      settings.lidar.multiViewMode !== 'combined' &&
      !active &&
      !loadingImage &&
      !modelLoading;
    if (ink2dButton) ink2dButton.disabled = ink3dLoading;
    if (ink3dButton) ink3dButton.disabled = !inkCompatible || ink3dLoading || highActive || exportBusy;
    buildInk3DBtn.disabled = !inkCompatible || ink3dLoading || highActive || exportBusy;
    buildInk3DBtn.textContent = ink3dLoading
      ? 'Building 3D Ink…'
      : (ink3dSnapshot ? 'Refresh 3D Ink' : 'Build 3D Ink');
    syncInkSpaceButtons();

    const multiViewAvailable = !!multiViewBundle && modelReady && !modelLoading;
    multiViewMode.disabled = !multiViewAvailable || uiLocked;
    multiViewDebugColors.disabled = !multiViewAvailable || uiLocked;
    multiViewCurrent.disabled =
      !multiViewAvailable ||
      uiLocked ||
      settings.lidar.multiViewMode === 'combined';
    renderBtn.disabled = !sourceReady || !sensorReady || !sourceImage || loadingImage || scanRunning || highActive || exportBusy;
    cancelBtn.disabled = !active;

    const canSave =
      sourceReady &&
      sensorReady &&
      !active &&
      !loadingImage &&
      !scanRunning &&
      !exportBusy &&
      !!getExportTarget();
    saveBtn.disabled = !canSave;
    saveSvgBtn.disabled = !canSave;

    historyUiLocked = highActive || exportBusy || scanRunning || modelLoading || ink3dLoading;
    renderHistoryStatus(history.status());
    updateExportNote();
  }

  async function decodeBitmap(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (_) {
      return await createImageBitmap(file);
    }
  }

  function installSource(
    newSourceCanvas,
    newPixels,
    maps,
    w,
    h,
    readyMessage,
    kind = 'image',
    reference = null
  ) {
    if (sourceCanvas && sourceCanvas !== newSourceCanvas) {
      sourceCanvas.width = 0;
      sourceCanvas.height = 0;
    }

    sourceCanvas = newSourceCanvas;
    sourcePixels = newPixels;
    sourceImage = { width: w, height: h };
    sourceKind = kind;
    if (kind !== 'lidar' && settings.inkSpace === '3d') {
      settings.inkSpace = '2d';
      syncInkSpaceButtons();
    }
    sourceReference = reference && typeof reference === 'object'
      ? { ...reference, kind }
      : { kind, name: typeof reference === 'string' ? reference : null };
    sourceName = sourceReference.name || null;

    if (
      requiredSourceReference &&
      LineArtProjectState.sourceMatches(requiredSourceReference, sourceReference)
    ) {
      requiredSourceReference = null;
      restoredSourceHint = null;
      setProjectStatus('Referenced source loaded. Project is ready.');
    } else if (!requiredSourceReference) {
      restoredSourceHint = null;
    }

    if (kind !== 'lidar') {
      lidarSourceMaps = null;
      clearInstalledScan();
    } else {
      updateScanFreshness();
    }
    applyRendererMaps(maps);

    displayStrokeStore = null;
    displayRenderMeta = null;
    highQualityStrokeStore = null;
    highQualityRenderMeta = null;
    highQualityStale = false;
    resetInk3D(
      kind === 'lidar'
        ? '3D Ink waiting for the current 2D preview.'
        : '3D Ink is available after loading and scanning a 3D model.'
    );

    canvas.width = w;
    canvas.height = h;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    canvas.setAttribute('aria-label', `Generated line-art preview, ${w} by ${h} pixels`);

    emptyState.hidden = true;
    canvasShell.hidden = inspectionOpen;
    if (inspectionOpen) inspectionShell.hidden = false;
    loadingImage = false;
    scanRunning = false;
    updateLidarArtControlAvailability(false);
    refreshButtons();
    autosaveCurrentState();
    if (projectSourceReady() && !(kind === 'lidar' && scanDirty)) {
      setStatus(readyMessage, 0);
      startRender('preview');
    } else if (!projectSourceReady()) {
      const needed = requiredSourceLabel();
      setProjectStatus(`This source does not match the project. Load ${needed}.`, true);
      setStatus(`Source loaded, but the project is waiting for ${needed}.`, 0);
      refreshButtons();
    } else {
      setProjectStatus('LiDAR source loaded, but the installed scan is stale. Rescan LiDAR.', true);
      setStatus('Rescan LiDAR to match the current sensor settings.', 0);
      refreshButtons();
    }
  }

  async function loadImageFile(file) {
    if (!file) return;
    const serial = ++loadSerial;
    stopRender(false);
    clearTimeout(previewTimer);
    previewTimer = 0;
    loadingImage = true;
    scanRunning = false;
    refreshButtons();
    setStatus('Loading image...', 0);
    setStats(0, 0, 0);

    let bitmap = null;
    let newSourceCanvas = null;
    try {
      bitmap = await decodeBitmap(file);
      if (serial !== loadSerial) {
        bitmap.close?.();
        return;
      }

      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(2, Math.round(bitmap.width * scale));
      const h = Math.max(2, Math.round(bitmap.height * scale));

      newSourceCanvas = document.createElement('canvas');
      newSourceCanvas.width = w;
      newSourceCanvas.height = h;
      const newSourceCtx = newSourceCanvas.getContext('2d', { willReadFrequently: true, alpha: false });
      newSourceCtx.fillStyle = '#ffffff';
      newSourceCtx.fillRect(0, 0, w, h);
      newSourceCtx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close?.();
      bitmap = null;

      const newPixels = newSourceCtx.getImageData(0, 0, w, h);
      setStatus('Analyzing edges and stroke flow...', 0);
      await nextFrame();
      const maps = LineArtAnalysis.buildAnalysisMaps(newPixels, w, h);

      if (serial !== loadSerial) {
        newSourceCanvas.width = 0;
        newSourceCanvas.height = 0;
        return;
      }

      const imageReference = await fileSourceReference(file, 'image');
      if (serial !== loadSerial) {
        newSourceCanvas.width = 0;
        newSourceCanvas.height = 0;
        return;
      }

      installSource(
        newSourceCanvas,
        newPixels,
        maps,
        w,
        h,
        `Ready - ${w} x ${h}px. Building direction-aware preview...`,
        'image',
        imageReference
      );
    } catch (error) {
      bitmap?.close?.();
      if (newSourceCanvas && newSourceCanvas !== sourceCanvas) {
        newSourceCanvas.width = 0;
        newSourceCanvas.height = 0;
      }
      if (serial !== loadSerial) return;
      console.error(error);
      loadingImage = false;
      refreshButtons();
      if (sourceImage) {
        setStatus('Could not load that image. The previous source is still available.', 0);
      } else {
        emptyState.hidden = false;
        canvasShell.hidden = true;
        setStatus('Could not load that image.', 0);
      }
    }
  }

  async function installLoadedScene(scene, reference, { generated = false } = {}) {
    sceneLoaded = true;
    modelReference = reference;
    const previousScanLabel = installedScanLabel;
    multiViewBundle = null;
    installedMultiViewSignature = null;
    installedScanSignature = null;
    installedScanId = null;
    installedScanMetadata = null;
    installedScanCacheHit = false;
    installedScanMode = 'single';
    updateMultiViewSummary();

    // Replacing the model never relabels the old canvas. The installed
    // drawing stays tied to sourceReference until a new scan is installed.
    scanDirty = true;
    scanBtn.textContent = 'Scan LiDAR';
    scanSummary.textContent = sourceKind === 'lidar' && sourceImage
      ? `Scan stale · ${previousScanLabel || 'scan'}`
      : 'Scan stale · ready to scan';
    modelStatus.textContent =
      `${scene.name} - ${formatCount(scene.triangles)} triangles, ${formatCount(scene.vertices)} vertices`;
    resetInspectionForScene();
    if (inspectionOpen) {
      await loadInspectionScene({ force: true });
    }

    if (!projectModelReady()) {
      const needed = requiredSourceLabel();
      setProjectStatus(`Loaded model does not match this project. Load ${needed}.`, true);
      setStatus(`Model loaded, but the project is waiting for ${needed}.`, 0);
    } else {
      setProjectStatus(
        requiredSourceReference
          ? 'Referenced model loaded. Run LiDAR to reproduce the project.'
          : (generated ? 'Generated 3D model loaded.' : '3D model loaded.')
      );
      setStatus(
        generated
          ? 'Generated 3D model loaded. Adjust scan controls, then run LiDAR.'
          : '3D model loaded. Adjust scan controls, then run LiDAR.',
        0
      );
    }
    autosaveCurrentState();
  }

  function captureModelLoadState() {
    return {
      sceneLoaded,
      modelReference,
      scanDirty,
      modelStatus: modelStatus.textContent,
      scanSummary: scanSummary.textContent,
      scanButton: scanBtn.textContent
    };
  }

  function restoreModelLoadState(previous) {
    sceneLoaded = previous.sceneLoaded;
    modelReference = previous.modelReference;
    scanDirty = previous.scanDirty;
    modelStatus.textContent = previous.modelStatus;
    scanSummary.textContent = previous.scanSummary;
    scanBtn.textContent = previous.scanButton;
  }

  async function uploadModelFile(file) {
    if (!file) return;

    const previous = {
      sceneLoaded,
      modelReference,
      scanDirty,
      modelStatus: modelStatus.textContent,
      scanSummary: scanSummary.textContent,
      scanButton: scanBtn.textContent
    };

    modelLoading = true;
    modelStatus.textContent = `Uploading ${file.name}...`;
    refreshButtons();

    try {
      const result = await LidarClient.uploadScene(file);
      const scene = result.scene;
      sceneLoaded = true;
      modelReference = await fileSourceReference(file, 'lidar', scene.sha256 || null);
      const previousScanLabel = installedScanLabel;
      multiViewBundle = null;
      installedMultiViewSignature = null;
      installedScanSignature = null;
      installedScanId = null;
      installedScanMetadata = null;
      installedScanCacheHit = false;
      installedScanMode = 'single';
      updateMultiViewSummary();

      // Uploading a model replaces the server scene/scan, but it does not
      // relabel the old canvas. sourceReference stays tied to the installed
      // drawing until a new scan is installed.
      scanDirty = true;
      scanBtn.textContent = 'Scan LiDAR';
      scanSummary.textContent = sourceKind === 'lidar' && sourceImage
        ? `Scan stale · ${previousScanLabel || 'scan'}`
        : 'Scan stale · ready to scan';
      modelStatus.textContent =
        `${scene.name} - ${formatCount(scene.triangles)} triangles, ${formatCount(scene.vertices)} vertices`;
      resetInspectionForScene();
      if (inspectionOpen) {
        await loadInspectionScene({ force: true });
      }

      if (!projectModelReady()) {
        const needed = requiredSourceLabel();
        setProjectStatus(`Loaded model does not match this project. Load ${needed}.`, true);
        setStatus(`Model loaded, but the project is waiting for ${needed}.`, 0);
      } else {
        setProjectStatus(
          requiredSourceReference
            ? 'Referenced model loaded. Run LiDAR to reproduce the project.'
            : '3D model loaded.'
        );
        setStatus('3D model loaded. Adjust scan controls, then run LiDAR.', 0);
      }
      autosaveCurrentState();
    } catch (error) {
      console.error(error);
      sceneLoaded = previous.sceneLoaded;
      modelReference = previous.modelReference;
      scanDirty = previous.scanDirty;
      scanSummary.textContent = previous.scanSummary;
      scanBtn.textContent = previous.scanButton;
      const suffix = error.errorId ? ` (${error.errorId})` : '';
      modelStatus.textContent = previous.sceneLoaded
        ? `Model upload failed: ${error.message}${suffix}. Previous model is still loaded.`
        : `Model upload failed: ${error.message}${suffix}`;
      setStatus(
        previous.sceneLoaded
          ? 'Could not load that 3D model. The previous model is still available.'
          : 'Could not load that 3D model.',
        0
      );
    } finally {
      modelLoading = false;
      refreshButtons();
    }
  }

  async function runLidarScan() {
    if (!sceneLoaded || scanRunning) return;

    const serial = ++loadSerial;
    stopRender(false);
    clearTimeout(previewTimer);
    previewTimer = 0;
    scanRunning = true;
    loadingImage = true;
    scanSummary.textContent = 'Scan running…';
    scanBtn.textContent = 'Scanning…';
    refreshButtons();
    setStatus('LiDAR scan running...', 0);
    setStats(0, 0, 0);

    let shadedCanvas = null;
    try {
      const options = readScanControls();
      const response = await LidarClient.scan(options);
      const scan = response.scan;
      setStatus(
        scan.cache_hit
          ? 'Scan cached. Loading cached LiDAR maps...'
          : 'Loading LiDAR depth, edge, variance, and confidence maps...',
        0
      );
      const images = await LidarClient.fetchScanMaps(scan);

      if (serial !== loadSerial) {
        for (const item of Object.values(images)) {
          item.canvas.width = 0;
          item.canvas.height = 0;
        }
        return;
      }

      shadedCanvas = images.shaded.canvas;
      lidarSourceMaps = LineArtAnalysis.buildLidarSourceMaps(
        images.shaded.imageData,
        images.depth.imageData,
        images.edge.imageData,
        images.variance.imageData,
        images.confidence.imageData,
        images.shaded.width,
        images.shaded.height
      );
      const maps = composeCurrentLidarMaps();

      for (const [name, item] of Object.entries(images)) {
        if (name !== 'shaded') {
          item.canvas.width = 0;
          item.canvas.height = 0;
        }
      }

      rememberInstalledScan(scan);
      modelStatus.textContent =
        `${scan.scene?.name || '3D model'} - ${Math.round(scan.coverage * 100)}% ray coverage · orbit ${Math.round(scan.camera?.yaw_deg ?? 0)}°`;

      installSource(
        shadedCanvas,
        images.shaded.imageData,
        maps,
        images.shaded.width,
        images.shaded.height,
        scan.cache_hit
          ? `Scan cached - ${images.shaded.width} x ${images.shaded.height}px. Building preview...`
          : `LiDAR maps ready - ${images.shaded.width} x ${images.shaded.height}px. Building preview...`,
        'lidar',
        modelReference || {
          kind: 'lidar',
          name: scan.scene?.name || '3D model',
          sha256: scan.scene?.sha256 || null
        }
      );
      await refreshInspectionAfterAcquisition();
    } catch (error) {
      console.error(error);
      if (shadedCanvas && shadedCanvas !== sourceCanvas) {
        shadedCanvas.width = 0;
        shadedCanvas.height = 0;
      }
      if (serial !== loadSerial) return;
      scanRunning = false;
      loadingImage = false;
      updateScanFreshness();
      refreshButtons();
      const suffix = error.errorId ? ` (${error.errorId})` : '';
      setStatus(`LiDAR scan failed: ${error.message}${suffix}`, 0);
    }
  }

  function uint8RedChannel(imageData, count) {
    const out = new Uint8Array(count);
    const data = imageData.data;
    for (let p = 0, i = 0; p < count; p++, i += 4) out[p] = data[i];
    return out;
  }

  async function attachConfidenceFusion(order, loadedViews) {
    const scanIds = loadedViews.map(view => view.scan.scan_id);
    setStatus(`Fusing confidence across ${scanIds.length} cached views...`, 0);
    const response = await LidarClient.fuseConfidence(scanIds);
    const fusion = response.fusion;
    const maps = await LidarClient.fetchFusionMaps(fusion);
    const byScanId = Object.fromEntries(
      loadedViews.map(view => [view.scan.scan_id, view])
    );

    try {
      for (const scanId of fusion.scan_ids || []) {
        const target = byScanId[scanId];
        const item = maps[scanId];
        if (!target || !item) throw new Error('Confidence fusion returned an unknown scan.');
        if (
          item.confidence.width !== target.width ||
          item.confidence.height !== target.height ||
          item.support.width !== target.width ||
          item.support.height !== target.height
        ) {
          throw new Error('Fused confidence dimensions do not match the source view.');
        }
        const count = target.width * target.height;
        target.fusedConfidence = uint8RedChannel(item.confidence.imageData, count);
        target.fusionSupport = uint8RedChannel(item.support.imageData, count);
        target.fusion = item.descriptor;
      }
    } finally {
      for (const item of Object.values(maps)) {
        item.confidence.canvas.width = 0;
        item.confidence.canvas.height = 0;
        item.support.canvas.width = 0;
        item.support.canvas.height = 0;
      }
    }
    return fusion;
  }

  function syncMultiViewOptions(order, views) {
    const currentValue = settings.lidar.multiViewCurrent || multiViewCurrent.value;
    multiViewCurrent.innerHTML = '';
    for (const name of order) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = views?.[name]?.scan?.view?.label ||
        name.replace(/^./, letter => letter.toUpperCase());
      multiViewCurrent.appendChild(option);
    }
    if (order.includes(currentValue)) multiViewCurrent.value = currentValue;
  }

  async function runFixedMultiViewScan() {
    if (!sceneLoaded || scanRunning) return;

    const serial = ++loadSerial;
    stopRender(false);
    clearTimeout(previewTimer);
    previewTimer = 0;
    scanRunning = true;
    loadingImage = true;
    scanSummary.textContent = 'Scan running… · 5 fixed views';
    scanMultiBtn.textContent = 'Scanning 5 Views…';
    refreshButtons();
    setStatus('Scanning Front, Back, Left, Right, and Top...', 0);
    setStats(0, 0, 0);

    try {
      const options = readScanControls();
      delete options.yaw_deg;
      delete options.elevation_deg;

      const response = await LidarClient.scanFixedViews(options);
      const multiview = response.multiview;
      const order = multiview?.order || [];
      if (order.length !== LineArtMultiView.VIEW_ORDER.length) {
        throw new Error('Fixed multi-view scan did not return all five views.');
      }

      setStatus('Loading five independent LiDAR map sets...', 0);

      const loadedViews = await Promise.all(order.map(async name => {
        const scan = multiview.views?.[name];
        if (!scan) throw new Error(`Missing fixed LiDAR view: ${name}`);
        const images = await LidarClient.fetchScanMaps(scan);
        try {
          const sourceMaps = LineArtAnalysis.buildLidarSourceMaps(
            images.shaded.imageData,
            images.depth.imageData,
            images.edge.imageData,
            images.variance.imageData,
            images.confidence.imageData,
            images.shaded.width,
            images.shaded.height
          );
          return {
            name,
            scan,
            width: images.shaded.width,
            height: images.shaded.height,
            pixels: images.shaded.imageData,
            sourceMaps
          };
        } finally {
          for (const item of Object.values(images)) {
            item.canvas.width = 0;
            item.canvas.height = 0;
          }
        }
      }));

      if (serial !== loadSerial) return;

      const width = loadedViews[0].width;
      const height = loadedViews[0].height;
      for (const view of loadedViews) {
        if (view.width !== width || view.height !== height) {
          throw new Error('Fixed LiDAR view dimensions do not match.');
        }
      }

      const fusion = await attachConfidenceFusion(order, loadedViews);
      if (serial !== loadSerial) return;

      const combinedRgba = LineArtMultiView.combineShadedPixels(
        loadedViews,
        width,
        height
      );
      const combinedPixels = new ImageData(combinedRgba, width, height);
      const views = Object.fromEntries(loadedViews.map(view => [view.name, view]));
      syncMultiViewOptions(order, views);

      multiViewBundle = {
        metadata: multiview,
        order: [...order],
        views,
        width,
        height,
        combinedPixels,
        fusion
      };

      if (!views[settings.lidar.multiViewCurrent]) {
        settings.lidar.multiViewCurrent = order[0];
        multiViewCurrent.value = order[0];
      }

      rememberInstalledMultiView(multiview);
      const averageCoverage = loadedViews.reduce(
        (sum, view) => sum + Number(view.scan.coverage || 0),
        0
      ) / loadedViews.length;
      const meanFusion = Object.values(fusion.views || {}).reduce(
        (sum, view) => sum + Number(view.mean_confidence || 0),
        0
      ) / Math.max(1, order.length);
      modelStatus.textContent =
        `${loadedViews[0].scan.scene?.name || '3D model'} - 5 fixed views · ${Math.round(averageCoverage * 100)}% average coverage · ${Math.round(meanFusion * 100)}% fused confidence`;

      activateMultiViewSource({ install: true });
      await refreshInspectionAfterAcquisition();
    } catch (error) {
      console.error(error);
      if (serial !== loadSerial) return;
      scanRunning = false;
      loadingImage = false;
      scanMultiBtn.textContent = multiViewBundle ? 'Rescan 5 Views' : 'Scan 5 Views';
      updateScanFreshness();
      refreshButtons();
      const suffix = error.errorId ? ` (${error.errorId})` : '';
      setStatus(`Fixed multi-view scan failed: ${error.message}${suffix}`, 0);
    }
  }

  async function runAutoViewScan() {
    if (!sceneLoaded || scanRunning) return;

    const serial = ++loadSerial;
    stopRender(false);
    clearTimeout(previewTimer);
    previewTimer = 0;
    scanRunning = true;
    loadingImage = true;
    scanSummary.textContent = 'Scan running… · automatic views';
    scanAutoBtn.textContent = 'Auto Scanning…';
    refreshButtons();
    setStatus('Auto Scan is choosing useful LiDAR viewpoints...', 0);
    setStats(0, 0, 0);

    try {
      const options = readScanControls();
      delete options.yaw_deg;
      delete options.elevation_deg;

      const response = await LidarClient.scanAutoViews(options);
      const multiview = response.multiview;
      const order = multiview?.order || [];
      if (!order.length) {
        throw new Error('Auto Scan did not acquire any usable views.');
      }

      setStatus(`Loading ${order.length} auto-selected LiDAR map sets...`, 0);
      const loadedViews = await Promise.all(order.map(async name => {
        const scan = multiview.views?.[name];
        if (!scan) throw new Error(`Missing auto-selected LiDAR view: ${name}`);
        const images = await LidarClient.fetchScanMaps(scan);
        try {
          const sourceMaps = LineArtAnalysis.buildLidarSourceMaps(
            images.shaded.imageData,
            images.depth.imageData,
            images.edge.imageData,
            images.variance.imageData,
            images.confidence.imageData,
            images.shaded.width,
            images.shaded.height
          );
          return {
            name,
            scan,
            width: images.shaded.width,
            height: images.shaded.height,
            pixels: images.shaded.imageData,
            sourceMaps
          };
        } finally {
          for (const item of Object.values(images)) {
            item.canvas.width = 0;
            item.canvas.height = 0;
          }
        }
      }));

      if (serial !== loadSerial) return;
      const width = loadedViews[0].width;
      const height = loadedViews[0].height;
      for (const view of loadedViews) {
        if (view.width !== width || view.height !== height) {
          throw new Error('Auto-selected LiDAR view dimensions do not match.');
        }
      }

      const fusion = await attachConfidenceFusion(order, loadedViews);
      if (serial !== loadSerial) return;

      const combinedRgba = LineArtMultiView.combineShadedPixels(
        loadedViews,
        width,
        height
      );
      const combinedPixels = new ImageData(combinedRgba, width, height);
      const views = Object.fromEntries(loadedViews.map(view => [view.name, view]));
      syncMultiViewOptions(order, views);

      multiViewBundle = {
        metadata: multiview,
        order: [...order],
        views,
        width,
        height,
        combinedPixels,
        fusion
      };

      if (!views[settings.lidar.multiViewCurrent]) {
        settings.lidar.multiViewCurrent = order[0];
        multiViewCurrent.value = order[0];
      }

      rememberInstalledMultiView(multiview);
      scanAutoBtn.textContent = 'Auto Scan';
      const planner = multiview.planner || {};
      const coverageScore = Math.round(Number(planner.coverage_score || 0) * 100);
      const meanFusion = Object.values(fusion.views || {}).reduce(
        (sum, view) => sum + Number(view.mean_confidence || 0),
        0
      ) / Math.max(1, order.length);
      modelStatus.textContent =
        `${loadedViews[0].scan.scene?.name || '3D model'} - ${order.length} auto views · ${coverageScore}% view-space coverage · ${Math.round(meanFusion * 100)}% fused confidence · ${planner.stop_reason || 'complete'}`;

      activateMultiViewSource({ install: true });
      await refreshInspectionAfterAcquisition();
    } catch (error) {
      console.error(error);
      if (serial !== loadSerial) return;
      scanRunning = false;
      loadingImage = false;
      scanAutoBtn.textContent = 'Auto Scan';
      updateScanFreshness();
      refreshButtons();
      const suffix = error.errorId ? ` (${error.errorId})` : '';
      setStatus(`Auto Scan failed: ${error.message}${suffix}`, 0);
    }
  }

    async function restoreServerScene() {
    const serial = ++loadSerial;
    try {
      // Autosave recovery only hints at the previous image; it must not let an
      // unrelated server-side LiDAR scene replace that recovery path.
      if (
        requiredSourceReference?.kind === 'image' ||
        (!requiredSourceReference && restoredSourceHint?.kind === 'image')
      ) {
        return null;
      }

      const result = await LidarClient.getState();
      if (serial !== loadSerial) return null;

      const workspace = result.state?.workspace;
      const scene = workspace?.scene;
      if (!scene?.loaded) return null;

      sceneLoaded = true;
      const serverReference = {
        kind: 'lidar',
        name: scene.name || '3D model',
        size: null,
        lastModified: null,
        type: null,
        sha256: scene.sha256 || null
      };
      const hintedReference =
        (requiredSourceReference?.kind === 'lidar' &&
          LineArtProjectState.sourceMatches(requiredSourceReference, serverReference))
          ? requiredSourceReference
          : ((restoredSourceHint?.kind === 'lidar' &&
              LineArtProjectState.sourceMatches(restoredSourceHint, serverReference))
              ? restoredSourceHint
              : serverReference);
      modelReference = hintedReference;
      resetInspectionForScene();

      modelStatus.textContent =
        `${scene.name || '3D model'} - ${formatCount(scene.triangles || 0)} triangles loaded on server`;

      if (!projectModelReady()) {
        scanDirty = true;
        scanSummary.textContent = 'Scan stale · different project model';
        scanBtn.textContent = 'Scan LiDAR';
        setProjectStatus(
          `Local server has a different model. Load ${requiredSourceLabel()}.`,
          true
        );
        refreshButtons();
        return 'scene-mismatch';
      }

      if (workspace?.scan?.status === 'ready') {
        try {
          const mapsResponse = await LidarClient.getMaps();
          if (serial !== loadSerial) return null;

          const scan = mapsResponse.scan;
          const images = await LidarClient.fetchScanMaps(scan);
          if (serial !== loadSerial) {
            for (const item of Object.values(images)) {
              item.canvas.width = 0;
              item.canvas.height = 0;
            }
            return null;
          }

          lidarSourceMaps = LineArtAnalysis.buildLidarSourceMaps(
            images.shaded.imageData,
            images.depth.imageData,
            images.edge.imageData,
            images.variance.imageData,
            images.confidence.imageData,
            images.shaded.width,
            images.shaded.height
          );
          const maps = composeCurrentLidarMaps();

          for (const [name, item] of Object.entries(images)) {
            if (name !== 'shaded') {
              item.canvas.width = 0;
              item.canvas.height = 0;
            }
          }

          rememberInstalledScan(scan);
          modelStatus.textContent =
            `${scan.scene?.name || scene.name || '3D model'} - restored server scan · ${Math.round(scan.coverage * 100)}% coverage`;

          installSource(
            images.shaded.canvas,
            images.shaded.imageData,
            maps,
            images.shaded.width,
            images.shaded.height,
            scanDirty
              ? 'Referenced model restored. Rescan LiDAR to reproduce the saved camera settings.'
              : `Restored LiDAR scan - ${images.shaded.width} x ${images.shaded.height}px. Building preview...`,
            'lidar',
            modelReference
          );
          await refreshInspectionAfterAcquisition();

          if (scanDirty) {
            setProjectStatus(
              'Referenced model restored; current server scan is stale. Rescan LiDAR to reproduce the project.',
              true
            );
          }
          return 'lidar';
        } catch (error) {
          if (serial !== loadSerial) return null;
          console.warn('Could not restore the previous LiDAR scan:', error);
        }
      }

      scanDirty = true;
      scanSummary.textContent = 'Scan stale · ready to scan';
      scanBtn.textContent = 'Scan LiDAR';
      if (requiredSourceReference?.kind === 'lidar') {
        setProjectStatus('Referenced model is loaded. Run LiDAR to reproduce the project.', true);
      }
      syncInspectionControls();
      refreshButtons();
      return 'scene';
    } catch (_) {
      if (serial !== loadSerial) return null;
      modelStatus.textContent = '3D mode requires the local Python server.';
      return null;
    }
  }

  function schedulePreview() {
    if (!sourceImage || loadingImage) return;
    if (sourceKind === 'lidar' && scanDirty) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewTimer = 0;
      startRender('preview');
    }, PREVIEW_DEBOUNCE_MS);
  }

  function stopRender(showStatus = true) {
    clearTimeout(previewTimer);
    previewTimer = 0;
    renderSerial++;
    if (activeRender) {
      const pct = activeRender.target ? activeRender.drawn / activeRender.target * 100 : 0;
      const seconds = (performance.now() - activeRender.startedAt) / 1000;
      if (showStatus) setStatus(`Cancelled at ${formatCount(activeRender.drawn)} lines. Previous completed export is still available.`, pct);
      setStats(activeRender.drawn, pct, seconds);
    }
    activeRender = null;
    ctx.globalAlpha = 1;
    refreshButtons();
  }

  function startRender(kind) {
    if (!sourceImage || loadingImage) return;
    if (sourceKind === 'lidar' && scanDirty) return;
    clearTimeout(previewTimer);
    previewTimer = 0;

    const serial = ++renderSerial;
    const isPreview = kind === 'preview';
    const renderSettings = {
      ...settings,
      procedural: { ...settings.procedural },
      flowMixer: { ...settings.flowMixer },
      lidar: { ...settings.lidar }
    };
    const target = isPreview ? Math.min(renderSettings.lineCount, PREVIEW_MAX_LINES) : renderSettings.lineCount;
    const seed = normalizeSeed(renderSettings.seed);

    let previewOpacityMultiplier = 1;
    let previewWeightMultiplier = 1;
    if (isPreview && target > 0 && renderSettings.lineCount > target) {
      const ratio = renderSettings.lineCount / target;
      const baseOpacity = clamp(renderSettings.opacity, 0.001, 0.999);
      const equivalentOpacity = 1 - Math.pow(1 - baseOpacity, ratio);
      previewOpacityMultiplier = clamp(equivalentOpacity / baseOpacity, 1, 3.6);
      previewWeightMultiplier = clamp(Math.pow(ratio, 0.06), 1, 1.25);
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (renderSettings.mode === 'black') ctx.strokeStyle = '#0c0c0c';

    const coverageWidth = Math.ceil(canvas.width / COVERAGE_CELL);
    const coverageHeight = Math.ceil(canvas.height / COVERAGE_CELL);

    activeRender = {
      serial,
      kind,
      target,
      drawn: 0,
      startedAt: performance.now(),
      settings: renderSettings,
      seed,
      strokes: renderer.createStrokeStore(target),
      candidate: {
        x: 0, y: 0, darkness: 0, targetInk: 0, remainingNeed: 0, edge: 0,
        cellIndex: 0, direction: 0, coherence: 0, importance: 0, score: 0
      },
      coverageWidth,
      coverageHeight,
      coverage: new Float32Array(coverageWidth * coverageHeight),
      colorScratch: new Uint16Array(3),
      colorCache: new Map(),
      pathScratch: new Float32Array(MAX_STREAM_POINTS * 2),
      backScratch: new Float32Array(MAX_STREAM_POINTS * 2),
      fwdScratch: new Float32Array(MAX_STREAM_POINTS * 2),
      previewOpacityMultiplier,
      previewWeightMultiplier
    };

    refreshButtons();
    const label = isPreview ? 'Preview' : 'High quality';
    setStatus(`${label}: rendering ${formatCount(target)} lines...`, 0);
    setStats(0, 0, 0);
    requestAnimationFrame(() => renderFrame(serial));
  }

  function renderFrame(serial) {
    const rs = activeRender;
    if (!rs || rs.serial !== serial || serial !== renderSerial) return;

    const frameStart = performance.now();
    let frameLines = 0;
    const remaining = rs.target - rs.drawn;
    const softCap = Math.min(remaining, 9000);

    while (frameLines < softCap && rs.drawn < rs.target) {
      renderer.drawOneStroke(rs);
      rs.drawn++;
      frameLines++;
      if ((frameLines & 31) === 0 && performance.now() - frameStart >= FRAME_BUDGET_MS) break;
    }

    const pct = rs.target ? rs.drawn / rs.target * 100 : 100;
    const seconds = (performance.now() - rs.startedAt) / 1000;
    const label = rs.kind === 'preview' ? 'Preview' : 'High quality';
    setStatus(`${label}: ${formatCount(rs.drawn)} / ${formatCount(rs.target)} lines`, pct);
    setStats(rs.drawn, pct, seconds);

    if (rs.drawn >= rs.target) {
      ctx.globalAlpha = 1;
      const meta = {
        kind: rs.kind,
        width: canvas.width,
        height: canvas.height,
        settings: { ...rs.settings },
        placement: renderer.summarizePlacement(rs),
        elapsed: seconds
      };
      displayStrokeStore = rs.strokes;
      displayRenderMeta = meta;
      if (rs.kind === 'high') {
        highQualityStrokeStore = rs.strokes;
        highQualityRenderMeta = meta;
        highQualityStale = false;
      }
      activeRender = null;
      markInk3DDirty('2D strokes changed; refreshing the world-space projection.');
      setStatus(`${label} done - ${formatCount(rs.drawn)} strokes.`, 100);
      setStats(rs.drawn, 100, seconds);
      refreshButtons();
      if (settings.inkSpace === '3d' && sourceKind === 'lidar') {
        setInspectionOpen(true)
          .then(() => buildCurrentInk3D())
          .catch(error => console.error(error));
      }
      return;
    }

    requestAnimationFrame(() => renderFrame(serial));
  }

  buildSliders();
  applyPreset('finePencil', false);
  settings.seed = normalizeSeed(seedInput.value);

  const autosavedSnapshot = history.restoreAutosave();
  const restoredProject = autosavedSnapshot
    ? LineArtProjectState.restore(
        autosavedSnapshot,
        DEFAULT_SETTINGS,
        DEFAULT_EXPORT_SETTINGS
      )
    : null;
  if (restoredProject) {
    Object.assign(settings, normalizeRestoredSettings(restoredProject.settings));
    pngScaleSelect.value = restoredProject.export.pngScale;
    restoredSourceHint = restoredProject.source;
    requiredSourceReference = null;
  }

  syncUI();
  syncInspectionControls();
  history.initialize(captureProjectState());
  historyReady = true;
  refreshButtons();

  document.body.dataset.phase1Ready = 'true';
  document.body.dataset.phase3Ready = 'true';
  document.body.dataset.phase4Ready = 'true';
  document.body.dataset.phase5Ready = 'true';
  document.body.dataset.phase6Ready = 'true';
  document.body.dataset.phase7Ready = 'true';
  document.body.dataset.phase8Ready = 'true';
  document.body.dataset.phase9Ready = 'true';
  document.body.dataset.phase10Ready = 'true';
  document.body.dataset.phase11Ready = 'true';
  document.body.dataset.phase115Ready = 'true';
  document.body.dataset.phase12Ready = 'true';
  document.body.dataset.phase13Ready = 'true';
  document.body.dataset.phase14Ready = 'true';
  document.body.dataset.phase15Ready = 'true';
  document.body.dataset.phase16Ready = 'true';

  if (restoredProject?.source?.kind === 'image') {
    setProjectStatus(
      `Autosave restored. Reselect image "${restoredProject.source.name || 'previous image'}" to continue, or choose another image.`
    );
  } else if (restoredProject?.source?.kind === 'lidar') {
    setProjectStatus('Autosave restored. Checking the local server for the referenced model...');
  }

  restoreServerScene().then(restoredKind => {
    if (restoredKind) return;
    if (restoredSourceHint?.kind === 'image') {
      const name = restoredSourceHint.name ? ` "${restoredSourceHint.name}"` : '';
      setStatus(`Settings restored from autosave. Reselect image${name} to restore the source.`, 0);
    } else if (restoredSourceHint?.kind === 'lidar') {
      setStatus('Settings restored from autosave. Reload the 3D model if the local server was restarted.', 0);
    } else if (restoredProject) {
      setStatus('Settings restored from local autosave.', 0);
    }
  });

  openProjectBtn.addEventListener('click', () => projectFileInput.click());
  saveProjectBtn.addEventListener('click', saveProjectFile);
  projectFileInput.addEventListener('change', e => openProjectFile(e.target.files?.[0]));

  imageInput.addEventListener('change', e => loadImageFile(e.target.files?.[0]));
  modelInput.addEventListener('change', e => uploadModelFile(e.target.files?.[0]));
  scanBtn.addEventListener('click', runLidarScan);
  scanMultiBtn.addEventListener('click', runFixedMultiViewScan);
  scanAutoBtn.addEventListener('click', runAutoViewScan);

  inkSpaceControl.querySelectorAll('button[data-space]').forEach(button => {
    button.addEventListener('click', () => {
      setInkSpace(button.dataset.space).catch(error => {
        console.error(error);
        ink3dStatus.textContent = `Could not switch Ink Space: ${error.message}`;
      });
    });
  });
  buildInk3DBtn.addEventListener('click', () => {
    const task = settings.inkSpace === '3d'
      ? buildCurrentInk3D({ force: true })
      : setInkSpace('3d');
    Promise.resolve(task).catch(error => {
      console.error(error);
      ink3dStatus.textContent = `3D Ink failed: ${error.message}`;
    });
  });

  inspectionToggle.addEventListener('click', () => {
    setInspectionOpen(!inspectionOpen).catch(error => {
      console.error(error);
      inspectionStatus.textContent = `3D inspection failed: ${error.message}`;
    });
  });
  inspectionScanSelect.addEventListener('change', () => {
    selectInspectionScanById(inspectionScanSelect.value).catch(error => {
      console.error(error);
      inspectionStatus.textContent = `Could not select scan: ${error.message}`;
    });
  });
  [
    inspectionShowMesh,
    inspectionShowPoints,
    inspectionShowRays,
    inspectionShowCameras,
    inspectionShowInk
  ].forEach(control => {
    control.addEventListener('change', () => {
      inspectionViewer?.setLayers(inspectionLayerState());
    });
  });
  inspectionResetView.addEventListener('click', () => inspectionViewer?.resetView());

  multiViewMode.addEventListener('change', () => {
    settings.lidar.multiViewMode = multiViewMode.value === 'combined'
      ? 'combined'
      : 'current';
    if (settings.lidar.multiViewMode === 'combined' && settings.inkSpace === '3d') {
      setInkSpace('2d').catch(error => console.error(error));
    }
    activateMultiViewSource({ historyKey: 'lidar:multiViewMode' });
    refreshButtons();
  });
  multiViewCurrent.addEventListener('change', () => {
    if (!multiViewBundle?.order.includes(multiViewCurrent.value)) return;
    settings.lidar.multiViewCurrent = multiViewCurrent.value;
    activateMultiViewSource({ historyKey: 'lidar:multiViewCurrent' });
    refreshInspectionAfterAcquisition().catch(error => console.error(error));
  });
  multiViewDebugColors.addEventListener('change', () => {
    settings.lidar.multiViewDebugColors = multiViewDebugColors.checked;
    activateMultiViewSource({ historyKey: 'lidar:multiViewDebugColors' });
  });
  undoBtn.addEventListener('click', undoSettings);
  redoBtn.addEventListener('click', redoSettings);

  scanResolution.addEventListener('change', () => {
    settings.lidar.scanResolution = scanResolution.value;
    markScanControlsChanged('lidar:scanResolution');
    refreshButtons();
  });
  raysPerPixel.addEventListener('change', () => {
    settings.lidar.raysPerPixel = Number(raysPerPixel.value);
    markScanControlsChanged('lidar:raysPerPixel');
    refreshButtons();
  });
  smartSampling.addEventListener('change', () => {
    settings.lidar.smartSampling = smartSampling.checked;
    markScanControlsChanged('lidar:smartSampling');
  });

  function bindScanRange(element, key, output, formatter) {
    element.addEventListener('input', () => {
      settings.lidar[key] = Number(element.value);
      output.textContent = formatter(settings.lidar[key]);
      markScanControlsChanged(`lidar:${key}`);
    });
  }
  bindScanRange(cameraYaw, 'cameraYaw', cameraYawValue, value => `${Math.round(value)}°`);
  bindScanRange(cameraElevation, 'cameraElevation', cameraElevationValue, value => `${Math.round(value)}°`);
  bindScanRange(cameraDistance, 'cameraDistance', cameraDistanceValue, value => `${Number(value).toFixed(1)}×`);
  bindScanRange(cameraFov, 'cameraFov', cameraFovValue, value => `${Math.round(value)}°`);

  densitySource.addEventListener('change', () => {
    settings.lidar.densitySource = densitySource.value;
    recomposeLidarSource({ historyKey: 'lidar:densitySource' });
  });
  directionSource.addEventListener('change', () => {
    settings.lidar.directionSource = directionSource.value;
    recomposeLidarSource({ historyKey: 'lidar:directionSource' });
  });
  geometryEdgeStrength.addEventListener('input', () => {
    settings.lidar.geometryEdgeStrength = Number(geometryEdgeStrength.value);
    geometryEdgeStrengthValue.textContent = `${Math.round(settings.lidar.geometryEdgeStrength * 100)}%`;
    recomposeLidarSource({ historyKey: 'lidar:geometryEdgeStrength' });
  });
  depthInfluence.addEventListener('input', () => {
    settings.lidar.depthInfluence = Number(depthInfluence.value);
    depthInfluenceValue.textContent = `${Math.round(settings.lidar.depthInfluence * 100)}%`;
    recomposeLidarSource({ historyKey: 'lidar:depthInfluence' });
  });

  depthContourStrength.addEventListener('input', () => {
    settings.lidar.depthContourStrength = Number(depthContourStrength.value);
    depthContourStrengthValue.textContent =
      `${Math.round(settings.lidar.depthContourStrength * 100)}%`;
    recomposeLidarSource({ historyKey: 'lidar:depthContourStrength' });
  });
  confidenceSmoothing.addEventListener('input', () => {
    settings.lidar.confidenceSmoothing = Number(confidenceSmoothing.value);
    confidenceSmoothingValue.textContent =
      `${Math.round(settings.lidar.confidenceSmoothing * 100)}%`;
    recomposeLidarSource({ historyKey: 'lidar:confidenceSmoothing' });
  });
  useFusedConfidence.addEventListener('change', () => {
    settings.lidar.useFusedConfidence = useFusedConfidence.checked;
    recomposeLidarSource({ historyKey: 'lidar:useFusedConfidence' });
    updateLidarArtControlAvailability(false);
  });
  confidenceLength.addEventListener('input', () => {
    settings.lidar.confidenceLength = Number(confidenceLength.value);
    confidenceLengthValue.textContent =
      `${Math.round(settings.lidar.confidenceLength * 100)}%`;
    markSettingsChanged(true, 'lidar:confidenceLength');
    schedulePreview();
  });
  confidenceOpacity.addEventListener('input', () => {
    settings.lidar.confidenceOpacity = Number(confidenceOpacity.value);
    confidenceOpacityValue.textContent =
      `${Math.round(settings.lidar.confidenceOpacity * 100)}%`;
    markSettingsChanged(true, 'lidar:confidenceOpacity');
    schedulePreview();
  });
  confidenceFragmentation.addEventListener('input', () => {
    settings.lidar.confidenceFragmentation = Number(confidenceFragmentation.value);
    confidenceFragmentationValue.textContent =
      `${Math.round(settings.lidar.confidenceFragmentation * 100)}%`;
    markSettingsChanged(true, 'lidar:confidenceFragmentation');
    schedulePreview();
  });
  cleanBackground.addEventListener('change', () => {
    settings.lidar.cleanBackground = cleanBackground.checked;
    recomposeLidarSource({ historyKey: 'lidar:cleanBackground' });
  });
  objectCenteredFields.addEventListener('change', () => {
    settings.lidar.objectCenteredFields = objectCenteredFields.checked;
    recomposeLidarSource({ historyKey: 'lidar:objectCenteredFields' });
  });

  presetSelect.addEventListener('change', () => {
    if (presetSelect.value !== 'custom') applyPreset(presetSelect.value);
  });

  modeControl.addEventListener('click', e => {
    const btn = e.target.closest('button[data-mode]');
    if (btn) setMode(btn.dataset.mode);
  });

  paletteSelect.addEventListener('change', () => {
    settings.palette = paletteSelect.value;
    syncPaletteAvailability();
    markSettingsChanged(true, 'palette');
    schedulePreview();
  });

  lineCountRange.addEventListener('input', () => setLineCount(lineCountRange.value, true, 'lineCount'));
  lineCountNumber.addEventListener('change', () => setLineCount(lineCountNumber.value, true, 'lineCount'));

  document.querySelector('.quick-counts').addEventListener('click', e => {
    const btn = e.target.closest('button[data-count]');
    if (btn) setLineCount(Number(btn.dataset.count), true, 'lineCount');
  });

  flowScale.addEventListener('input', () => {
    settings.procedural.scale = Number(flowScale.value);
    flowScaleValue.textContent = `${Math.round(settings.procedural.scale)} px`;
    markSettingsChanged(true, 'procedural:scale');
    schedulePreview();
  });

  flowTurbulence.addEventListener('input', () => {
    settings.procedural.turbulence = Number(flowTurbulence.value);
    flowTurbulenceValue.textContent = `${Math.round(settings.procedural.turbulence * 100)}%`;
    markSettingsChanged(true, 'procedural:turbulence');
    schedulePreview();
  });

  flowOctaves.addEventListener('input', () => {
    settings.procedural.octaves = Number(flowOctaves.value);
    flowOctavesValue.textContent = String(settings.procedural.octaves);
    markSettingsChanged(true, 'procedural:octaves');
    schedulePreview();
  });

  for (const def of mixerDefs) {
    const control = mixerControls[def.key];
    control.input.addEventListener('input', () => {
      settings.flowMixer[def.key] = Number(control.input.value);
      control.value.textContent = `${Math.round(settings.flowMixer[def.key] * 100)}%`;
      markSettingsChanged(true, `mixer:${def.key}`);
      schedulePreview();
    });
  }

  seedInput.addEventListener('change', () => {
    settings.seed = normalizeSeed(seedInput.value);
    seedInput.value = settings.seed;
    markSettingsChanged(false, 'seed');
    schedulePreview();
  });

  variationBtn.addEventListener('click', () => {
    settings.seed = randomSeed();
    seedInput.value = settings.seed;
    markSettingsChanged(false, null);
    schedulePreview();
  });

  pngScaleSelect.addEventListener('change', () => {
    recordSettingsChange('export:pngScale');
  });

  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoSettings();
      else undoSettings();
    } else if (key === 'y') {
      event.preventDefault();
      redoSettings();
    }
  });

  renderBtn.addEventListener('click', () => startRender('high'));
  cancelBtn.addEventListener('click', () => stopRender(true));
  saveBtn.addEventListener('click', exporter.savePng);
  saveSvgBtn.addEventListener('click', exporter.saveSvg);

  window.addEventListener('pagehide', () => {
    history.dispose({ flush: true });
    exporter.dispose();
    if (projectDownloadUrl) {
      URL.revokeObjectURL(projectDownloadUrl);
      projectDownloadUrl = null;
    }
    if (sourceCanvas) {
      sourceCanvas.width = 0;
      sourceCanvas.height = 0;
    }
    lidarSourceMaps = null;
    multiViewBundle = null;
  });
})();
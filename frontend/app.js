(() => {
  'use strict';

  const BUILD_VERSION = '5.3-phase1';
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
    seed: 2841
  };

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

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const imageInput = document.getElementById('imageInput');
  const presetSelect = document.getElementById('preset');
  const modeControl = document.getElementById('modeControl');
  const paletteSelect = document.getElementById('palette');
  const lineCountRange = document.getElementById('lineCountRange');
  const lineCountNumber = document.getElementById('lineCountNumber');
  const lineCountDisplay = document.getElementById('lineCountDisplay');
  const slidersRoot = document.getElementById('sliders');
  const seedInput = document.getElementById('seedInput');
  const variationBtn = document.getElementById('variationBtn');
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
  let activeRender = null;

  let displayStrokeStore = null;
  let displayRenderMeta = null;
  let highQualityStrokeStore = null;
  let highQualityRenderMeta = null;
  let highQualityStale = false;

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

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a |= 0;
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function normalizeSeed(v) {
    let n = Math.floor(Number(v));
    if (!Number.isFinite(n)) n = 1;
    n = clamp(n, 1, UINT32_MAX);
    return n >>> 0 || 1;
  }

  function randomSeed() {
    if (globalThis.crypto?.getRandomValues) {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] || 1;
    }
    return ((Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0) || 1;
  }

  function markSettingsChanged(markPreset = true) {
    if (markPreset && settings.preset !== 'custom') {
      settings.preset = 'custom';
      presetSelect.value = 'custom';
    }
    if (highQualityStrokeStore) highQualityStale = true;
    updateExportNote();
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
        markSettingsChanged(true);
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
    syncModeButtons();
    syncPaletteAvailability();
  }

  function applyPreset(name, preview = true) {
    if (!presets[name]) return;
    Object.assign(settings, presets[name]);
    settings.preset = name;
    if (highQualityStrokeStore) highQualityStale = true;
    syncUI();
    updateExportNote();
    if (preview) schedulePreview();
  }

  function setLineCount(value, preview = true) {
    const normalized = clamp(Math.round(Number(value) / 1000) * 1000, 1000, 400000);
    settings.lineCount = normalized;
    lineCountRange.value = normalized;
    lineCountNumber.value = normalized;
    lineCountDisplay.textContent = formatCount(normalized);
    markSettingsChanged(true);
    if (preview) schedulePreview();
  }

  function setMode(mode, preview = true) {
    settings.mode = mode === 'black' ? 'black' : 'color';
    syncModeButtons();
    syncPaletteAvailability();
    markSettingsChanged(true);
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
    seedInput.disabled = locked;
    variationBtn.disabled = locked;
    pngScaleSelect.disabled = locked;
    document.querySelectorAll('.quick-counts button').forEach(btn => btn.disabled = locked);
    modeControl.querySelectorAll('button').forEach(btn => btn.disabled = locked);
    sliderDefs.forEach(def => {
      const el = document.getElementById(def.key);
      if (el) el.disabled = locked;
    });
    if (locked) paletteSelect.disabled = true;
    else syncPaletteAvailability();
  }

  function refreshButtons() {
    const active = !!activeRender;
    const highActive = activeRender?.kind === 'high';
    const exportBusy = exporter.isBusy();
    setHighQualityControlsLocked(highActive || exportBusy);
    renderBtn.disabled = !sourceImage || loadingImage || highActive || exportBusy;
    cancelBtn.disabled = !active;
    const canSave = !active && !loadingImage && !exportBusy && !!getExportTarget();
    saveBtn.disabled = !canSave;
    saveSvgBtn.disabled = !canSave;
    updateExportNote();
  }

  async function decodeBitmap(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (_) {
      return await createImageBitmap(file);
    }
  }

  async function loadImageFile(file) {
    if (!file) return;
    const serial = ++loadSerial;
    stopRender(false);
    clearTimeout(previewTimer);
    previewTimer = 0;
    loadingImage = true;
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

      if (sourceCanvas) {
        sourceCanvas.width = 0;
        sourceCanvas.height = 0;
      }

      sourceCanvas = newSourceCanvas;
      sourcePixels = newPixels;
      luminance = maps.luminance;
      edgeStrength = maps.edgeStrength;
      colorInkNeed = maps.colorInkNeed;
      strokeDirection = maps.strokeDirection;
      directionCoherence = maps.directionCoherence;
      sourceImage = { width: w, height: h };

      renderer.setSource({
        sourceImage,
        sourcePixels,
        luminance,
        edgeStrength,
        colorInkNeed,
        strokeDirection,
        directionCoherence
      });

      displayStrokeStore = null;
      displayRenderMeta = null;
      highQualityStrokeStore = null;
      highQualityRenderMeta = null;
      highQualityStale = false;

      canvas.width = w;
      canvas.height = h;
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      canvas.setAttribute('aria-label', `Generated line-art preview, ${w} by ${h} pixels`);

      emptyState.hidden = true;
      canvasShell.hidden = false;
      loadingImage = false;
      refreshButtons();
      setStatus(`Ready - ${w} x ${h}px. Building direction-aware preview...`, 0);
      startRender('preview');
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
        setStatus('Could not load that image. The previous image is still available.', 0);
      } else {
        emptyState.hidden = false;
        canvasShell.hidden = true;
        setStatus('Could not load that image.', 0);
      }
    }
  }



  function schedulePreview() {
    if (!sourceImage || loadingImage) return;
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
    clearTimeout(previewTimer);
    previewTimer = 0;

    const serial = ++renderSerial;
    const isPreview = kind === 'preview';
    const renderSettings = { ...settings };
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
      rnd: mulberry32(seed),
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
      setStatus(`${label} done - ${formatCount(rs.drawn)} strokes.`, 100);
      setStats(rs.drawn, 100, seconds);
      refreshButtons();
      return;
    }

    requestAnimationFrame(() => renderFrame(serial));
  }

  buildSliders();
  applyPreset('finePencil', false);
  settings.seed = normalizeSeed(seedInput.value);
  syncUI();
  refreshButtons();
  document.body.dataset.phase1Ready = 'true';

  imageInput.addEventListener('change', e => loadImageFile(e.target.files?.[0]));
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
    markSettingsChanged(true);
    schedulePreview();
  });

  lineCountRange.addEventListener('input', () => setLineCount(lineCountRange.value));
  lineCountNumber.addEventListener('change', () => setLineCount(lineCountNumber.value));

  document.querySelector('.quick-counts').addEventListener('click', e => {
    const btn = e.target.closest('button[data-count]');
    if (btn) setLineCount(Number(btn.dataset.count));
  });

  seedInput.addEventListener('change', () => {
    settings.seed = normalizeSeed(seedInput.value);
    seedInput.value = settings.seed;
    markSettingsChanged(false);
    schedulePreview();
  });

  variationBtn.addEventListener('click', () => {
    settings.seed = randomSeed();
    seedInput.value = settings.seed;
    markSettingsChanged(false);
    schedulePreview();
  });

  renderBtn.addEventListener('click', () => startRender('high'));
  cancelBtn.addEventListener('click', () => stopRender(true));
  saveBtn.addEventListener('click', exporter.savePng);
  saveSvgBtn.addEventListener('click', exporter.saveSvg);

  window.addEventListener('pagehide', () => {
    exporter.dispose();
    if (sourceCanvas) {
      sourceCanvas.width = 0;
      sourceCanvas.height = 0;
    }
  });
})();
(() => {
  'use strict';

function formatBytes(bytes) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function estimateSvgBytes(store, meta) {
  if (!store || !meta) return 0;
  const basePerStroke = meta.settings.mode === 'black' ? 31 : 39;
  const extraPoints = Math.max(0, (store.totalPoints || store.count * 2) - store.count * 2);
  return 1800 + store.count * basePerStroke + extraPoints * 12;
}

  function createExporter({
    frameBudgetMs = 11,
    maxStreamPoints = 6,
    svgWarningLines = 100000,
    getExportTarget,
    getScale,
    isRenderActive,
    setStatus,
    setStats,
    refreshButtons,
    formatCount
  }) {
    const FRAME_BUDGET_MS = frameBudgetMs;
    const MAX_STREAM_POINTS = maxStreamPoints;
    const SVG_WARNING_LINES = svgWarningLines;

    let svgExporting = false;
    let pngExporting = false;
    let lastDownloadUrl = null;

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function filenameStem(meta) {
      if (!meta) return 'line-art';
      const suffix = meta.kind === 'preview' ? 'preview' : meta.settings.lineCount;
      return `line-art-${suffix}-seed-${meta.settings.seed}`;
    }

    function triggerDownload(blob, filename) {
      if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
      lastDownloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = lastDownloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    function replayStoreFrame(drawCtx, store, state, deadlineMs) {
      const points = store.points;
      const counts = store.pointCounts;
      const widths = store.widths;
      const rgba = store.rgba;
      let processed = 0;
      while (state.index < store.count && processed < 7000) {
        const i = state.index;
        const base = i * MAX_STREAM_POINTS * 2;
        const ci = i * 4;
        const r = rgba[ci], gg = rgba[ci + 1], b = rgba[ci + 2];
        const key = (r << 16) | (gg << 8) | b;
        let style = state.colorCache.get(key);
        if (!style) {
          style = `rgb(${r},${gg},${b})`;
          if (state.colorCache.size < 8192) state.colorCache.set(key, style);
        }
        drawCtx.strokeStyle = style;
        drawCtx.globalAlpha = rgba[ci + 3] / 255;
        drawCtx.lineWidth = widths[i];
        drawCtx.beginPath();
        drawCtx.moveTo(points[base], points[base + 1]);
        const count = counts[i];
        for (let p = 1; p < count; p++) drawCtx.lineTo(points[base + p * 2], points[base + p * 2 + 1]);
        drawCtx.stroke();
        state.index++;
        processed++;
        if ((processed & 31) === 0 && performance.now() >= deadlineMs) break;
      }
    }

    function savePng() {
      if (isRenderActive() || svgExporting || pngExporting) return;
      const target = getExportTarget();
      if (!target) return;
    
      const store = target.store;
      const meta = target.meta;
      const scale = clamp(Number(getScale()) || 1, 1, 4);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(meta.width * scale));
      out.height = Math.max(1, Math.round(meta.height * scale));
      const outCtx = out.getContext('2d', { alpha: false });
      outCtx.fillStyle = '#ffffff';
      outCtx.fillRect(0, 0, out.width, out.height);
      outCtx.scale(scale, scale);
      outCtx.lineCap = 'round';
      outCtx.lineJoin = 'round';
    
      const state = { index: 0, colorCache: new Map() };
      const started = performance.now();
      const stem = filenameStem(meta);
      pngExporting = true;
      refreshButtons();
      setStatus(`Preparing ${scale}x PNG - 0 / ${formatCount(store.count)} strokes`, 0);
      setStats(0, 0, 0);
    
      function frame() {
        const deadline = performance.now() + FRAME_BUDGET_MS;
        replayStoreFrame(outCtx, store, state, deadline);
        const pct = store.count ? state.index / store.count * 100 : 100;
        const seconds = (performance.now() - started) / 1000;
        setStatus(`Preparing ${scale}x PNG - ${formatCount(state.index)} / ${formatCount(store.count)} strokes`, pct);
        setStats(state.index, pct, seconds);
    
        if (state.index < store.count) {
          requestAnimationFrame(frame);
          return;
        }
    
        outCtx.globalAlpha = 1;
        setStatus(`Encoding ${scale}x PNG...`, 100);
        out.toBlob(blob => {
          if (blob) triggerDownload(blob, `${stem}-${scale}x.png`);
          out.width = 0;
          out.height = 0;
          pngExporting = false;
          const totalSeconds = (performance.now() - started) / 1000;
          setStatus(blob ? `PNG ready - ${scale}x export complete.` : 'PNG export failed.', 100);
          setStats(store.count, 100, totalSeconds);
          refreshButtons();
        }, 'image/png');
      }
    
      requestAnimationFrame(frame);
    }

    function compactNumber(v, digits = 1) {
      const n = Number(v.toFixed(digits));
      return Object.is(n, -0) ? '0' : String(n);
    }

    function quantizeByte(v, step) {
      return clamp(Math.round(v / step) * step, 0, 255);
    }

    function saveSvg() {
      if (isRenderActive() || svgExporting || pngExporting) return;
      const target = getExportTarget();
      if (!target) return;
    
      const store = target.store;
      const meta = target.meta;
      const count = store.count;
      const estimate = estimateSvgBytes(store, meta);
    
      if (count > SVG_WARNING_LINES) {
        const ok = window.confirm(
          `This SVG contains ${formatCount(count)} editable paths and is estimated around ${formatBytes(estimate)}. ` +
          'Large vector files can be slow or unstable in Illustrator, Inkscape, and browsers. Continue?'
        );
        if (!ok) return;
      }
    
      const points = store.points;
      const counts = store.pointCounts;
      const widths = store.widths;
      const rgba = store.rgba;
      const styleMap = new Map();
      const styleRules = [];
      const pathChunks = [];
      let chunk = '';
      let index = 0;
      const exportStart = performance.now();
      const stem = filenameStem(meta);
    
      svgExporting = true;
      refreshButtons();
      setStatus(`Preparing SVG - 0 / ${formatCount(count)} strokes`, 0);
      setStats(0, 0, 0);
    
      function classFor(i) {
        const ci = i * 4;
        const w = Math.max(0.1, Math.round(widths[i] * 10) / 10);
        const a = Math.max(8, quantizeByte(rgba[ci + 3], 8));
        let r = 12, gg = 12, b = 12;
        if (meta.settings.mode !== 'black') {
          r = quantizeByte(rgba[ci], 8);
          gg = quantizeByte(rgba[ci + 1], 8);
          b = quantizeByte(rgba[ci + 2], 8);
        }
        const key = `${r},${gg},${b},${a},${w}`;
        let cls = styleMap.get(key);
        if (!cls) {
          cls = 's' + styleMap.size.toString(36);
          styleMap.set(key, cls);
          styleRules.push(`.${cls}{stroke:rgb(${r},${gg},${b});stroke-width:${compactNumber(w, 1)};stroke-opacity:${compactNumber(a / 255, 3)}}`);
        }
        return cls;
      }
    
      function exportFrame() {
        const frameStart = performance.now();
        let processed = 0;
    
        while (index < count && processed < 7000) {
          const base = index * MAX_STREAM_POINTS * 2;
          const cls = classFor(index);
          const pointCount = counts[index];
          let d = `M${compactNumber(points[base])} ${compactNumber(points[base + 1])}`;
          for (let p = 1; p < pointCount; p++) {
            d += `L${compactNumber(points[base + p * 2])} ${compactNumber(points[base + p * 2 + 1])}`;
          }
          chunk += `<path class="${cls}" d="${d}"/>\n`;
          index++;
          processed++;
    
          if (chunk.length > 65536) {
            pathChunks.push(chunk);
            chunk = '';
          }
          if ((processed & 31) === 0 && performance.now() - frameStart >= FRAME_BUDGET_MS) break;
        }
    
        const pct = count ? index / count * 100 : 100;
        const seconds = (performance.now() - exportStart) / 1000;
        setStatus(`Preparing SVG - ${formatCount(index)} / ${formatCount(count)} strokes`, pct);
        setStats(index, pct, seconds);
    
        if (index < count) {
          requestAnimationFrame(exportFrame);
          return;
        }
    
        if (chunk) pathChunks.push(chunk);
        const header =
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}" viewBox="0 0 ${meta.width} ${meta.height}">\n` +
          `<rect width="${meta.width}" height="${meta.height}" fill="#ffffff"/>\n` +
          `<style>${styleRules.join('')}</style>\n` +
          `<g fill="none" stroke-linecap="round" stroke-linejoin="round">\n`;
        const footer = '</g>\n</svg>\n';
        const blob = new Blob([header, ...pathChunks, footer], { type: 'image/svg+xml;charset=utf-8' });
        triggerDownload(blob, `${stem}.svg`);
        svgExporting = false;
        const totalSeconds = (performance.now() - exportStart) / 1000;
        setStatus(`SVG ready - ${formatCount(count)} editable paths, ${formatBytes(blob.size)}.`, 100);
        setStats(count, 100, totalSeconds);
        refreshButtons();
      }
    
      requestAnimationFrame(exportFrame);
    }

    function isBusy() {
      return svgExporting || pngExporting;
    }

    function dispose() {
      if (lastDownloadUrl) {
        URL.revokeObjectURL(lastDownloadUrl);
        lastDownloadUrl = null;
      }
    }

    return Object.freeze({
      savePng,
      saveSvg,
      isBusy,
      dispose
    });
  }

  window.LineArtExport = Object.freeze({
    createExporter,
    formatBytes,
    estimateSvgBytes
  });
})();

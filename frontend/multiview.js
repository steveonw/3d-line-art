(() => {
  'use strict';

  const VIEW_ORDER = Object.freeze(['front', 'back', 'left', 'right', 'top']);
  const VIEW_COLORS = Object.freeze({
    front: Object.freeze([220, 72, 72]),
    back: Object.freeze([72, 116, 220]),
    left: Object.freeze([72, 170, 112]),
    right: Object.freeze([226, 158, 62]),
    top: Object.freeze([154, 92, 210])
  });

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function combineAxial(sumX, sumY, fallback) {
    if (Math.abs(sumX) + Math.abs(sumY) < 1e-9) return fallback;
    return 0.5 * Math.atan2(sumY, sumX);
  }

  function viewColor(name) {
    if (VIEW_COLORS[name]) return VIEW_COLORS[name];

    let hash = 2166136261;
    const text = String(name || 'view');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }

    const hue = (hash % 360) / 60;
    const chroma = 150;
    const x = chroma * (1 - Math.abs((hue % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hue < 1) [r, g] = [chroma, x];
    else if (hue < 2) [r, g] = [x, chroma];
    else if (hue < 3) [g, b] = [chroma, x];
    else if (hue < 4) [g, b] = [x, chroma];
    else if (hue < 5) [r, b] = [x, chroma];
    else [r, b] = [chroma, x];
    const offset = 55;
    return [
      Math.round(r + offset),
      Math.round(g + offset),
      Math.round(b + offset)
    ];
  }

  function debugColorMapForView(name, count) {
    const color = viewColor(name);
    const out = new Uint8Array(count * 3);
    for (let i = 0; i < count; i++) {
      const base = i * 3;
      out[base] = color[0];
      out[base + 1] = color[1];
      out[base + 2] = color[2];
    }
    return out;
  }

  function combineShadedPixels(entries, width, height) {
    const count = width * height;
    const out = new Uint8ClampedArray(count * 4);
    for (let i = 0; i < count; i++) {
      let bestLum = 255;
      let r = 255, g = 255, b = 255;
      for (const entry of entries) {
        const data = entry.pixels?.data;
        if (!data) continue;
        const p = i * 4;
        const lum = data[p] * 0.2126 + data[p + 1] * 0.7152 + data[p + 2] * 0.0722;
        if (lum < bestLum) {
          bestLum = lum;
          r = data[p];
          g = data[p + 1];
          b = data[p + 2];
        }
      }
      const p = i * 4;
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = 255;
    }
    return out;
  }

  function combineComposedViews(entries, width, height, { debugColors = false } = {}) {
    if (!entries?.length) throw new Error('At least one view is required.');
    const count = width * height;

    const luminance = new Uint8Array(count);
    luminance.fill(255);
    const edgeStrength = new Uint8Array(count);
    const colorInkNeed = new Float32Array(count);
    const strokeDirection = new Float32Array(count);
    const directionCoherence = new Uint8Array(count);
    const depthDirection = new Float32Array(count);
    const depthCoherence = new Uint8Array(count);
    const depthChange = new Uint8Array(count);
    const confidence = new Uint8Array(count);
    const useMask = entries.some(entry => !!entry.maps?.strokeMask);
    const strokeMask = useMask ? new Uint8Array(count) : null;
    const debugColorMap = debugColors ? new Uint8Array(count * 3) : null;

    const centers = entries
      .map(entry => entry.maps?.fieldCenter)
      .filter(center => center && Number.isFinite(center.x) && Number.isFinite(center.y));
    const fieldCenter = centers.length
      ? {
          x: centers.reduce((sum, center) => sum + center.x, 0) / centers.length,
          y: centers.reduce((sum, center) => sum + center.y, 0) / centers.length,
          scale: centers.reduce((sum, center) => sum + (Number(center.scale) || 1), 0) / centers.length
        }
      : null;

    for (let i = 0; i < count; i++) {
      let axialX = 0;
      let axialY = 0;
      let axialWeight = 0;
      let depthX = 0;
      let depthY = 0;
      let depthWeight = 0;
      let dominant = entries[0];
      let dominantScore = -Infinity;
      let maxCoherence = 0;
      let maxDepthCoherence = 0;

      for (const entry of entries) {
        const maps = entry.maps;
        if (!maps || maps.luminance.length !== count) {
          throw new Error('Multi-view map dimensions do not match.');
        }
        if (useMask && maps.strokeMask && !maps.strokeMask[i]) continue;

        if (strokeMask) strokeMask[i] = 1;

        const ink = 1 - maps.luminance[i] / 255;
        const edge = maps.edgeStrength[i] / 255;
        const depth = maps.depthChange ? maps.depthChange[i] / 255 : 0;
        const conf = maps.confidence ? maps.confidence[i] / 255 : 0;
        const coh = maps.directionCoherence[i] / 255;
        const score = ink * 0.60 + edge * 0.20 + depth * 0.12 + conf * 0.08;

        if (score > dominantScore) {
          dominantScore = score;
          dominant = entry;
        }

        luminance[i] = Math.min(luminance[i], maps.luminance[i]);
        edgeStrength[i] = Math.max(edgeStrength[i], maps.edgeStrength[i]);
        colorInkNeed[i] = Math.max(colorInkNeed[i], maps.colorInkNeed[i]);
        depthChange[i] = Math.max(depthChange[i], maps.depthChange?.[i] || 0);
        confidence[i] = Math.max(confidence[i], maps.confidence?.[i] || 0);

        const weight = Math.max(0.001, score) * (0.35 + coh * 0.65);
        axialX += Math.cos(2 * maps.strokeDirection[i]) * weight;
        axialY += Math.sin(2 * maps.strokeDirection[i]) * weight;
        axialWeight += weight;
        maxCoherence = Math.max(maxCoherence, maps.directionCoherence[i]);

        const localDepthCoherence = (maps.depthCoherence?.[i] || 0) / 255;
        if (maps.depthDirection && localDepthCoherence > 0) {
          const w = localDepthCoherence * (0.35 + depth * 0.65);
          depthX += Math.cos(2 * maps.depthDirection[i]) * w;
          depthY += Math.sin(2 * maps.depthDirection[i]) * w;
          depthWeight += w;
          maxDepthCoherence = Math.max(maxDepthCoherence, maps.depthCoherence[i]);
        }
      }

      const fallback = dominant.maps.strokeDirection[i];
      strokeDirection[i] = combineAxial(axialX, axialY, fallback);
      directionCoherence[i] = maxCoherence;

      if (depthWeight > 0) {
        depthDirection[i] = combineAxial(
          depthX,
          depthY,
          dominant.maps.depthDirection?.[i] ?? fallback
        );
        depthCoherence[i] = maxDepthCoherence;
      } else {
        depthDirection[i] = dominant.maps.depthDirection?.[i] ?? fallback;
      }

      if (debugColorMap) {
        const color = viewColor(dominant.name);
        const base = i * 3;
        debugColorMap[base] = color[0];
        debugColorMap[base + 1] = color[1];
        debugColorMap[base + 2] = color[2];
      }
    }

    let eligibleIndices = null;
    if (strokeMask) {
      const values = [];
      for (let i = 0; i < count; i++) {
        if (strokeMask[i]) values.push(i);
      }
      eligibleIndices = new Uint32Array(values);
    }

    return {
      luminance,
      edgeStrength,
      colorInkNeed,
      strokeDirection,
      directionCoherence,
      depthDirection,
      depthCoherence,
      depthChange,
      confidence,
      strokeMask,
      eligibleIndices,
      fieldCenter,
      debugColorMap
    };
  }

  window.LineArtMultiView = Object.freeze({
    VIEW_ORDER,
    VIEW_COLORS,
    viewColor,
    debugColorMapForView,
    combineShadedPixels,
    combineComposedViews
  });
})();

(() => {
  'use strict';

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function boxBlurFloat(source, w, h, radius, output, temp) {
    const diameter = radius * 2 + 1;
  
    // Horizontal moving-window pass with clamped edges.
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = Math.max(0, Math.min(w - 1, k));
        sum += source[row + sx];
      }
      temp[row] = sum / diameter;
  
      for (let x = 1; x < w; x++) {
        const removeX = Math.max(0, Math.min(w - 1, x - radius - 1));
        const addX = Math.max(0, Math.min(w - 1, x + radius));
        sum += source[row + addX] - source[row + removeX];
        temp[row + x] = sum / diameter;
      }
    }
  
    // Vertical moving-window pass with clamped edges.
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = Math.max(0, Math.min(h - 1, k));
        sum += temp[sy * w + x];
      }
      output[x] = sum / diameter;
  
      for (let y = 1; y < h; y++) {
        const removeY = Math.max(0, Math.min(h - 1, y - radius - 1));
        const addY = Math.max(0, Math.min(h - 1, y + radius));
        sum += temp[addY * w + x] - temp[removeY * w + x];
        output[y * w + x] = sum / diameter;
      }
    }
  }
  
  function smoothTensorField(field, w, h, radius, passes, temp, scratch) {
    let input = field;
    let output = scratch;
    for (let pass = 0; pass < passes; pass++) {
      boxBlurFloat(input, w, h, radius, output, temp);
      const swap = input;
      input = output;
      output = swap;
    }
    if (input !== field) field.set(input);
  }
  
  function buildAnalysisMaps(imageData, w, h) {
    const sharp = new Uint8Array(w * h);
    const colorNeed = new Float32Array(w * h);
    const d = imageData.data;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      sharp[p] = Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722);
      // White = 0 ink need. Pale but colorful pixels still ask for marks.
      colorNeed[p] = Math.max(255 - r, 255 - g, 255 - b) / 255;
    }
  
    // A small pre-blur suppresses JPEG grain and single-pixel texture before
    // computing edge direction.
    const tempLum = new Float32Array(w * h);
    const blur = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const xl = x > 0 ? x - 1 : 0;
        const xr = x + 1 < w ? x + 1 : w - 1;
        tempLum[row + x] = (sharp[row + xl] + sharp[row + x] + sharp[row + xr]) / 3;
      }
    }
    for (let y = 0; y < h; y++) {
      const yu = y > 0 ? y - 1 : 0;
      const yd = y + 1 < h ? y + 1 : h - 1;
      const row = y * w;
      const rowU = yu * w;
      const rowD = yd * w;
      for (let x = 0; x < w; x++) {
        blur[row + x] = (tempLum[rowU + x] + tempLum[row + x] + tempLum[rowD + x]) / 3;
      }
    }
  
    const count = w * h;
    const edgeMap = new Uint8Array(count);
    const jxx = new Float32Array(count);
    const jxy = new Float32Array(count);
    const jyy = new Float32Array(count);
  
    // Sobel gradient, immediately converted into structure-tensor terms.
    for (let y = 0; y < h; y++) {
      const yu = y > 0 ? y - 1 : 0;
      const yd = y + 1 < h ? y + 1 : h - 1;
      const row = y * w;
      const rowU = yu * w;
      const rowD = yd * w;
      for (let x = 0; x < w; x++) {
        const xl = x > 0 ? x - 1 : 0;
        const xr = x + 1 < w ? x + 1 : w - 1;
  
        const a00 = blur[rowU + xl], a01 = blur[rowU + x], a02 = blur[rowU + xr];
        const a10 = blur[row + xl],  a12 = blur[row + xr];
        const a20 = blur[rowD + xl], a21 = blur[rowD + x], a22 = blur[rowD + xr];
  
        const gx = -a00 + a02 - 2 * a10 + 2 * a12 - a20 + a22;
        const gy = -a00 - 2 * a01 - a02 + a20 + 2 * a21 + a22;
        const idx = row + x;
        jxx[idx] = gx * gx;
        jxy[idx] = gx * gy;
        jyy[idx] = gy * gy;
        edgeMap[idx] = Math.min(255, Math.round(Math.hypot(gx, gy) * 0.25));
      }
    }
  
    // Smooth the tensor over a wider neighborhood. Two radius-4 passes give
    // nearby strokes a shared local flow without erasing important contours.
    const tensorTemp = new Float32Array(count);
    const tensorScratch = new Float32Array(count);
    const TENSOR_RADIUS = 4;
    const TENSOR_PASSES = 2;
    smoothTensorField(jxx, w, h, TENSOR_RADIUS, TENSOR_PASSES, tensorTemp, tensorScratch);
    smoothTensorField(jxy, w, h, TENSOR_RADIUS, TENSOR_PASSES, tensorTemp, tensorScratch);
    smoothTensorField(jyy, w, h, TENSOR_RADIUS, TENSOR_PASSES, tensorTemp, tensorScratch);
  
    const direction = new Float32Array(count);
    const coherence = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const xx = jxx[i];
      const xy = jxy[i];
      const yy = jyy[i];
      // Principal gradient orientation + 90 degrees gives the local tangent.
      direction[i] = 0.5 * Math.atan2(2 * xy, xx - yy) + Math.PI / 2;
      const denom = xx + yy + 1e-6;
      const coh = Math.hypot(xx - yy, 2 * xy) / denom;
      coherence[i] = Math.round(clamp(coh, 0, 1) * 255);
    }
  
    return {
      luminance: sharp,
      edgeStrength: edgeMap,
      colorInkNeed: colorNeed,
      strokeDirection: direction,
      directionCoherence: coherence
    };
  }


  function buildLidarAnalysisMaps(shadedData, depthData, edgeData, w, h) {
    const base = buildAnalysisMaps(shadedData, w, h);
    const count = w * h;
    const edgeMap = new Uint8Array(count);
    const direction = new Float32Array(base.strokeDirection);
    const coherence = new Uint8Array(base.directionCoherence);
    const depth = new Float32Array(count);

    const dd = depthData.data;
    const ed = edgeData.data;
    for (let p = 0, i = 0; p < count; p++, i += 4) {
      const rawDepth = dd[i];
      depth[p] = rawDepth > 0 ? (rawDepth - 1) / 254 : 0;
      edgeMap[p] = ed[i];
    }

    function depthAt(x, y, fallback) {
      if (x < 0 || y < 0 || x >= w || y >= h) return fallback;
      const value = depth[y * w + x];
      return value > 0 ? value : fallback;
    }

    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const idx = row + x;
        const center = depth[idx];
        if (center <= 0) continue;

        const left = depthAt(x - 1, y, center);
        const right = depthAt(x + 1, y, center);
        const up = depthAt(x, y - 1, center);
        const down = depthAt(x, y + 1, center);
        const gx = right - left;
        const gy = down - up;
        const magnitude = Math.hypot(gx, gy);

        if (magnitude > 1e-5) {
          direction[idx] = Math.atan2(gy, gx) + Math.PI / 2;
          const depthCoherence = clamp(magnitude * 20, 0, 1);
          const imageCoherence = coherence[idx] / 255;
          coherence[idx] = Math.round(
            Math.max(depthCoherence, imageCoherence * 0.45) * 255
          );
        }
      }
    }

    return {
      luminance: base.luminance,
      edgeStrength: edgeMap,
      colorInkNeed: base.colorInkNeed,
      strokeDirection: direction,
      directionCoherence: coherence
    };
  }

  window.LineArtAnalysis = Object.freeze({
    buildAnalysisMaps,
    buildLidarAnalysisMaps
  });
})();

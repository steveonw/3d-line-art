(() => {
  'use strict';

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function boxBlurFloat(source, w, h, radius, output, temp) {
    const diameter = radius * 2 + 1;

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

  function smoothMaskedUint8(source, mask, w, h, radius = 2) {
    const count = w * h;
    const weighted = new Float32Array(count);
    const weights = new Float32Array(count);
    const weightedBlur = new Float32Array(count);
    const weightsBlur = new Float32Array(count);
    const tempA = new Float32Array(count);
    const tempB = new Float32Array(count);
    const out = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
      if (!mask[i]) continue;
      weighted[i] = source[i] / 255;
      weights[i] = 1;
    }

    boxBlurFloat(weighted, w, h, radius, weightedBlur, tempA);
    boxBlurFloat(weights, w, h, radius, weightsBlur, tempB);

    for (let i = 0; i < count; i++) {
      if (!mask[i]) continue;
      const denom = weightsBlur[i];
      const value = denom > 1e-6 ? weightedBlur[i] / denom : weighted[i];
      out[i] = Math.round(clamp(value, 0, 1) * 255);
    }
    return out;
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
      colorNeed[p] = Math.max(255 - r, 255 - g, 255 - b) / 255;
    }

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
        const a10 = blur[row + xl], a12 = blur[row + xr];
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

  function redChannel(imageData, count) {
    const out = new Uint8Array(count);
    const d = imageData.data;
    for (let p = 0, i = 0; p < count; p++, i += 4) out[p] = d[i];
    return out;
  }

  function buildLidarSourceMaps(
    shadedData,
    depthData,
    edgeData,
    varianceData,
    confidenceData,
    w,
    h
  ) {
    const base = buildAnalysisMaps(shadedData, w, h);
    const count = w * h;
    const geometryEdge = redChannel(edgeData, count);
    const variance = redChannel(varianceData, count);
    const confidence = redChannel(confidenceData, count);
    const depth = new Float32Array(count);
    const occupancy = new Uint8Array(count);
    const depthDirection = new Float32Array(base.strokeDirection);
    const depthCoherence = new Uint8Array(count);
    const depthChange = new Uint8Array(count);
    const depthContour = new Uint8Array(count);
    const dd = depthData.data;

    let occupiedCount = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;

    for (let p = 0, i = 0; p < count; p++, i += 4) {
      const raw = dd[i];
      if (raw <= 0) continue;
      depth[p] = (raw - 1) / 254;
      occupancy[p] = 1;
      const x = p % w;
      const y = Math.floor(p / w);
      occupiedCount++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const occupiedIndices = new Uint32Array(occupiedCount);
    for (let i = 0, cursor = 0; i < count; i++) {
      if (occupancy[i]) occupiedIndices[cursor++] = i;
    }

    const objectCenter = occupiedCount
      ? Object.freeze({
          x: sumX / occupiedCount,
          y: sumY / occupiedCount,
          scale: Math.max(
            1,
            Math.max(maxX - minX + 1, maxY - minY + 1) * 0.5
          )
        })
      : Object.freeze({
          x: w * 0.5,
          y: h * 0.5,
          scale: Math.max(1, Math.min(w, h) * 0.5)
        });

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
        const fineMagnitude = Math.hypot(gx, gy);

        const leftWide = depthAt(x - 3, y, center);
        const rightWide = depthAt(x + 3, y, center);
        const upWide = depthAt(x, y - 3, center);
        const downWide = depthAt(x, y + 3, center);
        const wideMagnitude = Math.hypot(
          rightWide - leftWide,
          downWide - upWide
        ) / 3;

        const magnitude = Math.max(fineMagnitude, wideMagnitude);
        const change = clamp(
          Math.max(fineMagnitude * 8, wideMagnitude * 5),
          0,
          1
        );

        // Quantized depth bands keep "Depth Contours" useful on broad smooth
        // surfaces where a pure local gradient otherwise becomes too sparse.
        const contourPosition = center * 12;
        const contourFraction = contourPosition - Math.floor(contourPosition);
        const contourDistance = Math.min(contourFraction, 1 - contourFraction);
        const contourBand = clamp(1 - contourDistance / 0.14, 0, 1);

        depthChange[idx] = Math.round(change * 255);
        depthContour[idx] = Math.round(
          clamp(Math.max(change * 0.65, contourBand * 0.92), 0, 1) * 255
        );

        if (magnitude > 1e-6) {
          depthDirection[idx] = Math.atan2(gy, gx) + Math.PI / 2;
          depthCoherence[idx] = Math.round(clamp(change * 1.6, 0, 1) * 255);
        }
      }
    }

    const confidenceSmoothed = smoothMaskedUint8(
      confidence,
      occupancy,
      w,
      h,
      2
    );

    return Object.freeze({
      width: w,
      height: h,
      toneLuminance: base.luminance,
      toneColorInkNeed: base.colorInkNeed,
      imageDirection: base.strokeDirection,
      imageCoherence: base.directionCoherence,
      geometryEdge,
      depth,
      occupancy,
      occupiedIndices,
      objectCenter,
      depthChange,
      depthContour,
      depthDirection,
      depthCoherence,
      variance,
      confidence,
      confidenceSmoothed
    });
  }

  function axialBlend(a, b, t) {
    if (t <= 0) return a;
    if (t >= 1) return b;
    const x = (1 - t) * Math.cos(2 * a) + t * Math.cos(2 * b);
    const y = (1 - t) * Math.sin(2 * a) + t * Math.sin(2 * b);
    if (Math.abs(x) + Math.abs(y) < 1e-8) return a;
    return 0.5 * Math.atan2(y, x);
  }

  function composeLidarAnalysisMaps(source, options = {}) {
    const count = source.width * source.height;
    const densitySource = options.densitySource || 'tone';
    const directionSource = options.directionSource || 'mixed';
    const edgeScale = clamp(Number(options.geometryEdgeStrength ?? 1), 0, 2);
    const depthInfluence = clamp(Number(options.depthInfluence ?? 0.75), 0, 1);
    const depthContourStrength = clamp(
      Number(options.depthContourStrength ?? 0),
      0,
      1
    );
    const confidenceSmoothing = clamp(
      Number(options.confidenceSmoothing ?? 0),
      0,
      1
    );
    const cleanBackground = !!options.cleanBackground;
    const objectCenteredFields = !!options.objectCenteredFields;

    const luminance = new Uint8Array(count);
    const edgeStrength = new Uint8Array(count);
    const colorInkNeed = new Float32Array(count);
    const strokeDirection = new Float32Array(count);
    const directionCoherence = new Uint8Array(count);
    const confidenceForArt = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
      const occupied = !source.occupancy || !!source.occupancy[i];
      const geom = clamp(source.geometryEdge[i] / 255 * edgeScale, 0, 1);
      const rawDepth = source.depthChange[i] / 255;
      const contourDepth = source.depthContour
        ? source.depthContour[i] / 255
        : rawDepth;
      const depthEvidence = rawDepth * (1 - depthContourStrength) +
        Math.max(rawDepth, contourDepth) * depthContourStrength;
      const depthNeed = clamp(depthEvidence * depthInfluence, 0, 1);
      const rawConf = source.confidence[i] / 255;
      const smoothConf = source.confidenceSmoothed
        ? source.confidenceSmoothed[i] / 255
        : rawConf;
      const conf = rawConf * (1 - confidenceSmoothing) +
        smoothConf * confidenceSmoothing;
      confidenceForArt[i] = Math.round(clamp(conf, 0, 1) * 255);

      if (cleanBackground && !occupied) {
        luminance[i] = 255;
        edgeStrength[i] = 0;
        colorInkNeed[i] = 0;
        strokeDirection[i] = source.imageDirection[i];
        directionCoherence[i] = 0;
        confidenceForArt[i] = 0;
        continue;
      }

      let need;
      if (densitySource === 'geometryEdge') need = geom;
      else if (densitySource === 'depthChange') need = depthNeed;
      else if (densitySource === 'confidence') need = conf;
      else need = 1 - source.toneLuminance[i] / 255;

      if (densitySource === 'tone') {
        luminance[i] = source.toneLuminance[i];
        colorInkNeed[i] = source.toneColorInkNeed[i];
      } else {
        luminance[i] = Math.round((1 - need) * 255);
        colorInkNeed[i] = need;
      }

      edgeStrength[i] = Math.round(geom * 255);

      const imageAngle = source.imageDirection[i];
      const depthAngle = source.depthDirection[i];
      const imageCoh = source.imageCoherence[i] / 255;
      const depthCoh = source.depthCoherence[i] / 255;

      if (directionSource === 'imageStructure') {
        strokeDirection[i] = imageAngle;
        directionCoherence[i] = source.imageCoherence[i];
      } else if (directionSource === 'depthTangent') {
        if (depthCoh > 0.02) {
          strokeDirection[i] = depthAngle;
          directionCoherence[i] = source.depthCoherence[i];
        } else {
          strokeDirection[i] = imageAngle;
          directionCoherence[i] = Math.round(imageCoh * 0.45 * 255);
        }
      } else {
        const mix = clamp(depthInfluence * depthCoh, 0, 1);
        strokeDirection[i] = axialBlend(imageAngle, depthAngle, mix);
        directionCoherence[i] = Math.round(
          clamp(Math.max(imageCoh * (1 - mix), depthCoh * mix), 0, 1) * 255
        );
      }
    }

    return {
      luminance,
      edgeStrength,
      colorInkNeed,
      strokeDirection,
      directionCoherence,
      depthDirection: source.depthDirection,
      depthCoherence: source.depthCoherence,
      depthChange: source.depthChange,
      confidence: confidenceForArt,
      strokeMask: cleanBackground ? source.occupancy : null,
      eligibleIndices: cleanBackground ? source.occupiedIndices : null,
      fieldCenter: objectCenteredFields ? source.objectCenter : null
    };
  }

  // Compatibility helper retained for the Phase 3 call shape.
  function buildLidarAnalysisMaps(shadedData, depthData, edgeData, w, h) {
    const blank = new ImageData(w, h);
    const source = buildLidarSourceMaps(
      shadedData,
      depthData,
      edgeData,
      blank,
      blank,
      w,
      h
    );
    return composeLidarAnalysisMaps(source);
  }

  window.LineArtAnalysis = Object.freeze({
    buildAnalysisMaps,
    buildLidarAnalysisMaps,
    buildLidarSourceMaps,
    composeLidarAnalysisMaps
  });
})();

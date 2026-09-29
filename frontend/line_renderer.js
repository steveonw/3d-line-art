(() => {
  'use strict';

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function confidenceStyleFactors(confidence, lidar = {}) {
    const conf = clamp01(confidence);
    const lengthStrength = clamp01(lidar.confidenceLength);
    const opacityStrength = clamp01(lidar.confidenceOpacity);
    const fragmentationStrength = clamp01(lidar.confidenceFragmentation);
    return Object.freeze({
      lengthScale: 1 - lengthStrength * (1 - conf) * 0.68,
      opacityScale: 1 - opacityStrength * (1 - conf) * 0.78,
      fragmentChance: fragmentationStrength * (1 - conf) * 0.82
    });
  }

  function createRenderer({ ctx, coverageCell = 3, maxStreamPoints = 6 }) {
    const COVERAGE_CELL = coverageCell;
    const MAX_STREAM_POINTS = maxStreamPoints;

    let sourceImage = null;
    let sourcePixels = null;
    let luminance = null;
    let edgeStrength = null;
    let colorInkNeed = null;
    let strokeDirection = null;
    let directionCoherence = null;
    let depthDirection = null;
    let depthCoherence = null;
    let depthChange = null;
    let sensorConfidence = null;
    let strokeMask = null;
    let eligibleIndices = null;
    let fieldCenter = null;
    let debugColorMap = null;

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
    function blend(a, b, t) { return a + (b - a) * t; }

    const RandomField = window.LineArtRandom;
    const MathFields = window.LineArtMathFields;
    const Placement = window.LineArtStrokePlacement;
    if (!RandomField) throw new Error('LineArtRandom must load before line_renderer.js');
    if (!MathFields) throw new Error('LineArtMathFields must load before line_renderer.js');
    if (!Placement) throw new Error('LineArtStrokePlacement must load before line_renderer.js');

    const limitedPalette = [
      [28, 30, 33],
      [219, 79, 70],
      [239, 181, 70],
      [67, 132, 162],
      [116, 139, 93],
      [230, 226, 210]
    ];

    function strokeCandidate(renderSettings, renderState, out) {
      const w = sourceImage.width;
      const h = sourceImage.height;
      const coverage = renderState.coverage;
      const coverageWidth = renderState.coverageWidth;
      const strokeIndex = renderState.drawn | 0;
      const seed = renderState.seed >>> 0;
      const placement = renderState.placement || (
        renderState.placement = Placement.createPlacementState(w, h)
      );
      let bestScore = -Infinity;

      // Six deterministic candidates is still cheap at high line counts, while
      // giving coverage, LiDAR evidence, and spacing enough choices to matter.
      for (let attempt = 0; attempt < 6; attempt++) {
        const channel = attempt * 4;
        const ux = RandomField.randomForIndex(strokeIndex, seed, channel);
        const uy = RandomField.randomForIndex(strokeIndex, seed, channel + 1);
        const scoreJitter = RandomField.randomForIndex(strokeIndex, seed, channel + 2);
        const x = 1 + Math.floor(ux * Math.max(1, w - 2));
        const y = 1 + Math.floor(uy * Math.max(1, h - 2));
        const idx = y * w + x;
        if (strokeMask && !strokeMask[idx]) continue;
        const darkness = 1 - luminance[idx] / 255;
        const edge = edgeStrength[idx] / 255;
        const localDepthChange = depthChange ? depthChange[idx] / 255 : 0;
        const confidence = sensorConfidence ? sensorConfidence[idx] / 255 : 0;

        // In black mode the target is tonal darkness. In color mode, use the
        // per-channel distance from white so pale colors still ask for ink.
        const targetInk = renderSettings.mode === 'color' ? colorInkNeed[idx] : darkness;
        const cellX = Math.floor(x / COVERAGE_CELL);
        const cellY = Math.floor(y / COVERAGE_CELL);
        const cellIndex = cellY * coverageWidth + cellX;
        const existingInk = coverage[cellIndex];
        const remainingNeed = Math.max(0, targetInk - existingInk);
        const spacingClear = Placement.spacingClear(placement, x, y);

        const scores = Placement.scoreCandidate(
          {
            remainingNeed,
            darkness,
            edge,
            depthChange: localDepthChange,
            confidence
          },
          renderSettings,
          spacingClear,
          scoreJitter
        );
        Placement.recordCandidate(placement, remainingNeed, spacingClear);

        if (scores.selectionScore > bestScore) {
          bestScore = scores.selectionScore;
          out.x = x;
          out.y = y;
          out.darkness = darkness;
          out.targetInk = targetInk;
          out.remainingNeed = remainingNeed;
          out.edge = edge;
          out.depthChange = localDepthChange;
          out.confidence = confidence;
          out.spacingClear = spacingClear;
          out.cellIndex = cellIndex;
          out.direction = strokeDirection[idx];
          out.coherence = directionCoherence[idx] / 255;
          out.importance = scores.importance;
          out.qualityScore = scores.qualityScore;
          out.score = scores.selectionScore;
        }
      }

      // A hard clean-background mask can reject all six random candidates.
      // Fall back to one deterministic occupied pixel so line-count prefix
      // stability is preserved without leaking strokes into known empty space.
      if (bestScore === -Infinity && eligibleIndices?.length) {
        const pick = Math.min(
          eligibleIndices.length - 1,
          Math.floor(
            RandomField.randomForIndex(strokeIndex, seed, 97) *
            eligibleIndices.length
          )
        );
        const idx = eligibleIndices[pick];
        const x = idx % w;
        const y = Math.floor(idx / w);
        const darkness = 1 - luminance[idx] / 255;
        const edge = edgeStrength[idx] / 255;
        const localDepthChange = depthChange ? depthChange[idx] / 255 : 0;
        const confidence = sensorConfidence ? sensorConfidence[idx] / 255 : 0;
        const targetInk = renderSettings.mode === 'color' ? colorInkNeed[idx] : darkness;
        const cellX = Math.floor(x / COVERAGE_CELL);
        const cellY = Math.floor(y / COVERAGE_CELL);
        const cellIndex = cellY * coverageWidth + cellX;
        const existingInk = coverage[cellIndex];
        const remainingNeed = Math.max(0, targetInk - existingInk);
        const spacingClear = Placement.spacingClear(placement, x, y);
        const scoreJitter = RandomField.randomForIndex(strokeIndex, seed, 98);
        const scores = Placement.scoreCandidate(
          { remainingNeed, darkness, edge, depthChange: localDepthChange, confidence },
          renderSettings,
          spacingClear,
          scoreJitter
        );
        Placement.recordCandidate(placement, remainingNeed, spacingClear);
        out.x = x;
        out.y = y;
        out.darkness = darkness;
        out.targetInk = targetInk;
        out.remainingNeed = remainingNeed;
        out.edge = edge;
        out.depthChange = localDepthChange;
        out.confidence = confidence;
        out.spacingClear = spacingClear;
        out.cellIndex = cellIndex;
        out.direction = strokeDirection[idx];
        out.coherence = directionCoherence[idx] / 255;
        out.importance = scores.importance;
        out.qualityScore = scores.qualityScore;
        out.score = scores.selectionScore;
        bestScore = scores.selectionScore;
      }

      return bestScore === -Infinity ? null : out;
    }

    function depositCoverage(renderState, x1, y1, x2, y2, alpha, weight) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const distance = Math.hypot(dx, dy);
      // Walk roughly once per coverage cell, not once per pixel. This keeps
      // coverage-aware 400k renders affordable.
      const steps = Math.max(1, Math.ceil(distance / COVERAGE_CELL));
      const amount = alpha * Math.min(1, Math.max(0.15, weight)) / COVERAGE_CELL;
      const gw = renderState.coverageWidth;
      const gh = renderState.coverageHeight;
      const coverage = renderState.coverage;
      let lastCell = -1;
    
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = x1 + dx * t;
        const py = y1 + dy * t;
        const cx = Math.floor(px / COVERAGE_CELL);
        const cy = Math.floor(py / COVERAGE_CELL);
        if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) continue;
        const cell = cy * gw + cx;
        if (cell === lastCell) continue;
        coverage[cell] += amount;
        lastCell = cell;
      }
    }
    
    function applyPaletteTo(out, r, g, b, renderSettings) {
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      const saturation = renderSettings.colorStrength;
      const br = clamp(gray + (r - gray) * saturation, 0, 255);
      const bg = clamp(gray + (g - gray) * saturation, 0, 255);
      const bb = clamp(gray + (b - gray) * saturation, 0, 255);
    
      let pr = br, pg = bg, pb = bb;
      switch (renderSettings.palette) {
        case 'muted':
          pr = blend(br, gray * 0.96 + 18, 0.55);
          pg = blend(bg, gray * 0.94 + 18, 0.55);
          pb = blend(bb, gray * 0.90 + 20, 0.58);
          break;
        case 'warm':
          pr = clamp(br * 1.10 + 12, 0, 255);
          pg = clamp(bg * 1.01 + 3, 0, 255);
          pb = clamp(bb * 0.82, 0, 255);
          break;
        case 'cool':
          pr = clamp(br * 0.84, 0, 255);
          pg = clamp(bg * 1.02 + 4, 0, 255);
          pb = clamp(bb * 1.14 + 10, 0, 255);
          break;
        case 'monochrome': {
          const t = gray / 255;
          pr = 28 + t * 188;
          pg = 35 + t * 188;
          pb = 42 + t * 192;
          break;
        }
        case 'limited': {
          let best = limitedPalette[0];
          let bestD = Infinity;
          for (let i = 0; i < limitedPalette.length; i++) {
            const p = limitedPalette[i];
            const dr = br - p[0], dg = bg - p[1], db = bb - p[2];
            const dist = dr * dr + dg * dg + db * db;
            if (dist < bestD) { bestD = dist; best = p; }
          }
          pr = best[0]; pg = best[1]; pb = best[2];
          break;
        }
        case 'original':
        default:
          break;
      }
    
      const strength = renderSettings.palette === 'original' ? 0 : renderSettings.paletteStrength;
      out[0] = Math.round(clamp(blend(br, pr, strength), 0, 255));
      out[1] = Math.round(clamp(blend(bg, pg, strength), 0, 255));
      out[2] = Math.round(clamp(blend(bb, pb, strength), 0, 255));
      return out;
    }
    
    function createStrokeStore(capacity) {
      return {
        capacity,
        count: 0,
        totalPoints: 0,
        points: new Float32Array(capacity * MAX_STREAM_POINTS * 2),
        pointCounts: new Uint8Array(capacity),
        widths: new Float32Array(capacity),
        rgba: new Uint8Array(capacity * 4)
      };
    }
    
    function recordStroke(store, points, pointCount, width, r, g, b, alphaByte) {
      const i = store.count;
      if (i >= store.capacity) return;
      const base = i * MAX_STREAM_POINTS * 2;
      const ci = i * 4;
      const count = clamp(pointCount | 0, 2, MAX_STREAM_POINTS);
      for (let p = 0; p < count * 2; p++) store.points[base + p] = points[p];
      store.pointCounts[i] = count;
      store.widths[i] = width;
      store.rgba[ci] = r;
      store.rgba[ci + 1] = g;
      store.rgba[ci + 2] = b;
      store.rgba[ci + 3] = alphaByte;
      store.totalPoints += count;
      store.count++;
    }
    
    function rgbStyle(renderState, r, g, b) {
      const key = (r << 16) | (g << 8) | b;
      const cached = renderState.colorCache.get(key);
      if (cached) return cached;
      const style = `rgb(${r},${g},${b})`;
      if (renderState.colorCache.size < 8192) renderState.colorCache.set(key, style);
      return style;
    }
    
    function alignTangent(angle, reference) {
      while (angle - reference > Math.PI / 2) angle -= Math.PI;
      while (angle - reference < -Math.PI / 2) angle += Math.PI;
      return angle;
    }

    function maskAllows(x, y) {
      if (!strokeMask) return true;
      const w = sourceImage.width;
      const h = sourceImage.height;
      const ix = clamp(Math.round(x), 0, w - 1);
      const iy = clamp(Math.round(y), 0, h - 1);
      return !!strokeMask[iy * w + ix];
    }

    function maskedEndpoint(x, y, angle, distance) {
      if (!strokeMask) {
        return {
          x: clamp(x + Math.cos(angle) * distance, 0, sourceImage.width - 1),
          y: clamp(y + Math.sin(angle) * distance, 0, sourceImage.height - 1)
        };
      }

      const steps = Math.max(1, Math.ceil(distance));
      let lastX = x;
      let lastY = y;
      for (let step = 1; step <= steps; step++) {
        const d = distance * (step / steps);
        const nx = clamp(x + Math.cos(angle) * d, 0, sourceImage.width - 1);
        const ny = clamp(y + Math.sin(angle) * d, 0, sourceImage.height - 1);
        if (!maskAllows(nx, ny)) break;
        lastX = nx;
        lastY = ny;
      }
      return { x: lastX, y: lastY };
    }

    function mixedFieldAngleAt(x, y, baseAngle, renderState) {
      const w = sourceImage.width;
      const h = sourceImage.height;
      const ix = clamp(Math.round(x), 0, w - 1);
      const iy = clamp(Math.round(y), 0, h - 1);
      const idx = iy * w + ix;
      const localDepthAngle = depthDirection ? depthDirection[idx] : null;
      const localDepthCoherence = depthCoherence ? depthCoherence[idx] / 255 : 0;

      return MathFields.composeAngle({
        x,
        y,
        width: w,
        height: h,
        seed: renderState.seed,
        baseAngle,
        depthAngle: localDepthAngle,
        depthCoherence: localDepthCoherence,
        procedural: renderState.settings.procedural,
        mixer: renderState.settings.flowMixer,
        fieldCenter
      });
    }
    
    function fieldAngleAt(x, y, reference, renderSettings, renderState, channel) {
      const w = sourceImage.width;
      const h = sourceImage.height;
      const ix = clamp(Math.round(x), 0, w - 1);
      const iy = clamp(Math.round(y), 0, h - 1);
      const idx = iy * w + ix;
      const coherence = directionCoherence[idx] / 255;
      let angle = coherence >= 0.30 ? strokeDirection[idx] : Math.PI / 4;
      angle = mixedFieldAngleAt(x, y, angle, renderState);
      angle = alignTangent(angle, reference);
      if (renderSettings.angleQuantize > 0) {
        angle = Math.round(angle / renderSettings.angleQuantize) * renderSettings.angleQuantize;
        angle = alignTangent(angle, reference);
      }
      const noiseScale = coherence >= 0.30 ? (0.18 + coherence * 0.30) : 0.16;
      const localNoise = RandomField.signedRandomAt(
        x,
        y,
        renderState.seed,
        channel + (renderState.drawn | 0) * 17
      );
      angle += localNoise * 0.5 * renderSettings.directionNoise * noiseScale;
      return angle;
    }
    
    function buildStrokePath(renderState, candidate, length, out) {
      const s = renderState.settings;
      const flow = clamp(s.flowStrength, 0, 1);
    
      // Flow = 0 exactly preserves the 5.2 straight-stroke behavior.
      if (flow <= 0.001) {
        let angle = candidate.coherence >= 0.30 ? candidate.direction : Math.PI / 4;
        angle = mixedFieldAngleAt(candidate.x, candidate.y, angle, renderState);
        const localNoise = RandomField.signedRandomAt(
          candidate.x,
          candidate.y,
          renderState.seed,
          101 + (renderState.drawn | 0) * 17
        );
        angle += candidate.coherence >= 0.30
          ? localNoise * 0.5 * s.directionNoise * (0.55 + candidate.coherence * 0.45)
          : localNoise * 0.5 * (0.10 + s.directionNoise * 0.22);
        if (s.angleQuantize > 0) angle = Math.round(angle / s.angleQuantize) * s.angleQuantize;
        const half = length * 0.5;
        const left = maskedEndpoint(candidate.x, candidate.y, angle + Math.PI, half);
        const right = maskedEndpoint(candidate.x, candidate.y, angle, half);
        out[0] = left.x;
        out[1] = left.y;
        out[2] = right.x;
        out[3] = right.y;
        return 2;
      }
    
      // 3-5 short steps create a curved streamline while keeping each stroke
      // compact enough to remain pencil-like and cheap to export as SVG.
      const segments = clamp(3 + Math.round(flow * 2), 3, 5);
      const leftSteps = Math.floor(segments / 2);
      const rightSteps = segments - leftSteps;
      const stepLength = length / segments;
      const back = renderState.backScratch;
      const fwd = renderState.fwdScratch;
    
      back[0] = candidate.x; back[1] = candidate.y;
      fwd[0] = candidate.x; fwd[1] = candidate.y;
    
      let bx = candidate.x, by = candidate.y;
      let bAngle = (candidate.coherence >= 0.30 ? candidate.direction : Math.PI / 4) + Math.PI;
      let backCount = 1;
      for (let i = 0; i < leftSteps; i++) {
        const local = fieldAngleAt(bx, by, bAngle, s, renderState, 200 + i);
        bAngle += (local - bAngle) * flow;
        let nx = bx + Math.cos(bAngle) * stepLength;
        let ny = by + Math.sin(bAngle) * stepLength;
        const clampedX = clamp(nx, 0, sourceImage.width - 1);
        const clampedY = clamp(ny, 0, sourceImage.height - 1);
        if (!maskAllows(clampedX, clampedY)) break;
        back[backCount * 2] = clampedX;
        back[backCount * 2 + 1] = clampedY;
        backCount++;
        bx = clampedX; by = clampedY;
        if (clampedX !== nx || clampedY !== ny) break;
      }
    
      let fx = candidate.x, fy = candidate.y;
      let fAngle = candidate.coherence >= 0.30 ? candidate.direction : Math.PI / 4;
      let fwdCount = 1;
      for (let i = 0; i < rightSteps; i++) {
        const local = fieldAngleAt(fx, fy, fAngle, s, renderState, 300 + i);
        fAngle += (local - fAngle) * flow;
        let nx = fx + Math.cos(fAngle) * stepLength;
        let ny = fy + Math.sin(fAngle) * stepLength;
        const clampedX = clamp(nx, 0, sourceImage.width - 1);
        const clampedY = clamp(ny, 0, sourceImage.height - 1);
        if (!maskAllows(clampedX, clampedY)) break;
        fwd[fwdCount * 2] = clampedX;
        fwd[fwdCount * 2 + 1] = clampedY;
        fwdCount++;
        fx = clampedX; fy = clampedY;
        if (clampedX !== nx || clampedY !== ny) break;
      }
    
      let pointCount = 0;
      for (let i = backCount - 1; i >= 1; i--) {
        out[pointCount * 2] = back[i * 2];
        out[pointCount * 2 + 1] = back[i * 2 + 1];
        pointCount++;
      }
      out[pointCount * 2] = candidate.x;
      out[pointCount * 2 + 1] = candidate.y;
      pointCount++;
      for (let i = 1; i < fwdCount && pointCount < MAX_STREAM_POINTS; i++) {
        out[pointCount * 2] = fwd[i * 2];
        out[pointCount * 2 + 1] = fwd[i * 2 + 1];
        pointCount++;
      }
      if (pointCount < 2) {
        // The mask blocked both first steps: emit a zero-length stroke rather
        // than letting the renderer read the previous stroke's stale point.
        out[2] = candidate.x;
        out[3] = candidate.y;
        pointCount = 2;
      }
      return pointCount;
    }
    
    function depositPathCoverage(renderState, points, pointCount, alpha, weight) {
      const gw = renderState.coverageWidth;
      const gh = renderState.coverageHeight;
      const coverage = renderState.coverage;
      const amount = alpha * Math.min(1, Math.max(0.15, weight)) / COVERAGE_CELL;
      let lastCell = -1;
    
      for (let p = 0; p < pointCount - 1; p++) {
        const x1 = points[p * 2], y1 = points[p * 2 + 1];
        const x2 = points[(p + 1) * 2], y2 = points[(p + 1) * 2 + 1];
        const dx = x2 - x1, dy = y2 - y1;
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / COVERAGE_CELL));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const cx = Math.floor((x1 + dx * t) / COVERAGE_CELL);
          const cy = Math.floor((y1 + dy * t) / COVERAGE_CELL);
          if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) continue;
          const cell = cy * gw + cx;
          if (cell === lastCell) continue;
          coverage[cell] += amount;
          lastCell = cell;
        }
      }
    }
    
    function drawOneStroke(renderState) {
      const s = renderState.settings;
      const c = strokeCandidate(s, renderState, renderState.candidate);
      if (!c) return false;
      const importance = c.importance;
      const styleConfidence = sensorConfidence ? clamp(c.confidence, 0, 1) : 1;
      const styleFactors = confidenceStyleFactors(
        styleConfidence,
        s.lidar || {}
      );
      const lengthJitter = RandomField.randomForIndex(
        renderState.drawn | 0,
        renderState.seed,
        64
      );
      const fragmentRoll = RandomField.randomForIndex(
        renderState.drawn | 0,
        renderState.seed,
        65
      );
      if (fragmentRoll < styleFactors.fragmentChance) {
        Placement.recordSelection(renderState.placement, c);
        return true;
      }

      const len =
        s.strokeLength *
        (0.40 + importance * 0.95) *
        (0.72 + lengthJitter * 0.56) *
        styleFactors.lengthScale;

      // Preview amplification affects appearance, not the coverage solver. This
      // keeps the candidate prefix stable when only requested line count changes.
      const baseWeight = Math.max(0.12, s.strokeWeight * (0.34 + importance * 0.88));
      const weight = baseWeight * renderState.previewWeightMultiplier;
      const baseAlpha = clamp(
        s.opacity * (0.28 + importance * 0.83) * styleFactors.opacityScale,
        0.02,
        1
      );
      const alpha = clamp(baseAlpha * renderState.previewOpacityMultiplier, 0.02, 1);
      const alphaByte = Math.round(alpha * 255);
    
      const path = renderState.pathScratch;
      const pointCount = buildStrokePath(renderState, c, len, path);
    
      let r = 12, g = 12, b = 12;
      if (debugColorMap) {
        const idx = (c.y * sourceImage.width + c.x) * 3;
        r = debugColorMap[idx];
        g = debugColorMap[idx + 1];
        b = debugColorMap[idx + 2];
        ctx.strokeStyle = rgbStyle(renderState, r, g, b);
      } else if (s.mode !== 'black') {
        const idx = (c.y * sourceImage.width + c.x) * 4;
        const d = sourcePixels.data;
        applyPaletteTo(renderState.colorScratch, d[idx], d[idx + 1], d[idx + 2], s);
        r = renderState.colorScratch[0];
        g = renderState.colorScratch[1];
        b = renderState.colorScratch[2];
        ctx.strokeStyle = rgbStyle(renderState, r, g, b);
      }
    
      ctx.globalAlpha = alphaByte / 255;
      ctx.lineWidth = weight;
      ctx.beginPath();
      ctx.moveTo(path[0], path[1]);
      for (let p = 1; p < pointCount; p++) ctx.lineTo(path[p * 2], path[p * 2 + 1]);
      ctx.stroke();
    
      depositPathCoverage(renderState, path, pointCount, baseAlpha, baseWeight);
      Placement.recordSelection(renderState.placement, c);
      recordStroke(renderState.strokes, path, pointCount, weight, r, g, b, alphaByte);
      return true;
    }

    function setSource(next) {
      sourceImage = next.sourceImage;
      sourcePixels = next.sourcePixels;
      luminance = next.luminance;
      edgeStrength = next.edgeStrength;
      colorInkNeed = next.colorInkNeed;
      strokeDirection = next.strokeDirection;
      directionCoherence = next.directionCoherence;
      depthDirection = next.depthDirection || null;
      depthCoherence = next.depthCoherence || null;
      depthChange = next.depthChange || null;
      sensorConfidence = next.confidence || null;
      strokeMask = next.strokeMask || null;
      eligibleIndices = next.eligibleIndices || null;
      fieldCenter = next.fieldCenter || null;
      debugColorMap = next.debugColorMap || null;
    }

    return Object.freeze({
      setSource,
      createStrokeStore,
      drawOneStroke,
      summarizePlacement: renderState => renderState?.placement
        ? Placement.summarize(renderState.placement)
        : null
    });
  }

  window.LineArtRenderer = Object.freeze({
    createRenderer,
    confidenceStyleFactors
  });
})();

(() => {
  'use strict';

  const Random = window.LineArtRandom;
  const Procedural = window.LineArtProceduralFlow;
  if (!Random) throw new Error('LineArtRandom must load before math_fields.js');
  if (!Procedural) throw new Error('LineArtProceduralFlow must load before math_fields.js');

  const TAU = Math.PI * 2;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function angleToVector(angle) {
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  function normalizeVector(x, y, fallbackAngle = 0) {
    const length = Math.hypot(x, y);
    if (length <= 1e-12) return angleToVector(fallbackAngle);
    return { x: x / length, y: y / length };
  }

  function axialVector(angle, weight = 1) {
    return {
      x: Math.cos(2 * angle) * weight,
      y: Math.sin(2 * angle) * weight
    };
  }

  function mixAxial(fields, fallbackAngle = 0) {
    let x = 0;
    let y = 0;
    let total = 0;
    for (const field of fields) {
      const weight = Math.max(0, Number(field?.weight ?? 0));
      if (!weight || !Number.isFinite(field?.angle)) continue;
      const v = axialVector(field.angle, weight);
      x += v.x;
      y += v.y;
      total += weight;
    }
    if (total <= 1e-12 || Math.hypot(x, y) <= 1e-12) return fallbackAngle;
    return 0.5 * Math.atan2(y, x);
  }

  function centered(x, y, width, height, center = null) {
    const cx = Number.isFinite(center?.x) ? center.x : width * 0.5;
    const cy = Number.isFinite(center?.y) ? center.y : height * 0.5;
    const scale = Number.isFinite(center?.scale) && center.scale > 0
      ? center.scale
      : Math.max(1, Math.min(width, height) * 0.5);
    return {
      dx: (x - cx) / scale,
      dy: (y - cy) / scale,
      radius: Math.hypot(x - cx, y - cy) / scale,
      theta: Math.atan2(y - cy, x - cx)
    };
  }

  function polarTangent(theta, radius, drdTheta, fallbackAngle) {
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const dx = drdTheta * cos - radius * sin;
    const dy = drdTheta * sin + radius * cos;
    const vector = normalizeVector(dx, dy, fallbackAngle);
    return Math.atan2(vector.y, vector.x);
  }

  function radialFlow(x, y, width, height, center = null) {
    return centered(x, y, width, height, center).theta;
  }

  function vortexFlow(x, y, width, height, center = null) {
    return radialFlow(x, y, width, height, center) + Math.PI / 2;
  }

  function spiralFlow(x, y, width, height, pitch = 0.62, center = null) {
    const p = centered(x, y, width, height, center);
    const blend = clamp(Number(pitch), 0, 1);
    return p.theta + blend * (Math.PI / 2);
  }

  function waveFlow(x, y, width, height, seed) {
    const nx = width > 0 ? x / width : 0;
    const ny = height > 0 ? y / height : 0;
    const phase = Random.randomForIndex(0, seed, 9101) * TAU;
    const cycles = 2.5 + Random.randomForIndex(1, seed, 9101) * 1.5;
    const slope = 1.15 * Math.cos((nx * cycles + ny * 0.35) * TAU + phase);
    return Math.atan2(slope, 1);
  }

  function roseFlow(x, y, width, height, petals = 5, center = null) {
    const p = centered(x, y, width, height, center);
    const k = Math.max(2, Math.round(Number(petals) || 5));
    const r = Math.cos(k * p.theta);
    const dr = -k * Math.sin(k * p.theta);
    return polarTangent(p.theta, r, dr, p.theta + Math.PI / 2);
  }

  function cardioidFlow(x, y, width, height, center = null) {
    const p = centered(x, y, width, height, center);
    const r = 1 - Math.cos(p.theta);
    const dr = Math.sin(p.theta);
    return polarTangent(p.theta, r, dr, p.theta + Math.PI / 2);
  }

  function logarithmicSpiralFlow(x, y, width, height, growth = 0.24, center = null) {
    const p = centered(x, y, width, height, center);
    const b = clamp(Number(growth), 0.05, 1);
    // r = exp(b*theta), so dr/dtheta = b*r. The common r factor cancels.
    return polarTangent(p.theta, 1, b, p.theta + Math.PI / 2);
  }

  function fieldAnglesAt(x, y, width, height, seed, center = null) {
    return Object.freeze({
      radial: radialFlow(x, y, width, height, center),
      vortex: vortexFlow(x, y, width, height, center),
      spiral: spiralFlow(x, y, width, height, 0.62, center),
      wave: waveFlow(x, y, width, height, seed),
      rose: roseFlow(x, y, width, height, 5, center),
      cardioid: cardioidFlow(x, y, width, height, center),
      logSpiral: logarithmicSpiralFlow(x, y, width, height, 0.24, center)
    });
  }

  function composeAngle({
    x,
    y,
    width,
    height,
    seed,
    baseAngle,
    depthAngle = null,
    depthCoherence = 0,
    procedural = null,
    mixer = null,
    fieldCenter = null
  }) {
    const m = mixer || {};
    const fields = [];

    const surfaceWeight = clamp(Number(m.surface ?? 1), 0, 1);
    const depthWeight = clamp(Number(m.depth ?? 0), 0, 1) * clamp(Number(depthCoherence), 0, 1);

    if (surfaceWeight > 0) {
      fields.push({ angle: baseAngle, weight: surfaceWeight });
    }
    if (depthWeight > 0 && Number.isFinite(depthAngle)) {
      fields.push({ angle: depthAngle, weight: depthWeight });
    }

    const math = fieldAnglesAt(x, y, width, height, seed, fieldCenter);
    const mathEmphasis = clamp(Number(m.mathEmphasis ?? 1), 0.25, 3);
    for (const key of ['radial', 'vortex', 'spiral', 'wave', 'rose', 'cardioid', 'logSpiral']) {
      const weight = clamp(Number(m[key] ?? 0), 0, 1) * mathEmphasis;
      if (weight > 0) fields.push({ angle: math[key], weight });
    }

    let angle = mixAxial(fields, baseAngle);

    const proceduralWeight = clamp(Number(m.procedural ?? 1), 0, 1);
    if (proceduralWeight > 0 && procedural) {
      angle += Procedural.proceduralFlow(
        x,
        y,
        seed,
        {
          scale: procedural.scale,
          turbulence: procedural.turbulence * proceduralWeight,
          octaves: procedural.octaves
        }
      );
    }

    return angle;
  }

  window.LineArtMathFields = Object.freeze({
    angleToVector,
    normalizeVector,
    axialVector,
    mixAxial,
    radialFlow,
    vortexFlow,
    spiralFlow,
    waveFlow,
    roseFlow,
    cardioidFlow,
    logarithmicSpiralFlow,
    fieldAnglesAt,
    composeAngle
  });
})();

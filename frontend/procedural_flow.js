(() => {
  'use strict';

  const Random = window.LineArtRandom;
  if (!Random) throw new Error('LineArtRandom must load before procedural_flow.js');

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

  function gradientDot(ix, iy, x, y, seed, channel) {
    const angle = Random.randomAt(ix, iy, seed, channel) * Math.PI * 2;
    const gx = Math.cos(angle);
    const gy = Math.sin(angle);
    return gx * (x - ix) + gy * (y - iy);
  }

  function gradientNoise2D(x, y, seed, channel = 0) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const tx = x - x0;
    const ty = y - y0;
    const u = fade(tx);
    const v = fade(ty);

    const n00 = gradientDot(x0, y0, x, y, seed, channel);
    const n10 = gradientDot(x1, y0, x, y, seed, channel);
    const n01 = gradientDot(x0, y1, x, y, seed, channel);
    const n11 = gradientDot(x1, y1, x, y, seed, channel);

    const nx0 = lerp(n00, n10, u);
    const nx1 = lerp(n01, n11, u);
    return clamp(lerp(nx0, nx1, v) * 1.41421356237, -1, 1);
  }

  function fbm2D(x, y, seed, options = {}) {
    const scale = Math.max(1, Number(options.scale ?? 120));
    const octaves = clamp(Math.round(Number(options.octaves ?? 4)), 1, 7);
    const lacunarity = Math.max(1.1, Number(options.lacunarity ?? 2));
    const gain = clamp(Number(options.gain ?? 0.5), 0.1, 0.9);
    const channel = Number(options.channel ?? 0) | 0;

    let frequency = 1 / scale;
    let amplitude = 1;
    let total = 0;
    let normalization = 0;

    for (let octave = 0; octave < octaves; octave++) {
      total += gradientNoise2D(
        x * frequency,
        y * frequency,
        seed,
        channel + octave * 101
      ) * amplitude;
      normalization += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return normalization > 0 ? clamp(total / normalization, -1, 1) : 0;
  }

  function proceduralFlow(x, y, seed, options = {}) {
    const turbulence = clamp(Number(options.turbulence ?? 0), 0, 1);
    if (turbulence <= 0) return 0;

    // A smooth multi-octave angle offset. Max turbulence bends the local
    // direction by up to roughly 90 degrees while preserving the base field.
    const value = fbm2D(x, y, seed, {
      scale: options.scale,
      octaves: options.octaves,
      lacunarity: 2,
      gain: 0.5,
      channel: 7001
    });
    return value * turbulence * (Math.PI / 2);
  }

  window.LineArtProceduralFlow = Object.freeze({
    gradientNoise2D,
    fbm2D,
    proceduralFlow
  });
})();

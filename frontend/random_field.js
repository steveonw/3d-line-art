(() => {
  'use strict';

  // Independent deterministic hash implementation for LiDAR Ink Studio.
  // The design goal is coordinate/index stability: asking for one random value
  // never advances hidden global state or changes later values.
  const UINT32_SCALE = 1 / 4294967296;
  const COORD_SCALE = 16;

  function mix32(value) {
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
  }

  function fold(seed, value, salt) {
    const v = (value | 0) ^ (salt | 0);
    return mix32((seed >>> 0) ^ Math.imul(v, 0x9e3779b1));
  }

  function quantizeCoordinate(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * COORD_SCALE) | 0;
  }

  function randomForIndex(index, seed, channel = 0) {
    let h = mix32(seed >>> 0);
    h = fold(h, index | 0, 0x51ed270b);
    h = fold(h, channel | 0, 0x68bc21eb);
    return h * UINT32_SCALE;
  }

  function randomAt(x, y, seed, channel = 0) {
    let h = mix32(seed >>> 0);
    h = fold(h, quantizeCoordinate(x), 0x02e5be93);
    h = fold(h, quantizeCoordinate(y), 0x7f4a7c15);
    h = fold(h, channel | 0, 0x165667b1);
    return h * UINT32_SCALE;
  }

  function signedRandomAt(x, y, seed, channel = 0) {
    return randomAt(x, y, seed, channel) * 2 - 1;
  }

  function signedRandomForIndex(index, seed, channel = 0) {
    return randomForIndex(index, seed, channel) * 2 - 1;
  }

  window.LineArtRandom = Object.freeze({
    randomAt,
    randomForIndex,
    signedRandomAt,
    signedRandomForIndex
  });
})();

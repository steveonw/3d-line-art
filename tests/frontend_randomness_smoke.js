const fs = require('fs');
const vm = require('vm');

const randomCode = fs.readFileSync('frontend/random_field.js', 'utf8');
const proceduralCode = fs.readFileSync('frontend/procedural_flow.js', 'utf8');
const rendererCode = fs.readFileSync('frontend/line_renderer.js', 'utf8');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(randomCode, context, { filename: 'random_field.js' });
vm.runInContext(proceduralCode, context, { filename: 'procedural_flow.js' });
vm.runInContext(rendererCode, context, { filename: 'line_renderer.js' });

const R = context.window.LineArtRandom;
const Renderer = context.window.LineArtRenderer;

if (!R?.randomAt || !R?.randomForIndex) {
  throw new Error('stable randomness exports are missing');
}
if (!Renderer?.createRenderer) {
  throw new Error('renderer export is missing');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const seed = 2841;
const probeA = [
  R.randomAt(10.25, 9.75, seed, 0),
  R.randomAt(18.5, 4.125, seed, 2),
  R.randomAt(1, 1, seed, 99),
  R.randomForIndex(1234, seed, 7)
];

// Make unrelated calls in a different order. Stateless hashing means the
// original probes must not change.
R.randomForIndex(999999, seed, 22);
R.randomAt(500, 700, seed + 1, 3);
R.randomAt(-3.25, 8.5, seed, 11);

const probeB = [
  R.randomAt(10.25, 9.75, seed, 0),
  R.randomAt(18.5, 4.125, seed, 2),
  R.randomAt(1, 1, seed, 99),
  R.randomForIndex(1234, seed, 7)
];

assert(
  probeA.every((value, index) => value === probeB[index]),
  'random values changed because of call order'
);
assert(
  R.randomAt(10.25, 9.75, seed, 0) !== R.randomAt(10.25, 9.75, seed + 1, 0),
  'different seeds should produce different local variation'
);
assert(
  R.randomAt(10.25, 9.75, seed, 0) !== R.randomAt(10.25, 9.75, seed, 1),
  'different channels should decorrelate local variation'
);

const width = 32;
const height = 24;
const count = width * height;
const pixels = new Uint8ClampedArray(count * 4);
const luminance = new Uint8Array(count);
const edgeStrength = new Uint8Array(count);
const colorInkNeed = new Float32Array(count);
const strokeDirection = new Float32Array(count);
const directionCoherence = new Uint8Array(count);

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const p = y * width + x;
    const i = p * 4;
    const tone = Math.round(40 + (x / (width - 1)) * 180);
    pixels[i] = tone;
    pixels[i + 1] = Math.min(255, tone + 12);
    pixels[i + 2] = Math.max(0, tone - 10);
    pixels[i + 3] = 255;
    luminance[p] = tone;
    edgeStrength[p] = (x === 10 || y === 12) ? 220 : 20;
    colorInkNeed[p] = 1 - tone / 255;
    strokeDirection[p] = (x / width) * Math.PI;
    directionCoherence[p] = 210;
  }
}

function fakeContext() {
  return {
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: '#000',
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {}
  };
}

const renderer = Renderer.createRenderer({
  ctx: fakeContext(),
  coverageCell: 3,
  maxStreamPoints: 6
});
renderer.setSource({
  sourceImage: { width, height },
  sourcePixels: { data: pixels },
  luminance,
  edgeStrength,
  colorInkNeed,
  strokeDirection,
  directionCoherence
});

const settings = {
  mode: 'black',
  palette: 'original',
  strokeLength: 7,
  strokeWeight: 1,
  detail: 1.9,
  opacity: 0.55,
  colorStrength: 1,
  paletteStrength: 1,
  directionNoise: 0.35,
  angleQuantize: 0,
  sampleBias: 0.7,
  flowStrength: 0.65,
  procedural: { scale: 120, turbulence: 0, octaves: 4 }
};

function renderPrefix(target, previewOpacityMultiplier = 1, previewWeightMultiplier = 1) {
  const coverageWidth = Math.ceil(width / 3);
  const coverageHeight = Math.ceil(height / 3);
  const state = {
    settings: { ...settings },
    seed,
    drawn: 0,
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
    pathScratch: new Float32Array(12),
    backScratch: new Float32Array(12),
    fwdScratch: new Float32Array(12),
    previewOpacityMultiplier,
    previewWeightMultiplier
  };

  for (let i = 0; i < target; i++) {
    state.drawn = i;
    renderer.drawOneStroke(state);
  }
  return state.strokes;
}

function comparePrefix(a, b, prefix, { compareAppearance = true } = {}) {
  for (let i = 0; i < prefix; i++) {
    assert(a.pointCounts[i] === b.pointCounts[i], `point count changed at stroke ${i}`);
    const points = a.pointCounts[i] * 2;
    const base = i * 12;
    for (let p = 0; p < points; p++) {
      assert(a.points[base + p] === b.points[base + p], `path changed at stroke ${i}, point ${p}`);
    }
    if (compareAppearance) {
      assert(a.widths[i] === b.widths[i], `width changed at stroke ${i}`);
      const colorBase = i * 4;
      for (let k = 0; k < 4; k++) {
        assert(a.rgba[colorBase + k] === b.rgba[colorBase + k], `RGBA changed at stroke ${i}`);
      }
    }
  }
}

const shortRun = renderPrefix(40);
const longRun = renderPrefix(80);
comparePrefix(shortRun, longRun, 40);

const repeatRun = renderPrefix(40);
comparePrefix(shortRun, repeatRun, 40);

// Preview amplification may change visible width/opacity, but it must no longer
// perturb coverage decisions and therefore must preserve the same geometry.
const amplifiedPreview = renderPrefix(40, 2.5, 1.15);
comparePrefix(shortRun, amplifiedPreview, 40, { compareAppearance: false });

console.log('frontend stable-randomness smoke test passed');

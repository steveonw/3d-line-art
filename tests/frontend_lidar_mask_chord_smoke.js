const fs = require('fs');
const vm = require('vm');

const files = [
  'frontend/random_field.js',
  'frontend/procedural_flow.js',
  'frontend/math_fields.js',
  'frontend/stroke_placement.js',
  'frontend/line_renderer.js'
];

const context = { window: {}, console };
vm.createContext(context);
for (const file of files) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

const R = context.window.LineArtRenderer;
if (!R?.createRenderer) throw new Error('renderer export is missing');

const ctx = {
  globalAlpha: 1,
  lineWidth: 1,
  strokeStyle: '#000',
  beginPath() {},
  moveTo() {},
  lineTo() {},
  stroke() {}
};

// Regression: when the clean-background mask blocks the first step in both
// directions, a stroke has one real point. The renderer must not pad it with
// the previous stroke's stale coordinates, which drew long chords across empty
// space between separate parts of the object.
const width = 24;
const height = 24;
const count = width * height;
const mask = new Uint8Array(count);
const eligible = [];
// Isolated single-pixel islands: every first step leaves the mask.
for (const [x, y] of [[3, 3], [20, 3], [3, 20], [20, 20], [12, 12]]) {
  const idx = y * width + x;
  mask[idx] = 1;
  eligible.push(idx);
}

const sourcePixels = { data: new Uint8ClampedArray(count * 4) };
for (let i = 0; i < sourcePixels.data.length; i += 4) {
  sourcePixels.data[i] = 20;
  sourcePixels.data[i + 1] = 20;
  sourcePixels.data[i + 2] = 20;
  sourcePixels.data[i + 3] = 255;
}

const renderer = R.createRenderer({ ctx, coverageCell: 3, maxStreamPoints: 6 });
renderer.setSource({
  sourceImage: { width, height },
  sourcePixels,
  luminance: new Uint8Array(count),
  edgeStrength: new Uint8Array(count),
  colorInkNeed: new Float32Array(count).fill(1),
  strokeDirection: new Float32Array(count),
  directionCoherence: new Uint8Array(count).fill(255),
  depthDirection: null,
  depthCoherence: null,
  depthChange: new Uint8Array(count),
  confidence: new Uint8Array(count).fill(255),
  strokeMask: mask,
  eligibleIndices: new Uint32Array(eligible),
  fieldCenter: { x: 12, y: 12, scale: 6 }
});

const settings = {
  mode: 'black',
  palette: 'original',
  detail: 1.5,
  sampleBias: 0.8,
  strokeLength: 8,
  strokeWeight: 0.8,
  opacity: 0.4,
  colorStrength: 1,
  paletteStrength: 1,
  directionNoise: 0,
  angleQuantize: 0,
  flowStrength: 1,
  procedural: { scale: 120, turbulence: 0, octaves: 4 },
  flowMixer: {
    surface: 1,
    depth: 0,
    procedural: 0,
    radial: 0,
    vortex: 0,
    spiral: 0,
    wave: 0,
    rose: 0,
    cardioid: 0,
    logSpiral: 0,
    mathEmphasis: 1
  }
};

const target = 64;
const coverageWidth = Math.ceil(width / 3);
const coverageHeight = Math.ceil(height / 3);
const state = {
  drawn: 0,
  settings,
  seed: 2841,
  strokes: renderer.createStrokeStore(target),
  candidate: {
    x: 0, y: 0, darkness: 0, targetInk: 0, remainingNeed: 0,
    edge: 0, depthChange: 0, confidence: 0, cellIndex: 0,
    direction: 0, coherence: 0, importance: 0, score: 0
  },
  coverageWidth,
  coverageHeight,
  coverage: new Float32Array(coverageWidth * coverageHeight),
  colorScratch: new Uint16Array(3),
  colorCache: new Map(),
  pathScratch: new Float32Array(12),
  backScratch: new Float32Array(12),
  fwdScratch: new Float32Array(12),
  previewOpacityMultiplier: 1,
  previewWeightMultiplier: 1
};

for (let i = 0; i < target; i++) {
  renderer.drawOneStroke(state);
  state.drawn++;
}

function inMask(x, y) {
  const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
  return !!mask[iy * width + ix];
}

for (let i = 0; i < state.strokes.count; i++) {
  const pointCount = state.strokes.pointCounts[i];
  const base = i * 6 * 2;
  for (let p = 0; p < pointCount - 1; p++) {
    const x1 = state.strokes.points[base + p * 2];
    const y1 = state.strokes.points[base + p * 2 + 1];
    const x2 = state.strokes.points[base + (p + 1) * 2];
    const y2 = state.strokes.points[base + (p + 1) * 2 + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
    for (let t = 0; t <= steps; t++) {
      const x = x1 + (x2 - x1) * (t / steps);
      const y = y1 + (y2 - y1) * (t / steps);
      if (!inMask(x, y)) {
        throw new Error(
          `stroke ${i} segment ${p} crosses known-empty space ` +
          `(${x1.toFixed(1)},${y1.toFixed(1)}) -> (${x2.toFixed(1)},${y2.toFixed(1)})`
        );
      }
    }
  }
}

console.log('frontend LiDAR mask chord smoke test passed');

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

const width = 9;
const height = 9;
const count = width * height;
const mask = new Uint8Array(count);
const eligible = [];
for (let y = 3; y <= 5; y++) {
  for (let x = 3; x <= 5; x++) {
    const idx = y * width + x;
    mask[idx] = 1;
    eligible.push(idx);
  }
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
  fieldCenter: { x: 4, y: 4, scale: 2 }
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

if (state.strokes.count !== target) {
  throw new Error(`clean-mask renderer recorded ${state.strokes.count}/${target} strokes`);
}

for (let i = 0; i < state.strokes.count; i++) {
  const pointCount = state.strokes.pointCounts[i];
  const base = i * 6 * 2;
  for (let p = 0; p < pointCount; p++) {
    const x = Math.max(0, Math.min(width - 1, Math.round(state.strokes.points[base + p * 2])));
    const y = Math.max(0, Math.min(height - 1, Math.round(state.strokes.points[base + p * 2 + 1])));
    if (!mask[y * width + x]) {
      throw new Error(`stroke ${i} escaped clean background mask at ${x},${y}`);
    }
  }
}

console.log('frontend LiDAR polish renderer smoke test passed');

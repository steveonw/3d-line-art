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

const Renderer = context.window.LineArtRenderer;
if (!Renderer?.createRenderer) throw new Error('renderer export is missing');

const ctx = {
  globalAlpha: 1,
  lineWidth: 1,
  strokeStyle: '#000',
  beginPath() {},
  moveTo() {},
  lineTo() {},
  stroke() {}
};

const width = 8;
const height = 8;
const count = width * height;
const sourcePixels = { data: new Uint8ClampedArray(count * 4).fill(255) };
const debugColorMap = new Uint8Array(count * 3);
for (let i = 0; i < count; i++) {
  const base = i * 3;
  debugColorMap[base] = 72;
  debugColorMap[base + 1] = 170;
  debugColorMap[base + 2] = 112;
}

const renderer = Renderer.createRenderer({ ctx, coverageCell: 3, maxStreamPoints: 6 });
renderer.setSource({
  sourceImage: { width, height },
  sourcePixels,
  luminance: new Uint8Array(count).fill(40),
  edgeStrength: new Uint8Array(count),
  colorInkNeed: new Float32Array(count).fill(0.8),
  strokeDirection: new Float32Array(count),
  directionCoherence: new Uint8Array(count).fill(255),
  depthChange: new Uint8Array(count),
  confidence: new Uint8Array(count).fill(200),
  debugColorMap
});

const target = 12;
const settings = {
  mode: 'black',
  palette: 'original',
  detail: 1.5,
  sampleBias: 0.8,
  strokeLength: 4,
  strokeWeight: 0.8,
  opacity: 0.5,
  colorStrength: 1,
  paletteStrength: 1,
  directionNoise: 0,
  angleQuantize: 0,
  flowStrength: 0,
  procedural: { scale: 120, turbulence: 0, octaves: 4 },
  flowMixer: {
    surface: 1, depth: 0, procedural: 0,
    radial: 0, vortex: 0, spiral: 0, wave: 0,
    rose: 0, cardioid: 0, logSpiral: 0, mathEmphasis: 1
  }
};

const coverageWidth = Math.ceil(width / 3);
const coverageHeight = Math.ceil(height / 3);
const state = {
  drawn: 0,
  settings,
  seed: 99,
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
  throw new Error('debug-color render did not record all strokes');
}
for (let i = 0; i < target; i++) {
  const base = i * 4;
  if (
    state.strokes.rgba[base] !== 72 ||
    state.strokes.rgba[base + 1] !== 170 ||
    state.strokes.rgba[base + 2] !== 112
  ) {
    throw new Error('per-view debug color did not override black ink mode');
  }
}

console.log('frontend multi-view debug renderer smoke test passed');

const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('frontend/index.html', 'utf8');
const app = fs.readFileSync('frontend/app.js', 'utf8');
const analysis = fs.readFileSync('frontend/analysis_maps.js', 'utf8');

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const refs = [...app.matchAll(/getElementById\('([^']+)'\)/g)].map(match => match[1]);
const dynamicIds = new Set(['colorStrength', 'paletteStrength']);
const missing = [...new Set(refs.filter(id => !ids.has(id) && !dynamicIds.has(id)))];
if (missing.length) {
  throw new Error('Missing DOM ids: ' + missing.join(', '));
}

const context = { window: {} };
vm.createContext(context);
vm.runInContext(analysis, context, { filename: 'analysis_maps.js' });
const A = context.window.LineArtAnalysis;
if (!A?.buildLidarSourceMaps || !A?.composeLidarAnalysisMaps) {
  throw new Error('LiDAR analysis exports are missing');
}

const w = 5;
const h = 5;
const count = w * h;

function imageData(fn) {
  const data = new Uint8ClampedArray(count * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      const value = fn(x, y);
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { data };
}

const shaded = imageData((x, y) => Math.max(0, 255 - (x + y) * 20));
const depth = imageData(x => 1 + Math.round(x / (w - 1) * 254));
const edge = imageData(x => x === 2 ? 255 : 0);
const variance = imageData(x => x === 4 ? 200 : 20);
const confidence = imageData(x => x < 4 ? 220 : 40);

const source = A.buildLidarSourceMaps(
  shaded,
  depth,
  edge,
  variance,
  confidence,
  w,
  h
);

const edgeMode = A.composeLidarAnalysisMaps(source, {
  densitySource: 'geometryEdge',
  directionSource: 'mixed',
  geometryEdgeStrength: 1.5,
  depthInfluence: 0.8
});

const depthMode = A.composeLidarAnalysisMaps(source, {
  densitySource: 'depthChange',
  directionSource: 'depthTangent',
  geometryEdgeStrength: 0.5,
  depthInfluence: 1
});

for (const [name, values] of Object.entries(edgeMode)) {
  if (values.length !== count) throw new Error(`${name} has the wrong length`);
}

const center = 2 * w + 2;
if (edgeMode.edgeStrength[center] !== 255) {
  throw new Error('Geometry edge strength did not saturate as expected');
}
if (255 - edgeMode.luminance[center] !== 255) {
  throw new Error('Geometry edge density did not drive target ink');
}
if (!Number.isFinite(depthMode.strokeDirection[center])) {
  throw new Error('Depth tangent direction is not finite');
}
if (source.confidence[2 * w + 1] !== 220) {
  throw new Error('Confidence map was not preserved');
}

console.log('frontend LiDAR map smoke test passed');

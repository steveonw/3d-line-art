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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const w = 7;
const h = 7;
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

const shaded = imageData((x, y) => Math.max(0, 255 - (x + y) * 16));
// x=0 is known no-hit background; x=1..6 is a smooth depth ramp.
const depth = imageData(x => x === 0 ? 0 : 1 + Math.round((x - 1) / (w - 2) * 254));
const edge = imageData(x => x === 3 ? 255 : 0);
const variance = imageData(x => x === 6 ? 200 : 20);
// Deliberately speckled confidence over the occupied region.
const confidence = imageData((x, y) => x === 0 ? 0 : ((x + y) % 2 ? 255 : 32));

const source = A.buildLidarSourceMaps(
  shaded,
  depth,
  edge,
  variance,
  confidence,
  w,
  h
);

assert(source.occupancy[3 * w] === 0, 'no-hit background was not preserved');
assert(source.occupancy[3 * w + 1] === 1, 'occupied depth pixel was lost');
assert(source.occupiedIndices.length === h * (w - 1), 'occupied index list is wrong');
assert(source.objectCenter.x > w * 0.5, 'object center did not move toward occupied region');
assert(source.objectCenter.scale > 0, 'object field scale is invalid');

const edgeMode = A.composeLidarAnalysisMaps(source, {
  densitySource: 'geometryEdge',
  directionSource: 'mixed',
  geometryEdgeStrength: 1.5,
  depthInfluence: 0.8
});

const legacyDepthMode = A.composeLidarAnalysisMaps(source, {
  densitySource: 'depthChange',
  directionSource: 'depthTangent',
  geometryEdgeStrength: 0.5,
  depthInfluence: 1,
  depthContourStrength: 0
});

const contourDepthMode = A.composeLidarAnalysisMaps(source, {
  densitySource: 'depthChange',
  directionSource: 'depthTangent',
  geometryEdgeStrength: 0.5,
  depthInfluence: 1,
  depthContourStrength: 1
});

const rawConfidenceMode = A.composeLidarAnalysisMaps(source, {
  densitySource: 'confidence',
  confidenceSmoothing: 0
});
const smoothConfidenceMode = A.composeLidarAnalysisMaps(source, {
  densitySource: 'confidence',
  confidenceSmoothing: 1
});

const cleanMode = A.composeLidarAnalysisMaps(source, {
  densitySource: 'tone',
  cleanBackground: true,
  objectCenteredFields: true
});

for (const [name, values] of Object.entries(edgeMode)) {
  if (ArrayBuffer.isView(values) && values.length !== count) {
    throw new Error(`${name} has the wrong length`);
  }
}

const center = 3 * w + 3;
assert(edgeMode.edgeStrength[center] === 255, 'Geometry edge strength did not saturate');
assert(255 - edgeMode.luminance[center] === 255, 'Geometry edge density did not drive target ink');
assert(Number.isFinite(legacyDepthMode.strokeDirection[center]), 'Depth tangent direction is not finite');

let contourGain = 0;
for (let i = 0; i < count; i++) {
  if (!source.occupancy[i]) continue;
  contourGain = Math.max(
    contourGain,
    (255 - contourDepthMode.luminance[i]) - (255 - legacyDepthMode.luminance[i])
  );
}
assert(contourGain > 20, 'Contour coverage did not add useful smooth-surface density');

function roughness(mode) {
  let total = 0;
  let pairs = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w - 1; x++) {
      const a = 255 - mode.luminance[y * w + x];
      const b = 255 - mode.luminance[y * w + x + 1];
      total += Math.abs(a - b);
      pairs++;
    }
  }
  return total / Math.max(1, pairs);
}
assert(
  roughness(smoothConfidenceMode) < roughness(rawConfidenceMode),
  'Confidence smoothing did not reduce cell-scale speckle'
);

const background = 3 * w;
assert(cleanMode.luminance[background] === 255, 'clean background still asks for tone ink');
assert(cleanMode.edgeStrength[background] === 0, 'clean background still exposes edge evidence');
assert(cleanMode.strokeMask[background] === 0, 'clean background mask did not exclude no-hit pixel');
assert(cleanMode.strokeMask[center] === 1, 'clean background mask excluded occupied pixel');
assert(cleanMode.eligibleIndices.length === source.occupiedIndices.length, 'clean mask eligible list changed');
assert(cleanMode.fieldCenter === source.objectCenter, 'object-centered field metadata was not forwarded');

for (const id of [
  'depthContourStrength', 'depthContourStrengthValue',
  'confidenceSmoothing', 'confidenceSmoothingValue',
  'cleanBackground', 'objectCenteredFields'
]) {
  assert(html.includes(`id="${id}"`), `missing LiDAR polish control ${id}`);
}

console.log('frontend LiDAR map smoke test passed');

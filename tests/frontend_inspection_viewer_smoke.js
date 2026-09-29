const fs = require('fs');
const vm = require('vm');

const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync('frontend/inspection_viewer.js', 'utf8'),
  context,
  { filename: 'frontend/inspection_viewer.js' }
);

const Viewer = context.window.LineArtInspectionViewer;
if (!Viewer?.createInspectionViewer) throw new Error('inspection viewer factory missing');
if (!Viewer?.confidenceRgb) throw new Error('inspection confidence color helper missing');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const low = Viewer.confidenceRgb(0);
const mid = Viewer.confidenceRgb(0.5);
const high = Viewer.confidenceRgb(1);
assert(low.length === 3 && high.length === 3, 'confidence color must be RGB');
assert(low[0] > mid[0] && mid[0] > high[0], 'red channel should fall with confidence');
assert(low[1] < mid[1] && mid[1] < high[1], 'green channel should rise with confidence');
assert(Viewer.confidenceRgb(-2)[0] === low[0], 'confidence color should clamp low');
assert(Viewer.confidenceRgb(9)[1] === high[1], 'confidence color should clamp high');

assert(typeof Viewer.buildInkSegments === 'function', 'ink segment builder missing');
const inkSnapshot = {
  positions: [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  stroke_offsets: [0, 3],
  stroke_counts: [3, 2],
  stroke_rgba: [40, 40, 40, 76, 200, 60, 20, 255]
};
const ink = Viewer.buildInkSegments(inkSnapshot, 1);
assert(ink.positions.length === (2 + 1) * 2 * 3, 'ink should emit one segment per consecutive point pair');
assert(ink.colors.length === (ink.positions.length / 3) * 4, 'ink colors must be RGBA per vertex');
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) < tolerance;
assert(near(ink.colors[0], 40 / 255), 'faint stroke RGB must not be premultiplied by alpha');
assert(near(ink.colors[3], 76 / 255), 'faint stroke must carry its own alpha');
const lastStroke = ink.colors.slice(-4);
assert(near(lastStroke[0], 200 / 255) && near(lastStroke[3], 1), 'opaque stroke RGBA should be preserved');
assert(ink.positions[2] > 0, 'ink should be lifted along the surface normal for display');
assert(
  Viewer.buildInkSegments({ stroke_offsets: [0], stroke_counts: [1] }, 1).positions.length === 0,
  'single-point strokes emit no segments'
);

assert(typeof Viewer.orbitFromCameraView === 'function', 'camera framing helper missing');
const framed = Viewer.orbitFromCameraView({
  position: [3, 4, 5],
  target: [1, 1, 1],
  fov: 62
});
assert(near(framed.radius, Math.sqrt(29)), 'camera framing should preserve scan camera distance');
assert(framed.target.join(',') === '1,1,1', 'camera framing should preserve scan target');
assert(near(framed.fov, 62), 'camera framing should preserve scan vertical FOV');
const sinPhi = Math.sin(framed.phi);
const rebuilt = [
  framed.target[0] + framed.radius * sinPhi * Math.sin(framed.theta),
  framed.target[1] + framed.radius * Math.cos(framed.phi),
  framed.target[2] + framed.radius * sinPhi * Math.cos(framed.theta)
];
assert(rebuilt.every((value, i) => near(value, [3, 4, 5][i])), 'orbit framing must reconstruct scan camera position');

const html = fs.readFileSync('frontend/index.html', 'utf8');
assert(
  html.includes('vendor/three.r128.min.js'),
  '3D inspector must load the vendored offline Three.js build'
);
assert(
  !/cdn\.jsdelivr|cdnjs\.cloudflare/.test(
    html.split('inspection_viewer.js')[0].slice(-1000)
  ),
  '3D inspector should not require a CDN'
);

console.log('frontend inspection viewer smoke test passed');

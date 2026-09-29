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

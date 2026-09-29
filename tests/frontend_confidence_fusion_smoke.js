const fs = require('fs');
const vm = require('vm');

const context = { window: {}, console };
vm.createContext(context);
for (const file of ['frontend/analysis_maps.js', 'frontend/line_renderer.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

const Analysis = context.window.LineArtAnalysis;
const Renderer = context.window.LineArtRenderer;
if (!Analysis?.withConfidence) throw new Error('withConfidence export missing');
if (!Renderer?.confidenceStyleFactors) throw new Error('confidenceStyleFactors export missing');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const width = 5;
const height = 5;
const count = width * height;
const occupancy = new Uint8Array(count).fill(1);
const source = Object.freeze({
  width,
  height,
  occupancy,
  confidence: new Uint8Array(count),
  confidenceSmoothed: new Uint8Array(count)
});
const replacement = new Uint8Array(count);
replacement[12] = 255;
const replaced = Analysis.withConfidence(source, replacement);
assert(replaced !== source, 'confidence replacement should return a new source map object');
assert(replaced.confidence[12] === 255, 'fused confidence did not replace the source map');
assert(replaced.confidenceSmoothed[12] > 0, 'fused confidence smoothing was not rebuilt');
assert(source.confidence[12] === 0, 'confidence replacement mutated the original source map');

const settings = {
  confidenceLength: 1,
  confidenceOpacity: 1,
  confidenceFragmentation: 1
};
const high = Renderer.confidenceStyleFactors(1, settings);
const mid = Renderer.confidenceStyleFactors(0.5, settings);
const low = Renderer.confidenceStyleFactors(0, settings);

assert(high.lengthScale === 1, 'high confidence should preserve stroke length');
assert(high.opacityScale === 1, 'high confidence should preserve opacity');
assert(high.fragmentChance === 0, 'high confidence should not fragment');
assert(low.lengthScale < mid.lengthScale && mid.lengthScale < high.lengthScale,
  'stroke length should increase monotonically with confidence');
assert(low.opacityScale < mid.opacityScale && mid.opacityScale < high.opacityScale,
  'opacity should increase monotonically with confidence');
assert(low.fragmentChance > mid.fragmentChance && mid.fragmentChance > high.fragmentChance,
  'fragmentation should decrease monotonically with confidence');

const disabled = Renderer.confidenceStyleFactors(0, {
  confidenceLength: 0,
  confidenceOpacity: 0,
  confidenceFragmentation: 0
});
assert(disabled.lengthScale === 1, 'zero confidence-length strength changed legacy output');
assert(disabled.opacityScale === 1, 'zero confidence-opacity strength changed legacy output');
assert(disabled.fragmentChance === 0, 'zero fragmentation strength changed legacy output');

console.log('frontend confidence fusion smoke test passed');

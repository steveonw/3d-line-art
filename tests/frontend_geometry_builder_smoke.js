const fs = require('fs');
const vm = require('vm');

const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync('frontend/geometry_builder.js', 'utf8'),
  context,
  { filename: 'frontend/geometry_builder.js' }
);

const Builder = context.window.LineArtGeometryBuilder;
if (!Builder?.buildSpec || !Builder?.parseProfile) {
  throw new Error('geometry builder helpers missing');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sphere = Builder.buildSpec({
  type: 'sphere',
  radius: '1.25',
  segments: '24',
  rings: '12'
});
assert(sphere.type === 'sphere', 'sphere type missing');
assert(sphere.radius === 1.25, 'sphere radius parsing failed');
assert(sphere.segments === 24 && sphere.rings === 12, 'sphere detail parsing failed');

const box = Builder.buildSpec({
  type: 'box',
  width: '2',
  height: '3',
  depth: '4'
});
assert(box.width === 2 && box.height === 3 && box.depth === 4, 'box dimensions failed');

const cylinder = Builder.buildSpec({
  type: 'cylinder',
  radius: '0.8',
  height: '2.4',
  segments: '18'
});
assert(cylinder.radius === 0.8 && cylinder.segments === 18, 'cylinder parsing failed');

const lathe = Builder.buildSpec({
  type: 'lathe',
  segments: '20',
  profile: '0,-1; 0.7,-0.7; 1,0; 0.5,0.8; 0,1'
});
assert(lathe.profile.length === 5, 'lathe profile point count failed');
assert(lathe.profile[2][0] === 1 && lathe.profile[2][1] === 0, 'lathe profile parsing failed');

const field = Builder.buildSpec({
  type: 'heightfield',
  width: '4',
  depth: '3',
  amplitude: '0.6',
  frequency: '2.5',
  grid: '30',
  pattern: 'ripple'
});
assert(field.pattern === 'ripple' && field.grid === 30, 'height field options failed');

let rejected = false;
try {
  Builder.parseProfile('0,-1; broken; 0,1');
} catch (_) {
  rejected = true;
}
assert(rejected, 'malformed lathe profile should be rejected');

const html = fs.readFileSync('frontend/index.html', 'utf8');
for (const id of [
  'geometryType',
  'geometryProfile',
  'geometryPattern',
  'generateGeometryBtn'
]) {
  assert(html.includes(`id="${id}"`), `missing geometry UI control ${id}`);
}
assert(html.includes('geometry_builder.js'), 'geometry builder script is not loaded');

console.log('frontend geometry builder smoke test passed');

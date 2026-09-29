const fs = require('fs');
const vm = require('vm');

const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync('frontend/ink3d.js', 'utf8'),
  context,
  { filename: 'frontend/ink3d.js' }
);

const Ink3D = context.window.LineArtInk3D;
if (!Ink3D?.buildProjectionPayload || !Ink3D?.validateSnapshot) {
  throw new Error('3D Ink helpers missing');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const store = {
  capacity: 3,
  count: 3,
  points: new Float32Array([
    1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0,
    5, 6, 7, 8, 9, 10, 0, 0, 0, 0, 0, 0,
    11, 12, 13, 14, 15, 16, 17, 18, 0, 0, 0, 0
  ]),
  pointCounts: new Uint8Array([2, 3, 4]),
  widths: new Float32Array([0.5, 1, 1.5]),
  rgba: new Uint8Array([
    10, 20, 30, 40,
    50, 60, 70, 80,
    90, 100, 110, 120
  ])
};
const meta = { width: 320, height: 240 };
const payload = Ink3D.buildProjectionPayload(store, meta, 'scan-a', { maxStrokes: 2 });
assert(payload.scan_id === 'scan-a', 'scan id should be preserved');
assert(payload.point_counts.length === 2, 'projection should keep a deterministic stroke prefix');
assert(payload.point_counts[0] === 2 && payload.point_counts[1] === 3, 'point counts should be preserved');
assert(payload.points.length === 10, 'points should be packed without unused capacity');
assert(payload.rgba.length === 8, 'style bytes should be packed per stroke');
assert(payload.widths[1] === 1, 'stroke widths should be preserved');

const snapshot = {
  format: 'lidar-ink-3d-strokes',
  version: 1,
  point_count: 2,
  stroke_count: 1,
  positions: [0, 0, 0, 1, 0, 0],
  normals: [0, 1, 0, 0, 1, 0],
  tangents: [1, 0, 0, 1, 0, 0],
  depth: [1, 1],
  confidence: [200, 210],
  material_rgb: [180, 180, 180, 180, 180, 180],
  piece_ids: [1000, 1000],
  stroke_offsets: [0],
  stroke_counts: [2],
  stroke_widths: [1],
  stroke_rgba: [12, 12, 12, 220]
};
assert(Ink3D.validateSnapshot(snapshot) === snapshot, 'valid snapshots should round-trip');

let rejected = false;
try {
  Ink3D.validateSnapshot({ ...snapshot, normals: [0, 1, 0] });
} catch (_) {
  rejected = true;
}
assert(rejected, 'inconsistent world metadata must be rejected');

console.log('frontend 3D Ink smoke test passed');

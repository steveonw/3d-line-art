const fs = require('fs');
const vm = require('vm');

const randomCode = fs.readFileSync('frontend/random_field.js', 'utf8');
const proceduralCode = fs.readFileSync('frontend/procedural_flow.js', 'utf8');
const mathCode = fs.readFileSync('frontend/math_fields.js', 'utf8');
const html = fs.readFileSync('frontend/index.html', 'utf8');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(randomCode, context, { filename: 'random_field.js' });
vm.runInContext(proceduralCode, context, { filename: 'procedural_flow.js' });
vm.runInContext(mathCode, context, { filename: 'math_fields.js' });

const M = context.window.LineArtMathFields;
if (!M?.composeAngle || !M?.mixAxial) {
  throw new Error('mathematical flow exports are missing');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function axialDistance(a, b) {
  return Math.abs(0.5 * Math.atan2(Math.sin(2 * (a - b)), Math.cos(2 * (a - b))));
}

const width = 200;
const height = 120;
const cx = width / 2;
const cy = height / 2;
const seed = 2841;

assert(axialDistance(M.radialFlow(cx + 50, cy, width, height), 0) < 1e-9, 'radial field is incorrect');
assert(axialDistance(M.vortexFlow(cx + 50, cy, width, height), Math.PI / 2) < 1e-9, 'vortex field is incorrect');

const spiral = M.spiralFlow(cx + 50, cy, width, height);
assert(Number.isFinite(spiral), 'spiral field is not finite');
assert(axialDistance(spiral, 0) > 0.2, 'spiral should differ from radial');
assert(axialDistance(spiral, Math.PI / 2) > 0.2, 'spiral should differ from vortex');

const waveA = M.waveFlow(35, 42, width, height, seed);
const waveB = M.waveFlow(35, 42, width, height, seed);
const waveOtherSeed = M.waveFlow(35, 42, width, height, seed + 1);
assert(waveA === waveB, 'wave field is not deterministic');
assert(waveA !== waveOtherSeed, 'wave seed should affect phase');

for (const [name, angle] of Object.entries({
  rose: M.roseFlow(130, 35, width, height),
  cardioid: M.cardioidFlow(130, 35, width, height),
  logSpiral: M.logarithmicSpiralFlow(130, 35, width, height)
})) {
  assert(Number.isFinite(angle), `${name} field is not finite`);
}

const base = 0.22;
const surfaceOnly = M.composeAngle({
  x: 140, y: 60, width, height, seed,
  baseAngle: base,
  procedural: { scale: 120, turbulence: 0.8, octaves: 4 },
  mixer: {
    surface: 1, depth: 0, procedural: 0,
    radial: 0, vortex: 0, spiral: 0, wave: 0,
    rose: 0, cardioid: 0, logSpiral: 0
  }
});
assert(axialDistance(surfaceOnly, base) < 1e-9, 'surface-only mixer changed the base field');

const depthAngle = 1.1;
const depthOnly = M.composeAngle({
  x: 140, y: 60, width, height, seed,
  baseAngle: base,
  depthAngle,
  depthCoherence: 1,
  procedural: { scale: 120, turbulence: 0, octaves: 4 },
  mixer: {
    surface: 0, depth: 1, procedural: 0,
    radial: 0, vortex: 0, spiral: 0, wave: 0,
    rose: 0, cardioid: 0, logSpiral: 0
  }
});
assert(axialDistance(depthOnly, depthAngle) < 1e-9, 'depth-contour mixer path is incorrect');

const radialOnly = M.composeAngle({
  x: cx + 50, y: cy, width, height, seed,
  baseAngle: base,
  procedural: { scale: 120, turbulence: 0, octaves: 4 },
  mixer: {
    surface: 0, depth: 0, procedural: 0,
    radial: 1, vortex: 0, spiral: 0, wave: 0,
    rose: 0, cardioid: 0, logSpiral: 0
  }
});
assert(axialDistance(radialOnly, 0) < 1e-9, 'radial mixer path is incorrect');

const proceduralOff = M.composeAngle({
  x: 47, y: 31, width, height, seed,
  baseAngle: base,
  procedural: { scale: 80, turbulence: 1, octaves: 5 },
  mixer: {
    surface: 1, depth: 0, procedural: 0,
    radial: 0, vortex: 0, spiral: 0, wave: 0,
    rose: 0, cardioid: 0, logSpiral: 0
  }
});
const proceduralOn = M.composeAngle({
  x: 47, y: 31, width, height, seed,
  baseAngle: base,
  procedural: { scale: 80, turbulence: 1, octaves: 5 },
  mixer: {
    surface: 1, depth: 0, procedural: 1,
    radial: 0, vortex: 0, spiral: 0, wave: 0,
    rose: 0, cardioid: 0, logSpiral: 0
  }
});
assert(axialDistance(proceduralOff, base) < 1e-9, 'procedural weight zero should preserve base');
assert(axialDistance(proceduralOn, proceduralOff) > 1e-5, 'procedural weight did not affect the field');

const mixedA = M.composeAngle({
  x: 143, y: 44, width, height, seed,
  baseAngle: base,
  depthAngle: 0.95,
  depthCoherence: 0.8,
  procedural: { scale: 95, turbulence: 0.55, octaves: 4 },
  mixer: {
    surface: 0.8, depth: 0.5, procedural: 0.2,
    radial: 0.15, vortex: 0.25, spiral: 0.3, wave: 0.2,
    rose: 0.1, cardioid: 0.1, logSpiral: 0.15
  }
});
const mixedB = M.composeAngle({
  x: 143, y: 44, width, height, seed,
  baseAngle: base,
  depthAngle: 0.95,
  depthCoherence: 0.8,
  procedural: { scale: 95, turbulence: 0.55, octaves: 4 },
  mixer: {
    surface: 0.8, depth: 0.5, procedural: 0.2,
    radial: 0.15, vortex: 0.25, spiral: 0.3, wave: 0.2,
    rose: 0.1, cardioid: 0.1, logSpiral: 0.15
  }
});
assert(mixedA === mixedB && Number.isFinite(mixedA), 'combined mixer must be deterministic and finite');

for (const id of [
  'mixSurface', 'mixDepth', 'mixProcedural', 'mixRadial', 'mixVortex',
  'mixSpiral', 'mixWave', 'mixRose', 'mixCardioid', 'mixLogSpiral'
]) {
  assert(html.includes(`id="${id}"`), `missing mixer control ${id}`);
  assert(html.includes(`id="${id}Value"`), `missing mixer value label ${id}Value`);
}

console.log('frontend mathematical-flow mixer smoke test passed');

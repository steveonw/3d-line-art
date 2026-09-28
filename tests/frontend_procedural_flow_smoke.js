const fs = require('fs');
const vm = require('vm');

const randomCode = fs.readFileSync('frontend/random_field.js', 'utf8');
const flowCode = fs.readFileSync('frontend/procedural_flow.js', 'utf8');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(randomCode, context, { filename: 'random_field.js' });
vm.runInContext(flowCode, context, { filename: 'procedural_flow.js' });

const F = context.window.LineArtProceduralFlow;
if (!F?.gradientNoise2D || !F?.fbm2D || !F?.proceduralFlow) {
  throw new Error('procedural flow exports are missing');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const seed = 2841;
const options = { scale: 120, turbulence: 0.75, octaves: 4 };

const a = F.proceduralFlow(42.5, 19.25, seed, options);
const b = F.proceduralFlow(42.5, 19.25, seed, options);
assert(a === b, 'same coordinate/seed/settings must reproduce exactly');

const changedSeed = F.proceduralFlow(42.5, 19.25, seed + 1, options);
assert(a !== changedSeed, 'different seeds should change the flow');

const zero = F.proceduralFlow(42.5, 19.25, seed, {
  scale: 120,
  turbulence: 0,
  octaves: 4
});
assert(zero === 0, 'zero turbulence must preserve the base direction exactly');

const nearby = F.proceduralFlow(43.0, 19.25, seed, options);
assert(Math.abs(a - nearby) < 0.35, 'nearby flow samples should vary smoothly');

const lowOctaves = F.fbm2D(80, 55, seed, { scale: 100, octaves: 1, channel: 7 });
const highOctaves = F.fbm2D(80, 55, seed, { scale: 100, octaves: 6, channel: 7 });
assert(Number.isFinite(lowOctaves) && Number.isFinite(highOctaves), 'fBm must stay finite');
assert(lowOctaves >= -1 && lowOctaves <= 1, 'single-octave noise out of range');
assert(highOctaves >= -1 && highOctaves <= 1, 'multi-octave noise out of range');
assert(lowOctaves !== highOctaves, 'octaves should affect the field');

const coarseA = F.proceduralFlow(20, 20, seed, { scale: 300, turbulence: 1, octaves: 4 });
const coarseB = F.proceduralFlow(25, 20, seed, { scale: 300, turbulence: 1, octaves: 4 });
const fineA = F.proceduralFlow(20, 20, seed, { scale: 25, turbulence: 1, octaves: 4 });
const fineB = F.proceduralFlow(25, 20, seed, { scale: 25, turbulence: 1, octaves: 4 });
assert(
  Math.abs(coarseA - coarseB) <= Math.abs(fineA - fineB) + 0.15,
  'flow scale should generally make large-scale fields smoother'
);

console.log('frontend procedural-flow smoke test passed');

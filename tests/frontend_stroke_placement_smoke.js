const fs = require('fs');
const vm = require('vm');

const randomCode = fs.readFileSync('frontend/random_field.js', 'utf8');
const placementCode = fs.readFileSync('frontend/stroke_placement.js', 'utf8');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(randomCode, context, { filename: 'random_field.js' });
vm.runInContext(placementCode, context, { filename: 'stroke_placement.js' });

const R = context.window.LineArtRandom;
const P = context.window.LineArtStrokePlacement;

if (!P?.scoreCandidate || !P?.createPlacementState) {
  throw new Error('stroke placement exports are missing');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const settings = { detail: 2, sampleBias: 0.72 };
const zero = {
  remainingNeed: 0,
  darkness: 0,
  edge: 0,
  depthChange: 0,
  confidence: 0
};
const baseline = P.scoreCandidate(zero, settings, true, 0).qualityScore;

for (const [name, patch] of [
  ['remaining coverage', { remainingNeed: 1 }],
  ['darkness', { darkness: 1 }],
  ['geometry edge', { edge: 1 }],
  ['depth change', { depthChange: 1 }],
  ['confidence', { confidence: 1 }]
]) {
  const score = P.scoreCandidate({ ...zero, ...patch }, settings, true, 0).qualityScore;
  assert(score > baseline, `${name} did not increase candidate quality`);
}

const sameFeatures = {
  remainingNeed: 0.4,
  darkness: 0.5,
  edge: 0.3,
  depthChange: 0.2,
  confidence: 0.7
};
const clearScore = P.scoreCandidate(sameFeatures, settings, true, 0.2).selectionScore;
const collisionScore = P.scoreCandidate(sameFeatures, settings, false, 0.2).selectionScore;
assert(clearScore > collisionScore, 'minimum-spacing preference is not active');

const spacing = P.createPlacementState(320, 240);
assert(P.spacingClear(spacing, 100, 100), 'empty spacing grid should be clear');
P.recordSelection(spacing, {
  x: 100,
  y: 100,
  remainingNeed: 0.5,
  spacingClear: true,
  qualityScore: 0.8
});
assert(!P.spacingClear(spacing, 100.5, 100), 'nearby seed should violate minimum spacing');
assert(P.spacingClear(spacing, 110, 100), 'distant seed should remain available');

const width = 96;
const height = 72;
const coverageCell = 3;
const seed = 2841;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function evidenceAt(x, y) {
  const nx = x / (width - 1);
  const ny = y / (height - 1);
  const dx = nx - 0.5;
  const dy = ny - 0.5;
  const radius = Math.hypot(dx, dy);
  return {
    darkness: clamp(1 - radius * 2.1, 0, 1),
    edge: clamp(1 - Math.abs(radius - 0.28) * 18, 0, 1),
    depthChange: clamp(1 - Math.abs(nx - ny) * 10, 0, 1),
    confidence: clamp(1 - radius * 1.5, 0, 1)
  };
}

function runSampler(mode, strokes = 1200) {
  const coverageWidth = Math.ceil(width / coverageCell);
  const coverageHeight = Math.ceil(height / coverageCell);
  const coverage = new Float32Array(coverageWidth * coverageHeight);
  const placement = P.createPlacementState(width, height);

  let useful = 0;
  let remainingTotal = 0;

  for (let strokeIndex = 0; strokeIndex < strokes; strokeIndex++) {
    let best = null;
    let bestScore = -Infinity;
    const attempts = mode === 'new' ? 6 : 4;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const channel = attempt * 4;
      const x = 1 + Math.floor(
        R.randomForIndex(strokeIndex, seed, channel) * Math.max(1, width - 2)
      );
      const y = 1 + Math.floor(
        R.randomForIndex(strokeIndex, seed, channel + 1) * Math.max(1, height - 2)
      );
      const jitter = R.randomForIndex(strokeIndex, seed, channel + 2);
      const evidence = evidenceAt(x, y);
      const cellIndex =
        Math.floor(y / coverageCell) * coverageWidth +
        Math.floor(x / coverageCell);
      const remainingNeed = Math.max(0, evidence.darkness - coverage[cellIndex]);

      if (mode === 'new') {
        const isClear = P.spacingClear(placement, x, y);
        const scored = P.scoreCandidate(
          { ...evidence, remainingNeed },
          settings,
          isClear,
          jitter
        );
        P.recordCandidate(placement, remainingNeed, isClear);
        if (scored.selectionScore > bestScore) {
          bestScore = scored.selectionScore;
          best = {
            x,
            y,
            cellIndex,
            remainingNeed,
            spacingClear: isClear,
            qualityScore: scored.qualityScore
          };
        }
      } else {
        // Exact Phase 7 placement formula, retained here only as a benchmark.
        const importance = clamp(
          0.02 + remainingNeed * 0.85 + evidence.edge * 0.25 * settings.detail,
          0.02,
          1
        );
        const score = importance + jitter * (1 - settings.sampleBias);
        if (score > bestScore) {
          bestScore = score;
          best = { x, y, cellIndex, remainingNeed };
        }
      }
    }

    if (best.remainingNeed > 0.02) useful++;
    remainingTotal += best.remainingNeed;

    // Lightweight seed-cell coverage model for comparing candidate selection.
    coverage[best.cellIndex] += 0.10;

    if (mode === 'new') {
      P.recordSelection(placement, best);
    }
  }

  return {
    usefulRate: useful / strokes,
    averageRemainingNeed: remainingTotal / strokes,
    summary: mode === 'new' ? P.summarize(placement) : null
  };
}

const legacy = runSampler('legacy');
const improved = runSampler('new');

assert(
  improved.usefulRate > legacy.usefulRate,
  `new sampler useful rate did not improve: ${improved.usefulRate} <= ${legacy.usefulRate}`
);
assert(
  improved.averageRemainingNeed > legacy.averageRemainingNeed,
  `new sampler average remaining need did not improve: ${improved.averageRemainingNeed} <= ${legacy.averageRemainingNeed}`
);
assert(improved.summary.candidateAttempts === 1200 * 6, 'candidate attempt metrics are wrong');
assert(improved.summary.selected === 1200, 'selection metrics are wrong');
assert(improved.summary.selectedSpacingClear > 0, 'spacing logic never selected a clear seed');
assert(improved.summary.spacingFallbacks > 0, 'high-density fallback path was not exercised');

console.log(
  'frontend stroke-placement smoke test passed',
  JSON.stringify({
    legacyUsefulRate: legacy.usefulRate,
    improvedUsefulRate: improved.usefulRate,
    legacyAverageRemainingNeed: legacy.averageRemainingNeed,
    improvedAverageRemainingNeed: improved.averageRemainingNeed,
    minSpacing: improved.summary.minSpacing,
    spacingFallbacks: improved.summary.spacingFallbacks
  })
);

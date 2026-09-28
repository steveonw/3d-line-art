const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('frontend/multiview.js', 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(code, context, { filename: 'multiview.js' });

const M = context.window.LineArtMultiView;
if (!M?.combineComposedViews || !M?.combineShadedPixels) {
  throw new Error('multi-view compositor exports are missing');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  JSON.stringify(Array.from(M.VIEW_ORDER)) ===
    JSON.stringify(['front', 'back', 'left', 'right', 'top']),
  'fixed view order changed'
);

const width = 3;
const height = 1;
const count = 3;

function maps({
  luminance,
  direction,
  mask = [1, 1, 1],
  edge = [0, 0, 0],
  depth = [0, 0, 0],
  confidence = [128, 128, 128]
}) {
  return {
    luminance: Uint8Array.from(luminance),
    edgeStrength: Uint8Array.from(edge),
    colorInkNeed: Float32Array.from(luminance.map(v => 1 - v / 255)),
    strokeDirection: Float32Array.from(direction),
    directionCoherence: Uint8Array.from([255, 255, 255]),
    depthDirection: Float32Array.from(direction),
    depthCoherence: Uint8Array.from([180, 180, 180]),
    depthChange: Uint8Array.from(depth),
    confidence: Uint8Array.from(confidence),
    strokeMask: Uint8Array.from(mask),
    eligibleIndices: Uint32Array.from(mask.map((v, i) => v ? i : -1).filter(i => i >= 0)),
    fieldCenter: { x: 1, y: 0, scale: 1 }
  };
}

const entries = [
  {
    name: 'front',
    maps: maps({
      luminance: [30, 240, 240],
      direction: [0, 0, 0],
      edge: [220, 0, 0]
    })
  },
  {
    name: 'back',
    maps: maps({
      luminance: [240, 35, 240],
      direction: [Math.PI / 2, Math.PI / 2, Math.PI / 2],
      edge: [0, 220, 0]
    })
  },
  {
    name: 'top',
    maps: maps({
      luminance: [240, 240, 40],
      direction: [Math.PI / 4, Math.PI / 4, Math.PI / 4],
      edge: [0, 0, 220]
    })
  }
];

const combined = M.combineComposedViews(entries, width, height, {
  debugColors: true
});

assert(
  Array.from(combined.luminance).every((value, i) => value === [30, 35, 40][i]),
  'combined mode did not preserve strongest ink evidence from every view'
);
assert(
  Array.from(combined.strokeMask).every(value => value === 1),
  'combined stroke mask should be the union of occupied views'
);
assert(
  combined.eligibleIndices.length === count,
  'combined eligible index list is incomplete'
);
assert(
  combined.debugColorMap.length === count * 3,
  'combined debug attribution map is missing'
);

const frontColor = M.VIEW_COLORS.front;
const backColor = M.VIEW_COLORS.back;
const topColor = M.VIEW_COLORS.top;
for (const [pixel, color] of [[0, frontColor], [1, backColor], [2, topColor]]) {
  const base = pixel * 3;
  assert(
    combined.debugColorMap[base] === color[0] &&
      combined.debugColorMap[base + 1] === color[1] &&
      combined.debugColorMap[base + 2] === color[2],
    `pixel ${pixel} was not attributed to its dominant view`
  );
}

const shadedEntries = [
  {
    pixels: {
      data: Uint8ClampedArray.from([
        20, 20, 20, 255,
        230, 230, 230, 255,
        230, 230, 230, 255
      ])
    }
  },
  {
    pixels: {
      data: Uint8ClampedArray.from([
        230, 230, 230, 255,
        30, 30, 30, 255,
        230, 230, 230, 255
      ])
    }
  },
  {
    pixels: {
      data: Uint8ClampedArray.from([
        230, 230, 230, 255,
        230, 230, 230, 255,
        40, 40, 40, 255
      ])
    }
  }
];
const rgba = M.combineShadedPixels(shadedEntries, width, height);
assert(
  rgba[0] === 20 && rgba[4] === 30 && rgba[8] === 40,
  'combined shaded pixels did not retain the darkest view contribution'
);

const leftDebug = M.debugColorMapForView('left', count);
const leftColor = M.VIEW_COLORS.left;
for (let i = 0; i < count; i++) {
  const base = i * 3;
  assert(
    leftDebug[base] === leftColor[0] &&
      leftDebug[base + 1] === leftColor[1] &&
      leftDebug[base + 2] === leftColor[2],
    'single-view debug coloring is inconsistent'
  );
}

console.log('frontend fixed multi-view smoke test passed');

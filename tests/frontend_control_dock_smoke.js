const fs = require('fs');
const vm = require('vm');

const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync('frontend/control_dock.js', 'utf8'),
  context,
  { filename: 'frontend/control_dock.js' }
);

const Dock = context.window.LineArtControlDock;
if (!Dock?.normalizeState || !Dock?.clampFloatRect) {
  throw new Error('control dock helpers missing');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const defaults = Dock.normalizeState({});
assert(defaults.mode === 'float', 'default dock mode should be float');
assert(defaults.activeTab === 'source', 'default dock tab should be source');
assert(defaults.minimized === false && defaults.closed === false, 'dock should start open');
assert(defaults.floatRect.width >= 320, 'dock default width should respect minimum');

const normalized = Dock.normalizeState({
  mode: 'right',
  activeTab: 'lidar',
  minimized: 1,
  closed: 0,
  floatRect: { x: 100, y: 120, width: 500, height: 600 }
});
assert(normalized.mode === 'right', 'valid dock mode should be preserved');
assert(normalized.activeTab === 'lidar', 'valid dock tab should be preserved');
assert(normalized.minimized === true, 'minimized state should be booleanized');
assert(normalized.closed === false, 'closed state should be booleanized');
assert(normalized.floatRect.width === 500 && normalized.floatRect.height === 600, 'float size should persist');

const invalid = Dock.normalizeState({
  mode: 'bottom',
  activeTab: 'unknown',
  floatRect: { width: 5, height: 10 }
});
assert(invalid.mode === 'float', 'invalid dock mode should fall back');
assert(invalid.activeTab === 'source', 'invalid tab should fall back');
assert(invalid.floatRect.width === 320, 'float width should clamp to minimum');
assert(invalid.floatRect.height === 240, 'float height should clamp to minimum');

const clamped = Dock.clampFloatRect(
  { x: -500, y: 900, width: 900, height: 900 },
  700,
  500
);
assert(clamped.width === 676, 'float width should clamp inside viewport');
assert(clamped.height === 476, 'float height should clamp inside viewport');
assert(clamped.x === 12, 'float x should clamp to viewport edge');
assert(clamped.y === 12, 'float y should clamp to viewport edge');

const html = fs.readFileSync('frontend/index.html', 'utf8');
for (const id of [
  'controlDock',
  'controlDockHead',
  'controlDockTabs',
  'controlDockBody',
  'controlDockLaunch',
  'controlDockFloat',
  'controlDockLeft',
  'controlDockRight',
  'controlDockMinimize',
  'controlDockClose'
]) {
  assert(html.includes(`id="${id}"`), `missing control dock element ${id}`);
}
assert(html.includes('control_dock.js'), 'control dock script is not loaded');

console.log('frontend control dock smoke test passed');

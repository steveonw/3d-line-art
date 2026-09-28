const fs = require('fs');
const vm = require('vm');

const projectCode = fs.readFileSync('frontend/project_state.js', 'utf8');
const historyCode = fs.readFileSync('frontend/history.js', 'utf8');
const html = fs.readFileSync('frontend/index.html', 'utf8');
const app = fs.readFileSync('frontend/app.js', 'utf8');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(projectCode, context, { filename: 'project_state.js' });
vm.runInContext(historyCode, context, { filename: 'history.js' });

const Project = context.window.LineArtProjectState;
const History = context.window.LineArtHistory;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const defaults = {
  preset: 'finePencil',
  lineCount: 50000,
  opacity: 0.5,
  procedural: { scale: 120, turbulence: 0, octaves: 4 },
  flowMixer: { surface: 1, radial: 0 },
  lidar: { smartSampling: false, cameraYaw: 45 }
};

const created = Project.create(
  {
    ...defaults,
    lineCount: 88000,
    procedural: { ...defaults.procedural, turbulence: 0.45 }
  },
  { kind: 'image', name: 'portrait.png' }
);
assert(created.version === 2, 'project state version missing');
assert(created.format === 'lidar-ink-project', 'project state format missing');
assert(created.export.pngScale === '2', 'default export settings missing');
assert(created.source.kind === 'image', 'source hint missing');
assert(created.source.name === 'portrait.png', 'source name missing');

const restored = Project.restore(created, defaults);
assert(restored.settings.lineCount === 88000, 'project state did not restore line count');
assert(restored.settings.procedural.turbulence === 0.45, 'nested setting did not restore');
assert(Project.restore({ ...created, version: 999 }, defaults) === null, 'future project version should be rejected');

const malformed = Project.restore({
  version: 1,
  settings: {
    lineCount: 'bad',
    opacity: 0.8,
    unknown: 123,
    procedural: { scale: 200, turbulence: 'bad', octaves: 6 }
  }
}, defaults);
assert(malformed.settings.lineCount === defaults.lineCount, 'type mismatch should fall back to default');
assert(malformed.settings.opacity === 0.8, 'valid primitive should restore');
assert(malformed.settings.procedural.scale === 200, 'valid nested value should restore');
assert(malformed.settings.procedural.turbulence === defaults.procedural.turbulence, 'invalid nested type should fall back');
assert(!('unknown' in malformed.settings), 'unknown state keys should be ignored');

class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

let now = 1000;
let nextTimerId = 1;
const timers = new Map();
const storage = new FakeStorage();
const statuses = [];

function setTimer(fn) {
  const id = nextTimerId++;
  timers.set(id, fn);
  return id;
}
function clearTimer(id) {
  timers.delete(id);
}
function runTimers() {
  const pending = [...timers.entries()];
  timers.clear();
  for (const [, fn] of pending) fn();
}

const history = History.createHistory({
  storage,
  storageKey: 'test-autosave',
  limit: 10,
  autosaveDelayMs: 250,
  coalesceWindowMs: 500,
  now: () => now,
  setTimeoutFn: setTimer,
  clearTimeoutFn: clearTimer,
  onStatus: status => statuses.push({ ...status })
});

const s0 = Project.create({ ...defaults, lineCount: 50000 }, { kind: 'none' });
const s1 = Project.create({ ...defaults, lineCount: 51000 }, { kind: 'none' });
const s2 = Project.create({ ...defaults, lineCount: 52000 }, { kind: 'none' });
const s3 = Project.create({ ...defaults, lineCount: 53000 }, { kind: 'none' });
const s4 = Project.create({ ...defaults, lineCount: 54000 }, { kind: 'none' });

history.initialize(s0);
assert(!history.status().canUndo, 'fresh history should not undo');

now += 100;
history.record(s1, { coalesceKey: 'lineCount' });
now += 100;
history.record(s2, { coalesceKey: 'lineCount' });
assert(history.status().length === 2, 'same slider edit should coalesce into one undo step');
assert(history.status().canUndo, 'edit should enable undo');

const undo = history.undo();
assert(undo.settings.lineCount === 50000, 'undo should restore pre-slider state');
const redo = history.redo();
assert(redo.settings.lineCount === 52000, 'redo should restore coalesced slider result');

history.undo();
now += 1000;
history.record(s3, { coalesceKey: 'lineCount' });
assert(!history.status().canRedo, 'new edit after undo should truncate redo branch');
assert(history.current().settings.lineCount === 53000, 'branch edit should become current');

const beforeSourceReplace = history.status().length;
const sourceUpdated = Project.create(
  { ...defaults, lineCount: 53000 },
  { kind: 'image', name: 'reference.png' }
);
history.replaceCurrent(sourceUpdated, { autosave: false });
assert(history.status().length === beforeSourceReplace, 'source hint update should not create undo step');
assert(history.current().source.name === 'reference.png', 'current source hint did not update');

now += 1000;
history.record(s4, { coalesceKey: 'opacity' });
assert(history.status().autosaveState === 'pending', 'edit should schedule autosave');
assert(timers.size === 1, 'autosave should be debounced to one timer');

runTimers();
assert(history.status().autosaveState === 'saved', 'autosave should complete');
assert(storage.getItem('test-autosave'), 'autosave payload missing');

const restoredHistory = History.createHistory({
  storage,
  storageKey: 'test-autosave',
  now: () => now,
  setTimeoutFn: setTimer,
  clearTimeoutFn: clearTimer
});
const autosaved = restoredHistory.restoreAutosave();
assert(autosaved.settings.lineCount === 54000, 'autosave restore should return latest state');

storage.setItem('bad-version', JSON.stringify({
  storageVersion: 999,
  savedAt: new Date(now).toISOString(),
  state: s4
}));
const incompatibleHistory = History.createHistory({
  storage,
  storageKey: 'bad-version',
  now: () => now,
  setTimeoutFn: setTimer,
  clearTimeoutFn: clearTimer
});
assert(incompatibleHistory.restoreAutosave() === null, 'unknown autosave storage version should be rejected');

const noStorageHistory = History.createHistory({
  storage: null,
  storageKey: 'no-storage',
  now: () => now,
  setTimeoutFn: setTimer,
  clearTimeoutFn: clearTimer
});
noStorageHistory.initialize(s0);
noStorageHistory.record(s1);
runTimers();
assert(noStorageHistory.status().autosaveState === 'error', 'blocked storage should degrade to autosave error');

assert(html.includes('id="undoBtn"'), 'Undo button missing');
assert(html.includes('id="redoBtn"'), 'Redo button missing');
assert(html.includes('id="autosaveStatus"'), 'autosave status missing');
assert(html.indexOf('project_state.js') < html.indexOf('app.js'), 'project state must load before app');
assert(html.indexOf('history.js') < html.indexOf('app.js'), 'history module must load before app');
assert(app.includes("document.body.dataset.phase9Ready = 'true'"), 'Phase 9 readiness marker missing');
assert(app.includes("key === 'z'"), 'Ctrl+Z handler missing');
assert(app.includes("key === 'y'"), 'Ctrl+Y handler missing');
assert(app.includes('history.dispose({ flush: true })'), 'pagehide autosave flush missing');

console.log('frontend history/autosave smoke test passed');

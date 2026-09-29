const fs = require('fs');
const vm = require('vm');

const projectCode = fs.readFileSync('frontend/project_state.js', 'utf8');
const html = fs.readFileSync('frontend/index.html', 'utf8');
const app = fs.readFileSync('frontend/app.js', 'utf8');
const sampleProjectText = fs.readFileSync('samples/cube.lidar-ink.json', 'utf8');
const sampleObjSize = fs.statSync('samples/cube.obj').size;

const context = { window: {} };
vm.createContext(context);
vm.runInContext(projectCode, context, { filename: 'project_state.js' });

const Project = context.window.LineArtProjectState;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const defaults = {
  preset: 'finePencil',
  mode: 'black',
  palette: 'monochrome',
  lineCount: 70000,
  strokeLength: 5.5,
  strokeWeight: 0.75,
  detail: 2.2,
  opacity: 0.42,
  colorStrength: 1,
  paletteStrength: 1,
  directionNoise: 0.16,
  angleQuantize: 0,
  sampleBias: 0.78,
  flowStrength: 0.78,
  seed: 2841,
  modelTransform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 1
  },
  procedural: { scale: 120, turbulence: 0, octaves: 4 },
  flowMixer: {
    surface: 1,
    depth: 0,
    procedural: 1,
    radial: 0,
    vortex: 0,
    spiral: 0,
    wave: 0,
    rose: 0,
    cardioid: 0,
    logSpiral: 0,
    mathEmphasis: 1
  },
  lidar: {
    scanResolution: '320x240',
    raysPerPixel: 2,
    smartSampling: false,
    cameraYaw: 45,
    cameraElevation: 20,
    cameraDistance: 3,
    cameraFov: 55,
    densitySource: 'tone',
    directionSource: 'mixed',
    geometryEdgeStrength: 1,
    depthInfluence: 0.75,
    depthContourStrength: 0,
    confidenceSmoothing: 0,
    useFusedConfidence: false,
    confidenceLength: 0,
    confidenceOpacity: 0,
    confidenceFragmentation: 0,
    cleanBackground: false,
    objectCenteredFields: false,
    multiViewMode: 'current',
    multiViewCurrent: 'front',
    multiViewDebugColors: false
  }
};

const settings = {
  ...defaults,
  palette: 'cool',
  seed: 777,
  lineCount: 123000,
  modelTransform: {
    position: { x: 2, y: 1, z: -1 },
    rotation: { x: 90, y: 35, z: 15 },
    scale: 1.2
  },
  procedural: { scale: 85, turbulence: 0.65, octaves: 6 },
  flowMixer: {
    ...defaults.flowMixer,
    surface: 0.75,
    depth: 0.5,
    vortex: 0.3,
    logSpiral: 0.15,
    mathEmphasis: 2.2
  },
  lidar: {
    ...defaults.lidar,
    scanResolution: '480x360',
    raysPerPixel: 4,
    smartSampling: true,
    cameraYaw: 132,
    cameraElevation: 37,
    cameraDistance: 2.4,
    cameraFov: 48,
    densitySource: 'depthChange',
    directionSource: 'depthTangent',
    geometryEdgeStrength: 1.6,
    depthInfluence: 0.9,
    depthContourStrength: 0.8,
    confidenceSmoothing: 0.65,
    useFusedConfidence: true,
    confidenceLength: 0.45,
    confidenceOpacity: 0.55,
    confidenceFragmentation: 0.35,
    cleanBackground: true,
    objectCenteredFields: true,
    multiViewMode: 'combined',
    multiViewCurrent: 'right',
    multiViewDebugColors: true
  }
};

const source = {
  kind: 'lidar',
  name: 'test-cube.obj',
  size: 12345,
  lastModified: 1700000000000,
  type: 'text/plain'
};

const project = Project.create(settings, source, { pngScale: '4' });
assert(project.format === 'lidar-ink-project', 'portable format marker missing');
assert(project.version === 2, 'portable project version should be 2');
assert(project.source.name === 'test-cube.obj', 'model reference missing');
assert(project.source.size === 12345, 'model size reference missing');
assert(project.export.pngScale === '4', 'export setting missing');
assert(project.settings.modelTransform.position.x === 2, 'model transform position missing');
assert(project.settings.modelTransform.rotation.x === 90, 'model transform rotation missing');
assert(project.settings.modelTransform.scale === 1.2, 'model transform scale missing');

const text = Project.serialize({
  ...project,
  meta: { appVersion: 'test', savedAt: '2026-09-28T00:00:00Z' }
}, { pretty: true });

assert(text.includes('\n  "format"'), 'pretty project serialization should be readable');

const reopened = Project.deserialize(text, defaults, { pngScale: '2' });
assert(reopened, 'saved project did not reopen');
assert(reopened.settings.lineCount === 123000, 'art settings did not round-trip');
assert(reopened.settings.palette === 'cool', 'palette did not round-trip');
assert(reopened.settings.seed === 777, 'seed did not round-trip');
assert(reopened.settings.procedural.turbulence === 0.65, 'procedural settings did not round-trip');
assert(reopened.settings.flowMixer.vortex === 0.3, 'flow mixer did not round-trip');
assert(reopened.settings.flowMixer.mathEmphasis === 2.2, 'math emphasis did not round-trip');
assert(reopened.settings.lidar.cameraYaw === 132, 'camera did not round-trip');
assert(reopened.settings.lidar.smartSampling === true, 'LiDAR settings did not round-trip');
assert(reopened.settings.lidar.depthContourStrength === 0.8, 'contour coverage did not round-trip');
assert(reopened.settings.lidar.confidenceSmoothing === 0.65, 'confidence smoothing did not round-trip');
assert(reopened.settings.lidar.useFusedConfidence === true, 'fused confidence toggle did not round-trip');
assert(reopened.settings.lidar.confidenceLength === 0.45, 'confidence length did not round-trip');
assert(reopened.settings.lidar.confidenceOpacity === 0.55, 'confidence opacity did not round-trip');
assert(reopened.settings.lidar.confidenceFragmentation === 0.35, 'confidence fragmentation did not round-trip');
assert(reopened.settings.lidar.cleanBackground === true, 'clean background did not round-trip');
assert(reopened.settings.lidar.objectCenteredFields === true, 'object-centered fields did not round-trip');
assert(reopened.settings.lidar.multiViewMode === 'combined', 'multi-view mode did not round-trip');
assert(reopened.settings.lidar.multiViewCurrent === 'right', 'current fixed view did not round-trip');
assert(reopened.settings.lidar.multiViewDebugColors === true, 'debug view colors did not round-trip');
assert(reopened.export.pngScale === '4', 'export settings did not round-trip');
assert(reopened.source.name === source.name, 'source reference did not round-trip');
assert(reopened.settings.modelTransform.position.z === -1, 'model transform position did not round-trip');
assert(reopened.settings.modelTransform.rotation.y === 35, 'model transform rotation did not round-trip');
assert(reopened.settings.modelTransform.scale === 1.2, 'model transform scale did not round-trip');

const generatedSource = {
  kind: 'lidar',
  name: 'generated-sphere.obj',
  size: null,
  lastModified: null,
  type: 'text/plain',
  sha256: null,
  generator: {
    type: 'sphere',
    radius: 1.25,
    segments: 24,
    rings: 12
  }
};
const generatedProject = Project.create(settings, generatedSource, { pngScale: '2' });
const generatedReopened = Project.deserialize(
  Project.serialize(generatedProject),
  defaults,
  { pngScale: '2' }
);
assert(generatedReopened?.source.generator?.type === 'sphere', 'generated source type did not round-trip');
assert(generatedReopened.source.generator?.segments === 24, 'generated source settings did not round-trip');
assert(
  Project.sourceMatches(
    generatedReopened.source,
    {
      ...generatedSource,
      name: 'renamed-generated.obj',
      generator: { ...generatedSource.generator }
    }
  ),
  'matching generated source specs should restore without a file'
);
assert(
  !Project.sourceMatches(
    generatedReopened.source,
    {
      ...generatedSource,
      generator: { ...generatedSource.generator, radius: 2 }
    }
  ),
  'different generated source specs must not match'
);

// Phase 9 autosaves used a v1 settings/source shape. They must migrate.
const legacy = {
  version: 1,
  settings: {
    ...defaults,
    seed: 444,
    lidar: { ...defaults.lidar, cameraYaw: 99 }
  },
  source: { kind: 'image', name: 'legacy.png' }
};
const migrated = Project.restore(legacy, defaults, { pngScale: '2' });
assert(migrated, 'v1 project/autosave state did not migrate');
assert(migrated.version === 2, 'v1 state did not migrate to v2');
assert(migrated.settings.seed === 444, 'v1 seed migration failed');
assert(migrated.settings.lidar.cameraYaw === 99, 'v1 camera migration failed');
assert(migrated.source.name === 'legacy.png', 'v1 source migration failed');
assert(migrated.export.pngScale === '2', 'v1 export default migration failed');

assert(
  Project.sourceMatches(source, { ...source }),
  'identical source references should match'
);
assert(
  !Project.sourceMatches(source, { ...source, name: 'other.obj' }),
  'different source names should not match'
);
assert(
  !Project.sourceMatches(source, { ...source, size: 54321 }),
  'different known source sizes should not match'
);
assert(
  Project.sourceMatches(source, { ...source, lastModified: 1700000001000 }),
  'modification time should be a soft hint, not source identity'
);
assert(
  Project.sourceMatches(source, {
    kind: 'lidar',
    name: 'test-cube.obj',
    size: null,
    lastModified: null,
    type: null
  }),
  'server-side name-only references should satisfy the same model name'
);

const hashed = {
  ...source,
  sha256: 'a'.repeat(64)
};
assert(
  Project.sourceMatches(hashed, { ...hashed, name: 'renamed.obj', lastModified: 1 }),
  'matching content hashes should survive rename/mtime changes'
);
assert(
  !Project.sourceMatches(hashed, { ...hashed, sha256: 'b'.repeat(64) }),
  'different content hashes must not match'
);

assert(
  Project.projectFileName(source) === 'test-cube.lidar-ink.json',
  'portable filename is wrong'
);
assert(
  Project.projectFileName({ kind: 'none', name: null }) === 'untitled.lidar-ink.json',
  'untitled filename is wrong'
);

assert(
  Project.restore({ ...project, version: 999 }, defaults) === null,
  'unknown future project versions should be rejected'
);
assert(
  Project.restore({ ...project, format: 'other-project' }, defaults) === null,
  'foreign project formats should be rejected'
);

const sampleProject = Project.deserialize(sampleProjectText, defaults, { pngScale: '2' });
assert(sampleProject, 'checked-in cube project should parse');
assert(sampleProject.source.kind === 'lidar', 'sample project should reference a LiDAR model');
assert(sampleProject.source.name === 'cube.obj', 'sample project should reference cube.obj');
assert(sampleProject.source.size === sampleObjSize, 'sample project size should match samples/cube.obj');

for (const id of ['openProjectBtn', 'saveProjectBtn', 'projectFileInput', 'projectStatus']) {
  assert(html.includes(`id="${id}"`), `missing project UI control ${id}`);
}

assert(app.includes('saveProjectFile()'), 'save project workflow missing');
assert(app.includes('openProjectFile(file)'), 'open project workflow missing');
assert(app.includes('PROJECT_FILE_MAX_BYTES'), 'project file size guard missing');
assert(app.includes('projectSourceReady()'), 'project source guard missing');
assert(app.includes("document.body.dataset.phase10Ready = 'true'"), 'Phase 10 readiness marker missing');

console.log('frontend portable-project smoke test passed');

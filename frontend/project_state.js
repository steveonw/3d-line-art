(() => {
  'use strict';

  const PROJECT_FORMAT = 'lidar-ink-project';
  const PROJECT_VERSION = 2;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function finiteOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function mergeKnown(template, incoming) {
    if (!isPlainObject(template) || !isPlainObject(incoming)) return clone(template);
    const out = clone(template);
    for (const key of Object.keys(template)) {
      if (!(key in incoming)) continue;
      const expected = template[key];
      const actual = incoming[key];
      if (isPlainObject(expected)) {
        out[key] = mergeKnown(expected, actual);
      } else if (typeof expected === 'number') {
        if (typeof actual === 'number' && Number.isFinite(actual)) out[key] = actual;
      } else if (typeof expected === 'string') {
        if (typeof actual === 'string') out[key] = actual;
      } else if (typeof expected === 'boolean') {
        if (typeof actual === 'boolean') out[key] = actual;
      }
    }
    return out;
  }

  function normalizeSource(source = {}) {
    const kind = ['none', 'image', 'lidar'].includes(source.kind)
      ? source.kind
      : 'none';
    return {
      kind,
      name: typeof source.name === 'string' && source.name ? source.name : null,
      size: finiteOrNull(source.size),
      lastModified: finiteOrNull(source.lastModified),
      type: typeof source.type === 'string' && source.type ? source.type : null
    };
  }

  function normalizeExport(exportSettings = {}, defaults = { pngScale: '2' }) {
    const fallback = {
      pngScale: String(defaults?.pngScale ?? '2')
    };
    const value = String(exportSettings?.pngScale ?? fallback.pngScale);
    return {
      pngScale: ['1', '2', '4'].includes(value) ? value : fallback.pngScale
    };
  }

  function create(settings, source = {}, exportSettings = { pngScale: '2' }) {
    return {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      settings: clone(settings),
      source: normalizeSource(source),
      export: normalizeExport(exportSettings)
    };
  }

  function migrateV1(snapshot, defaultExport) {
    if (!isPlainObject(snapshot) || snapshot.version !== 1 || !isPlainObject(snapshot.settings)) {
      return null;
    }
    return {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      settings: clone(snapshot.settings),
      source: normalizeSource(snapshot.source),
      export: normalizeExport({}, defaultExport)
    };
  }

  function restore(snapshot, defaultSettings, defaultExport = { pngScale: '2' }) {
    if (!isPlainObject(snapshot)) return null;

    let current = snapshot;
    if (snapshot.version === 1 && !snapshot.format) {
      current = migrateV1(snapshot, defaultExport);
      if (!current) return null;
    }

    if (current.format !== PROJECT_FORMAT) return null;
    if (current.version !== PROJECT_VERSION) return null;
    if (!isPlainObject(current.settings)) return null;

    return {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      settings: mergeKnown(defaultSettings, current.settings),
      source: normalizeSource(current.source),
      export: normalizeExport(current.export, defaultExport)
    };
  }

  function serialize(snapshot, { pretty = false } = {}) {
    return JSON.stringify(snapshot, null, pretty ? 2 : 0);
  }

  function deserialize(text, defaultSettings, defaultExport = { pngScale: '2' }) {
    try {
      return restore(JSON.parse(text), defaultSettings, defaultExport);
    } catch (_) {
      return null;
    }
  }

  function sourceMatches(reference, candidate) {
    const a = normalizeSource(reference);
    const b = normalizeSource(candidate);
    if (a.kind === 'none') return true;
    if (a.kind !== b.kind) return false;
    if (!a.name || !b.name || a.name !== b.name) return false;
    if (a.size !== null && b.size !== null && a.size !== b.size) return false;
    if (
      a.lastModified !== null &&
      b.lastModified !== null &&
      a.lastModified !== b.lastModified
    ) return false;
    return true;
  }

  function projectFileName(source = {}) {
    const normalized = normalizeSource(source);
    const raw = normalized.name || 'untitled';
    const base = raw
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled';
    return `${base}.lidar-ink.json`;
  }

  window.LineArtProjectState = Object.freeze({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    create,
    restore,
    serialize,
    deserialize,
    sourceMatches,
    projectFileName
  });
})();

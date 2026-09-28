(() => {
  'use strict';

  const PROJECT_VERSION = 1;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
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

  function create(settings, source = {}) {
    return {
      version: PROJECT_VERSION,
      settings: clone(settings),
      source: {
        kind: typeof source.kind === 'string' ? source.kind : 'none',
        name: typeof source.name === 'string' ? source.name : null
      }
    };
  }

  function restore(snapshot, defaultSettings) {
    if (!isPlainObject(snapshot)) return null;
    if (snapshot.version !== PROJECT_VERSION) return null;
    if (!isPlainObject(snapshot.settings)) return null;

    const source = isPlainObject(snapshot.source) ? snapshot.source : {};
    return {
      version: PROJECT_VERSION,
      settings: mergeKnown(defaultSettings, snapshot.settings),
      source: {
        kind: typeof source.kind === 'string' ? source.kind : 'none',
        name: typeof source.name === 'string' ? source.name : null
      }
    };
  }

  function serialize(snapshot) {
    return JSON.stringify(snapshot);
  }

  function deserialize(text, defaultSettings) {
    try {
      return restore(JSON.parse(text), defaultSettings);
    } catch (_) {
      return null;
    }
  }

  window.LineArtProjectState = Object.freeze({
    version: PROJECT_VERSION,
    create,
    restore,
    serialize,
    deserialize
  });
})();

(() => {
  'use strict';

  const TYPES = Object.freeze(['sphere', 'box', 'cylinder', 'lathe', 'heightfield']);

  const DEFAULT_PROFILE = Object.freeze([
    [0, -1],
    [0.72, -0.92],
    [0.92, -0.35],
    [0.58, 0.1],
    [0.76, 0.72],
    [0, 1]
  ]);

  function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function integer(value, fallback) {
    return Math.round(finite(value, fallback));
  }

  function parseProfile(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return DEFAULT_PROFILE.map(pair => pair.slice());
    const points = raw
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map((part, index) => {
        const pieces = part.split(',').map(value => value.trim());
        if (pieces.length !== 2) {
          throw new Error(`Profile point ${index + 1} must be radius,y`);
        }
        const radius = Number(pieces[0]);
        const y = Number(pieces[1]);
        if (!Number.isFinite(radius) || !Number.isFinite(y)) {
          throw new Error(`Profile point ${index + 1} must contain finite numbers`);
        }
        if (radius < 0) {
          throw new Error(`Profile point ${index + 1} radius must be non-negative`);
        }
        return [radius, y];
      });
    if (points.length < 2) throw new Error('Profile needs at least two points.');
    return points;
  }

  function buildSpec(draft = {}) {
    const type = TYPES.includes(draft.type) ? draft.type : 'sphere';
    if (type === 'sphere') {
      return {
        type,
        radius: finite(draft.radius, 1),
        segments: integer(draft.segments, 32),
        rings: integer(draft.rings, 16)
      };
    }
    if (type === 'box') {
      return {
        type,
        width: finite(draft.width, 2),
        height: finite(draft.height, 2),
        depth: finite(draft.depth, 2)
      };
    }
    if (type === 'cylinder') {
      return {
        type,
        radius: finite(draft.radius, 1),
        height: finite(draft.height, 2),
        segments: integer(draft.segments, 32)
      };
    }
    if (type === 'lathe') {
      return {
        type,
        segments: integer(draft.segments, 36),
        profile: parseProfile(draft.profile)
      };
    }
    return {
      type: 'heightfield',
      width: finite(draft.width, 3),
      depth: finite(draft.depth, 3),
      amplitude: finite(draft.amplitude, 0.65),
      frequency: finite(draft.frequency, 2),
      grid: integer(draft.grid, 28),
      pattern: ['waves', 'ripple', 'saddle', 'radial'].includes(draft.pattern)
        ? draft.pattern
        : 'waves'
    };
  }

  function profileText(profile = DEFAULT_PROFILE) {
    return profile.map(([radius, y]) => `${radius},${y}`).join('; ');
  }

  window.LineArtGeometryBuilder = Object.freeze({
    TYPES,
    DEFAULT_PROFILE,
    parseProfile,
    buildSpec,
    profileText
  });
})();

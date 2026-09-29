(() => {
  'use strict';

  const MAX_STROKES = 5000;
  const MAX_POINTS_PER_STROKE = 8;
  const DEFAULT_MAX_SEGMENT_PIXELS = 2.5;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function buildProjectionPayload(
    store,
    meta,
    scanId,
    {
      maxStrokes = MAX_STROKES,
      maxSegmentPixels = DEFAULT_MAX_SEGMENT_PIXELS
    } = {}
  ) {
    if (!store || !meta || !scanId) throw new Error('3D Ink needs a stroke store, render metadata, and scan id.');
    const count = Math.min(
      Number(store.count) || 0,
      clamp(Math.floor(Number(maxStrokes) || MAX_STROKES), 1, MAX_STROKES)
    );
    if (count < 1) throw new Error('3D Ink needs at least one completed 2D stroke.');

    const points = [];
    const pointCounts = [];
    const widths = [];
    const rgba = [];
    const maxStreamPoints = store.capacity > 0
      ? Math.floor(store.points.length / store.capacity / 2)
      : 0;
    if (maxStreamPoints < 2) throw new Error('3D Ink stroke storage is invalid.');

    for (let i = 0; i < count; i++) {
      const pointCount = clamp(Number(store.pointCounts[i]) | 0, 2, Math.min(maxStreamPoints, MAX_POINTS_PER_STROKE));
      const base = i * maxStreamPoints * 2;
      pointCounts.push(pointCount);
      for (let p = 0; p < pointCount * 2; p++) {
        points.push(Number(store.points[base + p]));
      }
      widths.push(Math.max(0.01, Number(store.widths[i]) || 1));
      const ci = i * 4;
      rgba.push(
        Number(store.rgba[ci]) || 0,
        Number(store.rgba[ci + 1]) || 0,
        Number(store.rgba[ci + 2]) || 0,
        Number(store.rgba[ci + 3]) || 0
      );
    }

    return {
      scan_id: String(scanId),
      width: Number(meta.width) | 0,
      height: Number(meta.height) | 0,
      max_segment_pixels: clamp(
        Number(maxSegmentPixels) || DEFAULT_MAX_SEGMENT_PIXELS,
        0.75,
        8
      ),
      point_counts: pointCounts,
      points,
      widths,
      rgba
    };
  }

  function validateSnapshot(snapshot) {
    if (!snapshot || snapshot.format !== 'lidar-ink-3d-strokes' || snapshot.version !== 1) {
      throw new Error('Unsupported 3D Ink snapshot.');
    }
    const pointCount = Number(snapshot.point_count) | 0;
    const strokeCount = Number(snapshot.stroke_count) | 0;
    if (
      pointCount < 2 ||
      strokeCount < 1 ||
      snapshot.positions?.length !== pointCount * 3 ||
      snapshot.normals?.length !== pointCount * 3 ||
      snapshot.tangents?.length !== pointCount * 3 ||
      snapshot.depth?.length !== pointCount ||
      snapshot.confidence?.length !== pointCount ||
      snapshot.material_rgb?.length !== pointCount * 3 ||
      snapshot.piece_ids?.length !== pointCount ||
      snapshot.stroke_offsets?.length !== strokeCount ||
      snapshot.stroke_counts?.length !== strokeCount ||
      snapshot.stroke_widths?.length !== strokeCount ||
      snapshot.stroke_rgba?.length !== strokeCount * 4
    ) {
      throw new Error('3D Ink snapshot arrays are inconsistent.');
    }
    return snapshot;
  }

  window.LineArtInk3D = Object.freeze({
    MAX_STROKES,
    MAX_POINTS_PER_STROKE,
    DEFAULT_MAX_SEGMENT_PIXELS,
    buildProjectionPayload,
    validateSnapshot
  });
})();

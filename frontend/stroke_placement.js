(() => {
  'use strict';

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function minimumSpacingForSize(width, height) {
    const shortSide = Math.max(1, Math.min(Number(width) || 1, Number(height) || 1));
    return clamp(shortSide / 260, 1.5, 4.5);
  }

  function createPlacementState(width, height) {
    const minSpacing = minimumSpacingForSize(width, height);
    const cellSize = minSpacing;
    const gridWidth = Math.max(1, Math.ceil(width / cellSize));
    const gridHeight = Math.max(1, Math.ceil(height / cellSize));
    const cellCount = gridWidth * gridHeight;
    const seedX = new Float32Array(cellCount);
    const seedY = new Float32Array(cellCount);
    seedX.fill(-1);
    seedY.fill(-1);

    return {
      minSpacing,
      minSpacingSq: minSpacing * minSpacing,
      cellSize,
      gridWidth,
      gridHeight,
      occupied: new Uint8Array(cellCount),
      seedX,
      seedY,
      metrics: {
        candidateAttempts: 0,
        candidatesWithNeed: 0,
        candidatesSpacingClear: 0,
        selected: 0,
        selectedSpacingClear: 0,
        spacingFallbacks: 0,
        selectedWithNeed: 0,
        selectedRemainingNeed: 0,
        selectedScore: 0
      }
    };
  }

  function spacingClear(state, x, y) {
    const gx = Math.floor(x / state.cellSize);
    const gy = Math.floor(y / state.cellSize);
    const minX = Math.max(0, gx - 1);
    const maxX = Math.min(state.gridWidth - 1, gx + 1);
    const minY = Math.max(0, gy - 1);
    const maxY = Math.min(state.gridHeight - 1, gy + 1);

    for (let cy = minY; cy <= maxY; cy++) {
      const row = cy * state.gridWidth;
      for (let cx = minX; cx <= maxX; cx++) {
        const cell = row + cx;
        if (!state.occupied[cell]) continue;
        const dx = x - state.seedX[cell];
        const dy = y - state.seedY[cell];
        if (dx * dx + dy * dy < state.minSpacingSq) return false;
      }
    }
    return true;
  }

  function markSeed(state, x, y) {
    const gx = clamp(Math.floor(x / state.cellSize), 0, state.gridWidth - 1);
    const gy = clamp(Math.floor(y / state.cellSize), 0, state.gridHeight - 1);
    const cell = gy * state.gridWidth + gx;
    if (!state.occupied[cell]) {
      state.occupied[cell] = 1;
      state.seedX[cell] = x;
      state.seedY[cell] = y;
    }
  }

  function scoreCandidate(features, renderSettings, spacingIsClear, jitter) {
    const remainingNeed = clamp(Number(features.remainingNeed) || 0, 0, 1);
    const darkness = clamp(Number(features.darkness) || 0, 0, 1);
    const edge = clamp(Number(features.edge) || 0, 0, 1);
    const depthChange = clamp(Number(features.depthChange) || 0, 0, 1);
    const confidence = clamp(Number(features.confidence) || 0, 0, 1);
    const detail = clamp(Number(renderSettings.detail) || 1, 0.25, 4);
    const sampleBias = clamp(Number(renderSettings.sampleBias) || 0, 0, 1);

    // Remaining coverage stays dominant. Independent geometry/depth/confidence
    // terms make LiDAR evidence useful even when tone alone is ambiguous.
    const evidence =
      remainingNeed * 1.10 +
      darkness * 0.16 +
      edge * (0.22 + detail * 0.055) +
      depthChange * 0.30 +
      confidence * 0.12;

    const randomTieBreak = clamp(Number(jitter) || 0, 0, 1) * (1 - sampleBias) * 0.28;
    const qualityScore = evidence + randomTieBreak;

    // Spacing is a meaningful preference, not an absolute veto. Strong
    // remaining coverage can still beat a clear but useless location, which
    // keeps the coverage grid as the final authority at high stroke densities.
    const selectionScore = qualityScore + (spacingIsClear ? 0.20 : -0.05);

    const importance = clamp(
      0.02 +
      remainingNeed * 0.70 +
      darkness * 0.08 +
      edge * 0.16 * detail +
      depthChange * 0.14 +
      confidence * 0.05,
      0.02,
      1
    );

    return { qualityScore, selectionScore, importance };
  }

  function recordCandidate(state, remainingNeed, isClear) {
    const metrics = state.metrics;
    metrics.candidateAttempts++;
    if (remainingNeed > 0.02) metrics.candidatesWithNeed++;
    if (isClear) metrics.candidatesSpacingClear++;
  }

  function recordSelection(state, candidate) {
    const metrics = state.metrics;
    metrics.selected++;
    if (candidate.spacingClear) metrics.selectedSpacingClear++;
    else metrics.spacingFallbacks++;
    if (candidate.remainingNeed > 0.02) metrics.selectedWithNeed++;
    metrics.selectedRemainingNeed += candidate.remainingNeed;
    metrics.selectedScore += candidate.qualityScore || 0;
    markSeed(state, candidate.x, candidate.y);
  }

  function summarize(state) {
    const m = state.metrics;
    const selected = Math.max(1, m.selected);
    return Object.freeze({
      minSpacing: state.minSpacing,
      candidateAttempts: m.candidateAttempts,
      candidatesWithNeed: m.candidatesWithNeed,
      candidatesSpacingClear: m.candidatesSpacingClear,
      selected: m.selected,
      selectedSpacingClear: m.selectedSpacingClear,
      spacingFallbacks: m.spacingFallbacks,
      selectedWithNeed: m.selectedWithNeed,
      usefulSelectionRate: m.selectedWithNeed / selected,
      averageRemainingNeed: m.selectedRemainingNeed / selected,
      averageQualityScore: m.selectedScore / selected
    });
  }

  window.LineArtStrokePlacement = Object.freeze({
    minimumSpacingForSize,
    createPlacementState,
    spacingClear,
    scoreCandidate,
    recordCandidate,
    recordSelection,
    summarize
  });
})();

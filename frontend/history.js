(() => {
  'use strict';

  const STORAGE_VERSION = 1;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function stableString(value) {
    return JSON.stringify(value);
  }

  function createHistory(options = {}) {
    let storage = options.storage || null;
    let storageAccessError = null;
    if (!storage) {
      try {
        storage = window.localStorage;
      } catch (error) {
        storageAccessError = error;
      }
    }
    const storageKey = options.storageKey || 'lidar-ink-studio:autosave';
    const limit = Math.max(2, Number(options.limit) || 80);
    const autosaveDelayMs = Math.max(0, Number(options.autosaveDelayMs) || 250);
    const coalesceWindowMs = Math.max(0, Number(options.coalesceWindowMs) || 500);
    const now = options.now || (() => Date.now());
    const setTimer = options.setTimeoutFn || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = options.clearTimeoutFn || (id => clearTimeout(id));
    const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

    let entries = [];
    let signatures = [];
    let index = -1;
    let lastCoalesceKey = null;
    let lastRecordTime = -Infinity;
    let autosaveTimer = null;
    let autosaveState = 'idle';
    let lastSavedAt = null;
    let lastError = null;

    function status() {
      return {
        canUndo: index > 0,
        canRedo: index >= 0 && index < entries.length - 1,
        length: entries.length,
        index,
        autosaveState,
        lastSavedAt,
        lastError
      };
    }

    function emit() {
      onStatus(status());
    }

    function current() {
      return index >= 0 ? clone(entries[index]) : null;
    }

    function scheduleAutosave(state) {
      if (autosaveTimer !== null) clearTimer(autosaveTimer);
      autosaveState = 'pending';
      lastError = null;
      emit();
      const snapshot = clone(state);
      autosaveTimer = setTimer(() => {
        autosaveTimer = null;
        saveNow(snapshot);
      }, autosaveDelayMs);
    }

    function saveNow(state = current()) {
      if (!state) return false;
      if (autosaveTimer !== null) {
        clearTimer(autosaveTimer);
        autosaveTimer = null;
      }
      const savedAt = new Date(now()).toISOString();
      const envelope = {
        storageVersion: STORAGE_VERSION,
        savedAt,
        state: clone(state)
      };
      try {
        if (!storage) throw storageAccessError || new Error('local storage is unavailable');
        storage.setItem(storageKey, JSON.stringify(envelope));
        autosaveState = 'saved';
        lastSavedAt = savedAt;
        lastError = null;
        emit();
        return true;
      } catch (error) {
        autosaveState = 'error';
        lastError = String(error?.message || error || 'autosave failed');
        emit();
        return false;
      }
    }

    function restoreAutosave() {
      try {
        if (!storage) throw storageAccessError || new Error('local storage is unavailable');
        const raw = storage.getItem(storageKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.storageVersion !== STORAGE_VERSION || !parsed.state) return null;
        lastSavedAt = typeof parsed.savedAt === 'string' ? parsed.savedAt : null;
        autosaveState = 'saved';
        lastError = null;
        emit();
        return clone(parsed.state);
      } catch (error) {
        autosaveState = 'error';
        lastError = String(error?.message || error || 'autosave restore failed');
        emit();
        return null;
      }
    }

    function initialize(state, { autosave = false } = {}) {
      entries = [clone(state)];
      signatures = [stableString(state)];
      index = 0;
      lastCoalesceKey = null;
      lastRecordTime = -Infinity;
      if (autosave) scheduleAutosave(state);
      else emit();
      return current();
    }

    function record(state, { coalesceKey = null } = {}) {
      const snapshot = clone(state);
      const signature = stableString(snapshot);
      if (index >= 0 && signature === signatures[index]) return false;

      if (index < entries.length - 1) {
        entries = entries.slice(0, index + 1);
        signatures = signatures.slice(0, index + 1);
      }

      const t = now();
      const canCoalesce =
        coalesceKey != null &&
        coalesceKey === lastCoalesceKey &&
        t - lastRecordTime <= coalesceWindowMs &&
        index > 0;

      if (canCoalesce) {
        entries[index] = snapshot;
        signatures[index] = signature;
      } else {
        entries.push(snapshot);
        signatures.push(signature);
        index++;
        if (entries.length > limit) {
          entries.shift();
          signatures.shift();
          index--;
        }
      }

      lastCoalesceKey = coalesceKey;
      lastRecordTime = t;
      scheduleAutosave(snapshot);
      return true;
    }

    function replaceCurrent(state, { autosave = true } = {}) {
      const snapshot = clone(state);
      const signature = stableString(snapshot);
      if (index < 0) {
        initialize(snapshot, { autosave });
        return true;
      }
      entries[index] = snapshot;
      signatures[index] = signature;
      lastCoalesceKey = null;
      lastRecordTime = -Infinity;
      if (autosave) scheduleAutosave(snapshot);
      else emit();
      return true;
    }

    function replaceCurrent(state, { autosave = true } = {}) {
      const snapshot = clone(state);
      const signature = stableString(snapshot);
      if (index < 0) {
        initialize(snapshot, { autosave });
        return true;
      }
      entries[index] = snapshot;
      signatures[index] = signature;
      lastCoalesceKey = null;
      lastRecordTime = -Infinity;
      if (autosave) scheduleAutosave(snapshot);
      else emit();
      return true;
    }

    function undo() {
      if (index <= 0) return null;
      index--;
      lastCoalesceKey = null;
      scheduleAutosave(entries[index]);
      return current();
    }

    function redo() {
      if (index < 0 || index >= entries.length - 1) return null;
      index++;
      lastCoalesceKey = null;
      scheduleAutosave(entries[index]);
      return current();
    }

    function clearAutosave() {
      if (autosaveTimer !== null) {
        clearTimer(autosaveTimer);
        autosaveTimer = null;
      }
      try {
        if (!storage) throw storageAccessError || new Error('local storage is unavailable');
        storage.removeItem(storageKey);
        autosaveState = 'idle';
        lastSavedAt = null;
        lastError = null;
        emit();
        return true;
      } catch (error) {
        autosaveState = 'error';
        lastError = String(error?.message || error || 'autosave clear failed');
        emit();
        return false;
      }
    }

    function dispose({ flush = true } = {}) {
      if (flush && index >= 0) saveNow(entries[index]);
      else if (autosaveTimer !== null) {
        clearTimer(autosaveTimer);
        autosaveTimer = null;
      }
    }

    return Object.freeze({
      initialize,
      record,
      replaceCurrent,
      undo,
      redo,
      current,
      status,
      restoreAutosave,
      saveNow,
      clearAutosave,
      dispose
    });
  }

  window.LineArtHistory = Object.freeze({
    storageVersion: STORAGE_VERSION,
    createHistory
  });
})();

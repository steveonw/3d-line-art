(() => {
  'use strict';

  const STORAGE_KEY = 'line-art-control-dock-v1';
  const TABS = Object.freeze(['source', 'model', 'lidar', 'art', 'export']);
  const MODES = Object.freeze(['float', 'left', 'right']);
  const MOBILE_BREAKPOINT = 800;
  const EDGE = 12;
  const MIN_WIDTH = 320;
  const MIN_HEIGHT = 240;
  const DEFAULT_WIDTH = 360;
  const DEFAULT_HEIGHT = 720;

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeState(value = {}) {
    const raw = value && typeof value === 'object' ? value : {};
    const rect = raw.floatRect && typeof raw.floatRect === 'object'
      ? raw.floatRect
      : {};
    return {
      mode: MODES.includes(raw.mode) ? raw.mode : 'float',
      activeTab: TABS.includes(raw.activeTab) ? raw.activeTab : 'source',
      minimized: !!raw.minimized,
      closed: !!raw.closed,
      floatRect: {
        x: finite(rect.x, 16),
        y: finite(rect.y, 16),
        width: Math.max(MIN_WIDTH, finite(rect.width, DEFAULT_WIDTH)),
        height: Math.max(MIN_HEIGHT, finite(rect.height, DEFAULT_HEIGHT))
      }
    };
  }

  function clampFloatRect(rect, viewportWidth, viewportHeight) {
    const vw = Math.max(MIN_WIDTH + EDGE * 2, finite(viewportWidth, 1280));
    const vh = Math.max(MIN_HEIGHT + EDGE * 2, finite(viewportHeight, 800));
    const width = Math.min(
      Math.max(MIN_WIDTH, finite(rect?.width, DEFAULT_WIDTH)),
      Math.max(MIN_WIDTH, vw - EDGE * 2)
    );
    const height = Math.min(
      Math.max(MIN_HEIGHT, finite(rect?.height, DEFAULT_HEIGHT)),
      Math.max(MIN_HEIGHT, vh - EDGE * 2)
    );
    return {
      x: Math.max(EDGE, Math.min(vw - width - EDGE, finite(rect?.x, EDGE))),
      y: Math.max(EDGE, Math.min(vh - height - EDGE, finite(rect?.y, EDGE))),
      width,
      height
    };
  }

  function loadState(storage = window.localStorage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      return normalizeState(raw ? JSON.parse(raw) : {});
    } catch (_) {
      return normalizeState({});
    }
  }

  function saveState(state, storage = window.localStorage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
    } catch (_) {
      // Layout persistence is optional; the dock must remain usable when
      // storage is blocked.
    }
  }

  function closestSection(id) {
    const element = document.getElementById(id);
    return element?.classList?.contains('section')
      ? element
      : element?.closest?.('.section') || null;
  }

  function assignSections() {
    const assignments = {
      source: ['openProjectBtn', 'undoBtn', 'imageInput', 'modelInput'],
      model: [
        'modelTransformSection',
        'geometryBuilderSection',
        'inkSpaceControl',
        'inspectionControls'
      ],
      lidar: ['lidarScanControls', 'lidarArtControls'],
      art: [
        'preset',
        'modeControl',
        'palette',
        'lineCountRange',
        'sliders',
        'flowScale',
        'mixSurface',
        'seedInput'
      ],
      export: ['pngScale']
    };

    for (const [tab, ids] of Object.entries(assignments)) {
      for (const id of ids) {
        const section = closestSection(id);
        if (section) section.dataset.dockTabSection = tab;
      }
    }

    const brand = document.querySelector('.control-dock-body > .brand');
    if (brand) brand.dataset.dockTabSection = 'source';
  }

  function init() {
    const panel = document.getElementById('controlDock');
    const head = document.getElementById('controlDockHead');
    const body = document.getElementById('controlDockBody');
    const tabs = document.getElementById('controlDockTabs');
    const launch = document.getElementById('controlDockLaunch');
    const floatButton = document.getElementById('controlDockFloat');
    const leftButton = document.getElementById('controlDockLeft');
    const rightButton = document.getElementById('controlDockRight');
    const minimizeButton = document.getElementById('controlDockMinimize');
    const closeButton = document.getElementById('controlDockClose');
    if (
      !panel || !head || !body || !tabs || !launch ||
      !floatButton || !leftButton || !rightButton ||
      !minimizeButton || !closeButton
    ) {
      return null;
    }

    assignSections();
    let state = loadState();
    let drag = null;
    let resizeTimer = null;

    function isMobile() {
      return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    function persist() {
      saveState(state);
    }

    function captureFloatRect() {
      if (state.mode !== 'float' || state.minimized || isMobile()) return;
      const rect = panel.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      state.floatRect = clampFloatRect(
        {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        },
        window.innerWidth,
        window.innerHeight
      );
    }

    function syncTabs() {
      tabs.querySelectorAll('button[data-control-tab]').forEach(button => {
        const active = button.dataset.controlTab === state.activeTab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      document.querySelectorAll('[data-dock-tab-section]').forEach(section => {
        section.hidden = section.dataset.dockTabSection !== state.activeTab;
      });
    }

    function syncModeButtons() {
      for (const [button, mode] of [
        [floatButton, 'float'],
        [leftButton, 'left'],
        [rightButton, 'right']
      ]) {
        button.classList.toggle('active', state.mode === mode);
        button.setAttribute('aria-pressed', state.mode === mode ? 'true' : 'false');
      }
    }

    function applyFloatRect() {
      const rect = clampFloatRect(
        state.floatRect,
        window.innerWidth,
        window.innerHeight
      );
      state.floatRect = rect;
      panel.style.left = `${rect.x}px`;
      panel.style.top = `${rect.y}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.width = `${rect.width}px`;
      panel.style.height = `${rect.height}px`;
    }

    function applyLayout({ save = false } = {}) {
      panel.dataset.dockMode = state.mode;
      panel.classList.toggle('minimized', state.minimized);
      panel.hidden = state.closed;
      launch.hidden = !state.closed;
      minimizeButton.textContent = state.minimized ? '▢' : '—';
      minimizeButton.title = state.minimized
        ? 'Restore controls'
        : 'Minimize controls';

      if (!isMobile()) {
        if (state.mode === 'float') {
          applyFloatRect();
        } else {
          panel.style.left = state.mode === 'left' ? `${EDGE}px` : 'auto';
          panel.style.right = state.mode === 'right' ? `${EDGE}px` : 'auto';
          panel.style.top = `${EDGE}px`;
          panel.style.bottom = `${EDGE}px`;
          panel.style.width = `${DEFAULT_WIDTH}px`;
          panel.style.height = 'auto';
        }
      }

      syncTabs();
      syncModeButtons();
      document.body.dataset.controlDockReady = 'true';
      document.body.dataset.controlDockMode = state.mode;
      document.body.dataset.controlDockTab = state.activeTab;
      if (save) persist();
    }

    function setMode(mode) {
      if (!MODES.includes(mode)) return;
      captureFloatRect();
      state.mode = mode;
      state.minimized = false;
      state.closed = false;
      applyLayout({ save: true });
    }

    function setTab(tab) {
      if (!TABS.includes(tab)) return;
      state.activeTab = tab;
      state.minimized = false;
      state.closed = false;
      applyLayout({ save: true });
      body.scrollTop = 0;
    }

    tabs.addEventListener('click', event => {
      const button = event.target.closest('button[data-control-tab]');
      if (button) setTab(button.dataset.controlTab);
    });

    floatButton.addEventListener('click', () => setMode('float'));
    leftButton.addEventListener('click', () => setMode('left'));
    rightButton.addEventListener('click', () => setMode('right'));

    minimizeButton.addEventListener('click', () => {
      if (!state.minimized) captureFloatRect();
      state.minimized = !state.minimized;
      state.closed = false;
      applyLayout({ save: true });
    });

    closeButton.addEventListener('click', () => {
      captureFloatRect();
      state.closed = true;
      state.minimized = false;
      applyLayout({ save: true });
    });

    launch.addEventListener('click', () => {
      state.closed = false;
      state.minimized = false;
      applyLayout({ save: true });
      panel.focus();
    });

    head.addEventListener('pointerdown', event => {
      if (
        state.mode !== 'float' ||
        state.minimized ||
        isMobile() ||
        event.target.closest('button')
      ) {
        return;
      }
      const rect = panel.getBoundingClientRect();
      drag = {
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top,
        pointerId: event.pointerId
      };
      head.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    head.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const rect = clampFloatRect(
        {
          x: event.clientX - drag.dx,
          y: event.clientY - drag.dy,
          width,
          height
        },
        window.innerWidth,
        window.innerHeight
      );
      panel.style.left = `${rect.x}px`;
      panel.style.top = `${rect.y}px`;
      state.floatRect = rect;
      event.preventDefault();
    });

    function stopDrag(event) {
      if (!drag) return;
      if (event?.pointerId != null && event.pointerId !== drag.pointerId) return;
      drag = null;
      captureFloatRect();
      persist();
    }

    head.addEventListener('pointerup', stopDrag);
    head.addEventListener('pointercancel', stopDrag);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        if (
          state.mode !== 'float' ||
          state.minimized ||
          state.closed ||
          isMobile()
        ) {
          return;
        }
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          captureFloatRect();
          persist();
        }, 120);
      });
      observer.observe(panel);
    }

    window.addEventListener('resize', () => {
      if (isMobile()) {
        applyLayout();
        return;
      }
      if (state.mode === 'float') {
        captureFloatRect();
      }
      applyLayout({ save: true });
    });

    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || state.closed) return;
      const tag = event.target?.tagName || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      state.minimized = !state.minimized;
      applyLayout({ save: true });
    });

    applyLayout();
    return {
      getState: () => normalizeState(state),
      setMode,
      setTab,
      open: () => {
        state.closed = false;
        state.minimized = false;
        applyLayout({ save: true });
      }
    };
  }

  const api = Object.freeze({
    STORAGE_KEY,
    TABS,
    MODES,
    normalizeState,
    clampFloatRect,
    init
  });
  window.LineArtControlDock = api;

  if (typeof document !== 'undefined') {
    init();
  }
})();

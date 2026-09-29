(() => {
  'use strict';

  async function jsonResponse(response) {
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }
    if (!response.ok || !payload?.ok) {
      const message = payload?.error || `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.code = payload?.code || null;
      error.errorId = payload?.error_id || null;
      throw error;
    }
    return payload;
  }

  async function uploadScene(file) {
    if (!file) throw new Error('Choose an STL or OBJ file first.');
    const response = await fetch(
      `/api/scene/upload?filename=${encodeURIComponent(file.name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file
      }
    );
    return jsonResponse(response);
  }

  async function scan(options = {}) {
    const response = await fetch('/api/lidar/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
    return jsonResponse(response);
  }

  async function scanFixedViews(options = {}) {
    const response = await fetch('/api/lidar/multiview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
    return jsonResponse(response);
  }

  async function scanAutoViews(options = {}) {
    const response = await fetch('/api/lidar/auto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
    return jsonResponse(response);
  }

  async function getState() {
    const response = await fetch('/api/state', { cache: 'no-store' });
    return jsonResponse(response);
  }

  async function getMaps(scanId = null) {
    const suffix = scanId ? `?scan_id=${encodeURIComponent(scanId)}` : '';
    const response = await fetch(`/api/lidar/maps${suffix}`, { cache: 'no-store' });
    return jsonResponse(response);
  }

  async function fetchImageData(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load LiDAR map (${response.status})`);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return {
      canvas,
      imageData: context.getImageData(0, 0, canvas.width, canvas.height),
      width: canvas.width,
      height: canvas.height
    };
  }

  async function fetchScanMaps(scan) {
    const channels = scan?.channels;
    const required = ['shaded', 'depth', 'edge', 'variance', 'confidence'];
    for (const name of required) {
      if (!channels?.[name]) {
        throw new Error(`LiDAR scan did not provide the required ${name} map.`);
      }
    }

    const results = await Promise.all(
      required.map(name => fetchImageData(channels[name]))
    );
    const maps = Object.fromEntries(required.map((name, index) => [name, results[index]]));
    const { width, height } = maps.shaded;

    for (const name of required.slice(1)) {
      if (maps[name].width !== width || maps[name].height !== height) {
        for (const item of results) {
          item.canvas.width = 0;
          item.canvas.height = 0;
        }
        throw new Error('LiDAR map dimensions do not match.');
      }
    }

    return maps;
  }

  window.LidarClient = Object.freeze({
    uploadScene,
    scan,
    scanFixedViews,
    scanAutoViews,
    getState,
    getMaps,
    fetchScanMaps
  });
})();

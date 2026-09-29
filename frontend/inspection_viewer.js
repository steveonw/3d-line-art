(() => {
  'use strict';

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function confidenceRgb(value) {
    const t = clamp(Number(value) || 0, 0, 1);
    return [
      0.95 - t * 0.62,
      0.30 + t * 0.58,
      0.18 + t * 0.72
    ];
  }

  function createInspectionViewer({ container, onSelectScan = null } = {}) {
    const THREE = window.THREE;
    if (!THREE) throw new Error('Three.js must load before inspection_viewer.js');
    if (!container) throw new Error('inspection viewer requires a container');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101217);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.03, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.domElement.setAttribute('aria-label', '3D LiDAR inspection viewport');
    renderer.domElement.setAttribute('role', 'img');
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xe9edf5, 0x30323b, 1.05));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
    keyLight.position.set(6, 9, 7);
    scene.add(keyLight);

    const meshRoot = new THREE.Group();
    meshRoot.name = 'inspection_mesh';
    const pointsRoot = new THREE.Group();
    pointsRoot.name = 'inspection_points';
    const raysRoot = new THREE.Group();
    raysRoot.name = 'inspection_rays';
    const camerasRoot = new THREE.Group();
    camerasRoot.name = 'inspection_cameras';
    const selectedCameraRoot = new THREE.Group();
    selectedCameraRoot.name = 'inspection_selected_camera';
    scene.add(meshRoot, pointsRoot, raysRoot, camerasRoot, selectedCameraRoot);

    let grid = null;
    const axes = new THREE.AxesHelper(1.2);
    axes.name = 'inspection_axes';
    scene.add(axes);

    let sceneRadius = 4;
    let selectedScanId = null;
    let cameraViews = [];
    const cameraMarkers = [];
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const orbit = {
      target: new THREE.Vector3(0, 1.5, 0),
      radius: 11,
      theta: Math.PI * 0.72,
      phi: Math.PI * 0.34,
      dragging: false,
      mode: 'orbit',
      pointerId: null,
      x: 0,
      y: 0,
      moved: false
    };

    const layers = {
      mesh: true,
      points: true,
      rays: true,
      cameras: true
    };

    function disposeMaterial(material) {
      if (Array.isArray(material)) {
        material.forEach(disposeMaterial);
        return;
      }
      material?.dispose?.();
    }

    function clearGroup(group) {
      while (group.children.length) {
        const child = group.children[group.children.length - 1];
        group.remove(child);
        child.geometry?.dispose?.();
        disposeMaterial(child.material);
        if (child.children?.length) clearGroup(child);
      }
    }

    function updateCamera() {
      const sinPhi = Math.sin(orbit.phi);
      camera.position.set(
        orbit.target.x + orbit.radius * sinPhi * Math.sin(orbit.theta),
        orbit.target.y + orbit.radius * Math.cos(orbit.phi),
        orbit.target.z + orbit.radius * sinPhi * Math.cos(orbit.theta)
      );
      camera.lookAt(orbit.target);
      camera.updateMatrixWorld();
    }

    function rebuildGrid() {
      if (grid) {
        scene.remove(grid);
        grid.geometry?.dispose?.();
        disposeMaterial(grid.material);
      }
      const size = Math.max(8, sceneRadius * 3.2);
      const divisions = Math.max(12, Math.min(40, Math.round(size * 2)));
      grid = new THREE.GridHelper(size, divisions, 0x4b5261, 0x2b303a);
      grid.position.y = 0;
      scene.add(grid);
    }

    function fitScene(snapshot) {
      const center = snapshot?.preview?.center || [0, 1.5, 0];
      sceneRadius = Math.max(0.75, Number(snapshot?.preview?.radius) || 4);
      orbit.target.set(Number(center[0]) || 0, Number(center[1]) || 0, Number(center[2]) || 0);
      orbit.radius = Math.max(3.2, sceneRadius * 2.75);
      orbit.theta = Math.PI * 0.72;
      orbit.phi = Math.PI * 0.34;
      camera.near = Math.max(0.01, sceneRadius / 500);
      camera.far = Math.max(100, sceneRadius * 30);
      camera.updateProjectionMatrix();
      rebuildGrid();
      updateCamera();
    }

    function setSceneSnapshot(snapshot) {
      clearGroup(meshRoot);
      const positions = snapshot?.preview?.positions || [];
      if (positions.length >= 9) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(new Float32Array(positions), 3)
        );
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({
          color: 0xb8bec9,
          roughness: 0.82,
          metalness: 0.04,
          side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'normalized_source_mesh';
        meshRoot.add(mesh);
      }
      fitScene(snapshot);
      syncLayerVisibility();
    }

    function setScanSnapshot(snapshot) {
      clearGroup(pointsRoot);
      clearGroup(raysRoot);

      const positions = snapshot?.points?.positions || [];
      const confidence = snapshot?.points?.confidence || [];
      if (positions.length >= 3) {
        const geometry = new THREE.BufferGeometry();
        const pos = new Float32Array(positions);
        const colors = new Float32Array(pos.length);
        for (let i = 0, p = 0; i < pos.length; i += 3, p++) {
          const [r, g, b] = confidenceRgb((confidence[p] || 0) / 255);
          colors[i] = r;
          colors[i + 1] = g;
          colors[i + 2] = b;
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        const material = new THREE.PointsMaterial({
          size: clamp(sceneRadius * 0.012, 0.035, 0.11),
          sizeAttenuation: true,
          vertexColors: true,
          transparent: true,
          opacity: 0.95
        });
        const points = new THREE.Points(geometry, material);
        points.name = 'cached_hit_point_cloud';
        pointsRoot.add(points);
      }

      const rayPositions = snapshot?.rays?.positions || [];
      if (rayPositions.length >= 6) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(new Float32Array(rayPositions), 3)
        );
        const material = new THREE.LineBasicMaterial({
          color: 0x79a7d8,
          transparent: true,
          opacity: 0.22
        });
        const lines = new THREE.LineSegments(geometry, material);
        lines.name = 'cached_hit_ray_preview';
        raysRoot.add(lines);
      }

      selectedScanId = snapshot?.scan_id || selectedScanId;
      rebuildSelectedCamera();
      syncCameraMaterials();
      syncLayerVisibility();
    }

    function cameraViewFrom(raw) {
      if (!raw) return null;
      const position = raw.position || raw.camera_position;
      const target = raw.target || raw.camera_target;
      if (!Array.isArray(position) || !Array.isArray(target)) return null;
      return {
        scanId: raw.scanId || raw.scan_id || null,
        name: raw.name || null,
        label: raw.label || raw.name || raw.scanId || raw.scan_id || 'Scan',
        position: position.map(Number),
        target: target.map(Number),
        fov: Number(raw.fov || raw.fov_deg || 55),
        width: Number(raw.width || 1),
        height: Number(raw.height || 1)
      };
    }

    function setCameraViews(rawViews, nextSelectedScanId = selectedScanId) {
      clearGroup(camerasRoot);
      cameraMarkers.length = 0;
      cameraViews = (rawViews || []).map(cameraViewFrom).filter(Boolean);
      selectedScanId = nextSelectedScanId || cameraViews[0]?.scanId || null;

      const markerRadius = clamp(sceneRadius * 0.045, 0.08, 0.22);
      for (const view of cameraViews) {
        const group = new THREE.Group();
        group.name = `inspection_camera_${view.scanId || view.name || 'scan'}`;
        group.position.fromArray(view.position);

        const geometry = new THREE.SphereGeometry(markerRadius, 14, 10);
        const material = new THREE.MeshStandardMaterial({
          color: 0x8a94a6,
          roughness: 0.45,
          metalness: 0.15
        });
        const marker = new THREE.Mesh(geometry, material);
        marker.userData.scanId = view.scanId;
        marker.userData.cameraView = view;
        group.add(marker);
        cameraMarkers.push(marker);

        const toTarget = new THREE.Vector3().fromArray(view.target)
          .sub(new THREE.Vector3().fromArray(view.position));
        const length = Math.max(markerRadius * 2, toTarget.length());
        if (length > 1e-6) {
          const arrow = new THREE.ArrowHelper(
            toTarget.clone().normalize(),
            new THREE.Vector3(0, 0, 0),
            Math.min(length, sceneRadius * 0.8),
            0x687384,
            markerRadius * 0.9,
            markerRadius * 0.55
          );
          arrow.userData.scanId = view.scanId;
          group.add(arrow);
        }
        camerasRoot.add(group);
      }

      syncCameraMaterials();
      rebuildSelectedCamera();
      syncLayerVisibility();
    }

    function syncCameraMaterials() {
      for (const marker of cameraMarkers) {
        const selected = marker.userData.scanId === selectedScanId;
        if (marker.material?.color) {
          marker.material.color.setHex(selected ? 0xffd166 : 0x8a94a6);
          marker.material.emissive?.setHex(selected ? 0x3a2c00 : 0x000000);
        }
        marker.scale.setScalar(selected ? 1.35 : 1);
      }
    }

    function rebuildSelectedCamera() {
      clearGroup(selectedCameraRoot);
      const view = cameraViews.find(item => item.scanId === selectedScanId);
      if (!view) return;

      const position = new THREE.Vector3().fromArray(view.position);
      const target = new THREE.Vector3().fromArray(view.target);
      const direction = target.clone().sub(position);
      const distance = Math.max(0.5, direction.length());

      const arrow = new THREE.ArrowHelper(
        direction.clone().normalize(),
        position,
        Math.min(distance, sceneRadius * 1.25),
        0xffd166,
        clamp(sceneRadius * 0.14, 0.18, 0.5),
        clamp(sceneRadius * 0.08, 0.12, 0.32)
      );
      arrow.name = 'selected_camera_direction';
      selectedCameraRoot.add(arrow);

      const aspect = Math.max(0.1, view.width / Math.max(1, view.height));
      const sensorCamera = new THREE.PerspectiveCamera(
        clamp(view.fov, 5, 150),
        aspect,
        Math.max(0.04, sceneRadius * 0.02),
        Math.max(distance * 1.15, sceneRadius * 2)
      );
      sensorCamera.position.copy(position);
      sensorCamera.up.set(0, 1, 0);
      sensorCamera.lookAt(target);
      sensorCamera.updateProjectionMatrix();
      sensorCamera.updateMatrixWorld(true);
      sensorCamera.name = 'selected_lidar_camera';
      selectedCameraRoot.add(sensorCamera);

      const helper = new THREE.CameraHelper(sensorCamera);
      helper.name = 'selected_camera_frustum';
      selectedCameraRoot.add(helper);
    }

    function setSelectedScan(scanId) {
      selectedScanId = scanId || null;
      syncCameraMaterials();
      rebuildSelectedCamera();
    }

    function setLayers(next = {}) {
      for (const key of Object.keys(layers)) {
        if (key in next) layers[key] = !!next[key];
      }
      syncLayerVisibility();
    }

    function syncLayerVisibility() {
      meshRoot.visible = !!layers.mesh;
      pointsRoot.visible = !!layers.points;
      raysRoot.visible = !!layers.rays;
      camerasRoot.visible = !!layers.cameras;
      selectedCameraRoot.visible = !!layers.cameras;
      axes.visible = !!layers.mesh;
      if (grid) grid.visible = !!layers.mesh;
    }

    function resetView() {
      orbit.radius = Math.max(3.2, sceneRadius * 2.75);
      orbit.theta = Math.PI * 0.72;
      orbit.phi = Math.PI * 0.34;
      updateCamera();
    }

    function pointerCoordinates(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    }

    function pickCamera(event) {
      if (!layers.cameras || !cameraMarkers.length) return;
      pointerCoordinates(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(cameraMarkers, false)[0];
      const scanId = hit?.object?.userData?.scanId;
      if (!scanId) return;
      setSelectedScan(scanId);
      if (typeof onSelectScan === 'function') onSelectScan(scanId);
    }

    renderer.domElement.addEventListener('pointerdown', event => {
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
      orbit.dragging = true;
      orbit.mode = event.button === 2 || event.shiftKey ? 'pan' : 'orbit';
      orbit.pointerId = event.pointerId;
      orbit.x = event.clientX;
      orbit.y = event.clientY;
      orbit.moved = false;
      renderer.domElement.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    renderer.domElement.addEventListener('pointermove', event => {
      if (!orbit.dragging || event.pointerId !== orbit.pointerId) return;
      const dx = event.clientX - orbit.x;
      const dy = event.clientY - orbit.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) orbit.moved = true;
      orbit.x = event.clientX;
      orbit.y = event.clientY;

      if (orbit.mode === 'pan') {
        camera.updateMatrixWorld();
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        const scale = orbit.radius * 0.0018;
        orbit.target.addScaledVector(right, -dx * scale);
        orbit.target.addScaledVector(up, dy * scale);
      } else {
        orbit.theta -= dx * 0.007;
        orbit.phi = clamp(orbit.phi + dy * 0.007, 0.08, Math.PI - 0.08);
      }
      updateCamera();
    });

    function endPointer(event) {
      if (!orbit.dragging || event.pointerId !== orbit.pointerId) return;
      const shouldPick = !orbit.moved && event.button === 0;
      orbit.dragging = false;
      orbit.pointerId = null;
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      if (shouldPick) pickCamera(event);
    }

    renderer.domElement.addEventListener('pointerup', endPointer);
    renderer.domElement.addEventListener('pointercancel', endPointer);
    renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
    renderer.domElement.addEventListener('wheel', event => {
      event.preventDefault();
      orbit.radius = clamp(
        orbit.radius * Math.exp(event.deltaY * 0.0012),
        Math.max(0.5, sceneRadius * 0.35),
        Math.max(20, sceneRadius * 15)
      );
      updateCamera();
    }, { passive: false });

    function resize() {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }

    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(resize)
      : null;
    observer?.observe(container);
    globalThis.addEventListener?.('resize', resize);
    resize();
    updateCamera();

    let disposed = false;
    function animate() {
      if (disposed) return;
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

    function dispose() {
      disposed = true;
      observer?.disconnect();
      globalThis.removeEventListener?.('resize', resize);
      clearGroup(meshRoot);
      clearGroup(pointsRoot);
      clearGroup(raysRoot);
      clearGroup(camerasRoot);
      clearGroup(selectedCameraRoot);
      grid?.geometry?.dispose?.();
      disposeMaterial(grid?.material);
      renderer.dispose();
      renderer.domElement.remove();
    }

    function stats() {
      return Object.freeze({
        meshTriangles: meshRoot.children[0]?.geometry?.getAttribute('position')?.count
          ? Math.floor(meshRoot.children[0].geometry.getAttribute('position').count / 3)
          : 0,
        pointCount: pointsRoot.children[0]?.geometry?.getAttribute('position')?.count || 0,
        rayCount: raysRoot.children[0]?.geometry?.getAttribute('position')?.count
          ? Math.floor(raysRoot.children[0].geometry.getAttribute('position').count / 2)
          : 0,
        cameraCount: cameraViews.length,
        selectedScanId
      });
    }

    return Object.freeze({
      setSceneSnapshot,
      setScanSnapshot,
      setCameraViews,
      setSelectedScan,
      setLayers,
      resetView,
      stats,
      dispose
    });
  }

  window.LineArtInspectionViewer = Object.freeze({
    createInspectionViewer,
    confidenceRgb
  });
})();

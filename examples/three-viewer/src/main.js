import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createThreeBodyMeshManager } from '@threecyborgs/wasm-box3d-three';
import './styles.css';

const canvas = document.querySelector('#scene');
const bodyCountEl = document.querySelector('#body-count');
const stepCountEl = document.querySelector('#step-count');
const fpsReadoutEl = document.querySelector('#fps-readout');
const physicsFpsReadoutEl = document.querySelector('#physics-fps-readout');
const profileReadoutEl = document.querySelector('#profile-readout');
const stressStatusEl = document.querySelector('#stress-status');
const wasmStatusEl = document.querySelector('#wasm-status');
const pauseButton = document.querySelector('#toggle-pause');
const startStressButton = document.querySelector('#start-stress');
const stopStressButton = document.querySelector('#stop-stress');
const gravityInput = document.querySelector('#gravity');
const labEngineEl = document.querySelector('#lab-engine');
const labStatusEl = document.querySelector('#lab-status');
const labScenarioInput = document.querySelector('#lab-scenario');
const labDurationInput = document.querySelector('#lab-duration');
const labIntervalInput = document.querySelector('#lab-interval');
const labCountInput = document.querySelector('#lab-count');
const labBatchInput = document.querySelector('#lab-batch');
const labRowsInput = document.querySelector('#lab-rows');
const labSpacingInput = document.querySelector('#lab-spacing');
const labRunButton = document.querySelector('#lab-run');
const labStopButton = document.querySelector('#lab-stop');
const labApplyButton = document.querySelector('#lab-apply');
const labDownloadButton = document.querySelector('#lab-download');
const labJsonInput = document.querySelector('#lab-json');
const labRenderPathEl = document.querySelector('#lab-render-path');
const labSimPathEl = document.querySelector('#lab-sim-path');
const labLastSampleEl = document.querySelector('#lab-last-sample');

const STRESS_START_BLOCKS = 64;
const STRESS_TARGET_FPS = 20;
const STRESS_WARMUP_MS = 1000;
const STRESS_SAMPLE_MS = 2400;
const FPS_WINDOW_SIZE = 90;
const LAB_SAMPLE_MS = 250;
const LIVE_SNAPSHOT_MS = 1000 / 60;
const LAB_ARENA_PREVIEW_DEBOUNCE_MS = 180;
const LAB_ARENA_MARGIN = 10;
const LAB_CHART = { x: 34, y: 14, width: 292, height: 96 };
const LAB_SCENARIOS = {
  pileDrop: {
    label: 'Pile drop',
    defaults: {
      scenario: 'pileDrop',
      name: '256 block pile drops',
      durationMs: 18000,
      intervalMs: 1400,
      count: 2048,
      batchSize: 256,
      rows: 1,
      spacing: 8,
    },
  },
  lineSpawn: {
    label: 'Line spawn',
    defaults: {
      scenario: 'lineSpawn',
      name: 'line spawn batches',
      durationMs: 160000,
      intervalMs: 16,
      count: 30000,
      batchSize: 100,
      rows: 1,
      spacing: 0.5,
    },
  },
  dominoSpiral: {
    label: 'Domino spiral',
    defaults: {
      scenario: 'dominoSpiral',
      name: 'single spiral domino knockdown',
      durationMs: 20000,
      intervalMs: 750,
      count: 720,
      batchSize: 720,
      rows: 1,
      spacing: 0.42,
    },
  },
  multiSpiral: {
    label: 'Multi spiral',
    defaults: {
      scenario: 'multiSpiral',
      name: 'multi-row spiral domino knockdown',
      durationMs: 22000,
      intervalMs: 900,
      count: 1440,
      batchSize: 360,
      rows: 4,
      spacing: 0.48,
    },
  },
};
const urlParams = new URLSearchParams(window.location.search);
const engineParam = urlParams.get('engine');
const physicsEngine = engineParam === 'rapier' ? 'rapier' : 'box3d';
const threadParam = urlParams.get('threads');
const benchmarkMode = urlParams.get('benchmark') === '1' || urlParams.get('benchmark') === 'true';
const benchmarkSnapshotMs = Number(urlParams.get('snapshotMs') ?? 250);
const physicsThreadMode = threadParam === 'single' ? false : threadParam === 'pthreads' ? true : 'auto';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111419);

const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 2400);
camera.position.set(170, 96, 170);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 3.0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 8;
controls.maxDistance = 900;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const hemi = new THREE.HemisphereLight(0xf1f5f9, 0x1c2128, 2.4);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 3.0);
sun.position.set(-6, 12, 8);
sun.castShadow = false;
scene.add(sun);

const grid = new THREE.GridHelper(32, 32, 0x5c6670, 0x252c35);
grid.position.y = 0.01;
scene.add(grid);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const spawnPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -7.5);
const spawnPoint = new THREE.Vector3();
const dragStart = new THREE.Vector2();
let pointerWasDragged = false;
let labArenaPreviewTimer = 0;
let labArenaHalfWidth = 14;

let physics;
let meshManager;
let currentScene = 0;
let paused = false;
let syncedStateVersion = -1;
let fpsSamples = [];
let fpsAverage = 0;
let syncMs = 0;
let renderMs = 0;
let lastSnapshotRequestedAt = 0;
let lastSleepTestSample = null;
let stressRun = {
  active: false,
  target: 0,
  created: 0,
  bodies: 0,
  roundStartedAt: 0,
  sampleStartedAt: 0,
  sampleFrames: 0,
  sampleMs: 0,
  lastAverage: 0,
  result: 'stress idle',
};
let labConfig = structuredClone(LAB_SCENARIOS.pileDrop.defaults);
let labRun = {
  active: false,
  config: null,
  startedAt: 0,
  nextActionAt: 0,
  lastSampleAt: 0,
  spawned: 0,
  batchIndex: 0,
  samples: [],
  result: null,
  resolve: null,
};

function createWorkerPhysics(sceneIndex) {
  const workerUrl =
    physicsEngine === 'rapier'
      ? new URL('./rapier-worker.js', import.meta.url)
      : new URL('./physics-worker.js', import.meta.url);
  const worker = new Worker(workerUrl, { type: 'module' });
  let readyResolve;
  let stateVersion = 0;
  let snapshotPending = false;
  let state = {
    bodyCount: 0,
    awakeBodyCount: 0,
    bodyStride: 14,
    bodyData: new Float32Array(),
    stepCount: 0,
    stressDynamicCount: 0,
    lastStressRequest: 0,
    maxBodies: 0,
    physicsHz: 0,
    physicsStepMs: 0,
    physicsCapacityFps: 0,
    renderSyncMs: 0,
    snapshotCopyMs: 0,
    snapshotBytes: 0,
    resetStressMs: 0,
    spawnBodiesMs: 0,
    spawnBodiesCount: 0,
    spawnBatchCount: 0,
    lastForceSleepMs: 0,
    forcedSleepBodies: 0,
    threadsEnabled: false,
  };
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });

  worker.addEventListener('message', (event) => {
    if (event.data.type !== 'state') {
      return;
    }

    state = event.data;
    stateVersion += 1;
    snapshotPending = false;
    readyResolve();
  });

  worker.addEventListener('error', (error) => {
    wasmStatusEl.textContent = 'worker failed';
    console.error(error);
  });

  worker.postMessage({ type: 'init', sceneIndex, threads: physicsThreadMode, benchmarkMode });

  return {
    ready,
    post(message) {
      worker.postMessage(message);
    },
    getStateVersion() {
      return stateVersion;
    },
    reset(nextSceneIndex = 0) {
      worker.postMessage({ type: 'reset', sceneIndex: nextSceneIndex });
    },
    resetStress(dynamicBlockCount = 64) {
      worker.postMessage({ type: 'resetStress', dynamicBlockCount });
    },
    resetArena(halfWidth = 64) {
      worker.postMessage({ type: 'resetArena', halfWidth });
    },
    spawnBox(position = {}, velocity = {}) {
      worker.postMessage({ type: 'spawnBox', position, velocity });
    },
    addBodies(bodies = []) {
      worker.postMessage({ type: 'addBodies', bodies });
    },
    spawnSphere(position = {}, velocity = {}) {
      worker.postMessage({ type: 'spawnSphere', position, velocity });
    },
    setGravityEnabled(enabled) {
      worker.postMessage({ type: 'setGravityEnabled', enabled });
    },
    setPaused(nextPaused) {
      worker.postMessage({ type: 'setPaused', paused: nextPaused });
    },
    requestSnapshot() {
      if (snapshotPending) {
        return;
      }

      snapshotPending = true;
      worker.postMessage({ type: 'requestSnapshot' });
    },
    getBodyCount() {
      return state.bodyCount;
    },
    getAwakeBodyCount() {
      return state.awakeBodyCount;
    },
    getBodyStride() {
      return state.bodyStride;
    },
    getBodyData() {
      return state.bodyData;
    },
    getStepCount() {
      return state.stepCount;
    },
    getStressDynamicCount() {
      return state.stressDynamicCount;
    },
    getLastStressRequest() {
      return state.lastStressRequest;
    },
    getMaxBodies() {
      return state.maxBodies;
    },
    getPhysicsHz() {
      return state.physicsHz;
    },
    getPhysicsStepMs() {
      return state.physicsStepMs;
    },
    getPhysicsCapacityFps() {
      return state.physicsCapacityFps;
    },
    getRenderSyncMs() {
      return state.renderSyncMs;
    },
    getSnapshotCopyMs() {
      return state.snapshotCopyMs;
    },
    getSnapshotBytes() {
      return state.snapshotBytes;
    },
    getResetStressMs() {
      return state.resetStressMs;
    },
    getSpawnBodiesMs() {
      return state.spawnBodiesMs;
    },
    getSpawnBodiesCount() {
      return state.spawnBodiesCount;
    },
    getSpawnBatchCount() {
      return state.spawnBatchCount;
    },
    getLastForceSleepMs() {
      return state.lastForceSleepMs;
    },
    getForcedSleepBodies() {
      return state.forcedSleepBodies;
    },
    getThreadsEnabled() {
      return state.threadsEnabled === true;
    },
  };
}

function resize() {
  const { clientWidth, clientHeight } = canvas;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / Math.max(1, clientHeight);
  camera.updateProjectionMatrix();
}

function resetScene(index) {
  window.clearTimeout(labArenaPreviewTimer);
  stopLab('scene reset');
  stopStress(stressRun.active ? 'stress stopped' : stressRun.result);
  currentScene = index;
  physics.reset(index);
}

function boundedNumber(value, fallback, min = -Infinity, max = Infinity) {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return fallback;
  }
  return THREE.MathUtils.clamp(next, min, max);
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function normalizeLabConfig(config = {}) {
  const scenario = LAB_SCENARIOS[config.scenario] ? config.scenario : 'pileDrop';
  const defaults = LAB_SCENARIOS[scenario].defaults;
  return {
    ...defaults,
    ...config,
    scenario,
    durationMs: Math.round(boundedNumber(config.durationMs, defaults.durationMs, 1000, 180000)),
    intervalMs: Math.round(boundedNumber(config.intervalMs, defaults.intervalMs, 16, 60000)),
    count: Math.round(boundedNumber(config.count, defaults.count, 1, 10000000)),
    batchSize: Math.round(boundedNumber(config.batchSize, defaults.batchSize, 1, 1000000)),
    rows: Math.round(boundedNumber(config.rows, defaults.rows, 1, 256)),
    spacing: boundedNumber(config.spacing, defaults.spacing, 0.1, 64),
  };
}

function updateLabJson() {
  labJsonInput.value = JSON.stringify(labConfig, null, 2);
}

function syncLabFormFromConfig() {
  labScenarioInput.value = labConfig.scenario;
  labDurationInput.value = labConfig.durationMs;
  labIntervalInput.value = labConfig.intervalMs;
  labCountInput.value = labConfig.count;
  labBatchInput.value = labConfig.batchSize;
  labRowsInput.value = labConfig.rows;
  labSpacingInput.value = labConfig.spacing;
  updateLabJson();
}

function readLabFormConfig() {
  labConfig = normalizeLabConfig({
    ...labConfig,
    scenario: labScenarioInput.value,
    durationMs: labDurationInput.value,
    intervalMs: labIntervalInput.value,
    count: labCountInput.value,
    batchSize: labBatchInput.value,
    rows: labRowsInput.value,
    spacing: labSpacingInput.value,
  });
  updateLabJson();
  return cloneConfig(labConfig);
}

function setLabControls(active) {
  labRunButton.disabled = active;
  labStopButton.disabled = !active;
  labDownloadButton.disabled = !labRun.result;
}

function setLabStatus(status) {
  labStatusEl.textContent = status;
}

function labColor(index, channel = 0) {
  const tint = ((index * 37 + channel * 19) % 100) / 100;
  return {
    x: 0.22 + tint * 0.5,
    y: 0.45 + ((index * 17) % 45) / 100,
    z: 0.78 - tint * 0.34,
  };
}

function getPileFootprint(config) {
  return Math.max(2, Math.ceil(Math.sqrt(config.batchSize / 4)));
}

function getPileRadius(config) {
  return getPileFootprint(config) * 0.78 * 0.5 + 4;
}

function getPileSpiralCenter(config, pileIndex) {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const spiralRadius = Math.sqrt(pileIndex) * config.spacing;
  const spiralAngle = pileIndex * goldenAngle;
  return {
    x: Math.cos(spiralAngle) * spiralRadius,
    z: Math.sin(spiralAngle) * spiralRadius,
  };
}

function getPileLayoutBounds(config) {
  const pileCount = Math.max(1, Math.ceil(config.count / Math.max(1, config.batchSize)));
  const bounds = {
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
  };

  for (let pileIndex = 0; pileIndex < pileCount; pileIndex += 1) {
    const center = getPileSpiralCenter(config, pileIndex);
    bounds.minX = Math.min(bounds.minX, center.x);
    bounds.maxX = Math.max(bounds.maxX, center.x);
    bounds.minZ = Math.min(bounds.minZ, center.z);
    bounds.maxZ = Math.max(bounds.maxZ, center.z);
  }

  return bounds;
}

function estimateLabArenaHalfWidth(config) {
  if (config.scenario === 'pileDrop') {
    const bounds = getPileLayoutBounds(config);
    const pileRadius = getPileRadius(config);
    return Math.max(
      48,
      (bounds.maxX - bounds.minX) * 0.5 + pileRadius + LAB_ARENA_MARGIN,
      (bounds.maxZ - bounds.minZ) * 0.5 + pileRadius + LAB_ARENA_MARGIN
    );
  }
  if (config.scenario === 'lineSpawn') {
    const rowWidth = Math.max(1, Math.ceil(Math.sqrt(config.count)));
    const rowCount = Math.ceil(config.count / rowWidth);
    return Math.max(48, (rowWidth - 1) * config.spacing * 0.5 + LAB_ARENA_MARGIN, (rowCount - 1) * config.spacing * 0.5 + LAB_ARENA_MARGIN);
  }
  if (config.scenario === 'dominoSpiral' || config.scenario === 'multiSpiral') {
    const scenarioRows = config.scenario === 'multiSpiral' ? config.rows : 1;
    const perRow = Math.max(1, Math.ceil(config.count / scenarioRows));
    return Math.max(48, 2.2 + perRow * config.spacing * 0.18 + scenarioRows * 2.6 + 16);
  }
  return Math.max(42, Math.ceil(config.count / Math.max(1, config.batchSize)) * config.spacing + 20);
}

function applyLabArenaVisuals(halfWidth) {
  labArenaHalfWidth = halfWidth;
  const diameter = Math.max(32, halfWidth * 2);
  grid.scale.set(diameter / 32, 1, diameter / 32);
  controls.maxDistance = Math.max(900, halfWidth * 6);
  camera.far = Math.max(2400, halfWidth * 10);
  camera.updateProjectionMatrix();
}

function previewLabArena({ immediate = false } = {}) {
  if (!physics || labRun.active) {
    return;
  }

  window.clearTimeout(labArenaPreviewTimer);
  const update = () => {
    const halfWidth = estimateLabArenaHalfWidth(labConfig);
    applyLabArenaVisuals(halfWidth);
    currentScene = 4;
    physics.resetArena(halfWidth);
    lastSnapshotRequestedAt = 0;
    setLabStatus(`arena ${Math.round(halfWidth * 2)} wide`);
  };

  if (immediate) {
    update();
    return;
  }

  labArenaPreviewTimer = window.setTimeout(update, LAB_ARENA_PREVIEW_DEBOUNCE_MS);
}

function makePileBatch(config, startIndex, batchSize) {
  const pileIndex = Math.floor(startIndex / Math.max(1, config.batchSize));
  const footprint = Math.max(2, Math.ceil(Math.sqrt(batchSize / 4)));
  const layerHeight = 0.74;
  const bounds = getPileLayoutBounds(config);
  const pileRadius = getPileRadius(config);
  const center = getPileSpiralCenter(config, pileIndex);
  const baseX = center.x + (LAB_ARENA_MARGIN + pileRadius - labArenaHalfWidth - bounds.minX);
  const baseZ = center.z + (LAB_ARENA_MARGIN + pileRadius - labArenaHalfWidth - bounds.minZ);
  const bodies = [];

  for (let i = 0; i < batchSize; i += 1) {
    const local = startIndex + i;
    const x = i % footprint;
    const z = Math.floor(i / footprint) % footprint;
    const y = Math.floor(i / (footprint * footprint));
    bodies.push({
      bodyType: 'dynamic',
      position: {
        x: baseX + (x - (footprint - 1) * 0.5) * 0.78,
        y: 1.1 + y * layerHeight,
        z: baseZ + (z - (footprint - 1) * 0.5) * 0.78,
      },
      halfExtents: { x: 0.34, y: 0.34, z: 0.34 },
      velocity: { x: ((local % 7) - 3) * 0.08, y: 0, z: ((local % 5) - 2) * 0.08 },
      color: labColor(local),
      density: 1,
    });
  }

  return bodies;
}

function makeLineBatch(config, startIndex, batchSize) {
  const bodies = [];
  const rowWidth = Math.max(1, Math.ceil(Math.sqrt(config.count)));
  const startX = -labArenaHalfWidth + LAB_ARENA_MARGIN;
  const startZ = -labArenaHalfWidth + LAB_ARENA_MARGIN;
  for (let i = 0; i < batchSize; i += 1) {
    const index = startIndex + i;
    const x = startX + (index % rowWidth) * config.spacing;
    const z = startZ + Math.floor(index / rowWidth) * config.spacing;
    bodies.push({
      bodyType: 'dynamic',
      position: { x, y: 3.8 + (index % 4) * 0.08, z },
      halfExtents: { x: 0.32, y: 0.32, z: 0.32 },
      velocity: { x: 0, y: 0, z: 0 },
      color: labColor(index, 1),
      density: 1,
    });
  }
  return bodies;
}

function makeSpiralDomino(index, row, perRow, config, push) {
  const angle = index * 0.34 + row * 0.26;
  const radius = 2.2 + index * config.spacing * 0.18 + row * 2.6;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const yaw = angle + Math.PI * 0.5;
  const pushSpeed = push ? 5.4 : 0;
  return {
    bodyType: 'dynamic',
    position: { x, y: 0.92, z },
    halfExtents: { x: 0.11, y: 0.72, z: 0.32 },
    velocity: {
      x: Math.cos(yaw) * pushSpeed,
      y: 0,
      z: Math.sin(yaw) * pushSpeed,
    },
    rotationY: yaw,
    color: labColor(row * perRow + index, 2),
    density: 0.85,
  };
}

function makeDominoBatch(config, startIndex, batchSize) {
  const scenarioRows = config.scenario === 'multiSpiral' ? config.rows : 1;
  const perRow = Math.max(1, Math.ceil(config.count / scenarioRows));
  const bodies = [];
  for (let i = 0; i < batchSize; i += 1) {
    const globalIndex = startIndex + i;
    const row = Math.floor(globalIndex / perRow);
    const index = globalIndex % perRow;
    const push = config.scenario === 'multiSpiral' ? index === 0 : globalIndex === 0;
    bodies.push(makeSpiralDomino(index, row, perRow, config, push));
  }
  return bodies;
}

function makeLabBatch(config, startIndex) {
  const remaining = config.count - startIndex;
  const batchSize = Math.min(config.batchSize, remaining);
  if (batchSize <= 0) {
    return [];
  }
  if (config.scenario === 'lineSpawn') {
    return makeLineBatch(config, startIndex, batchSize);
  }
  if (config.scenario === 'dominoSpiral' || config.scenario === 'multiSpiral') {
    return makeDominoBatch(config, startIndex, batchSize);
  }
  return makePileBatch(config, startIndex, batchSize);
}

function drawLabChart(samples = []) {
  if (samples.length < 2) {
    labRenderPathEl.setAttribute('d', '');
    labSimPathEl.setAttribute('d', '');
    return;
  }

  const maxElapsed = Math.max(...samples.map((sample) => sample.elapsedMs), 1);
  const maxValue = Math.max(
    60,
    ...samples.map((sample) => Math.min(240, sample.renderFps || 0)),
    ...samples.map((sample) => Math.min(240, sample.simCapacityFps || 0))
  );
  const makePath = (key) =>
    samples
      .map((sample, index) => {
        const x = LAB_CHART.x + (sample.elapsedMs / maxElapsed) * LAB_CHART.width;
        const y = LAB_CHART.y + LAB_CHART.height - (Math.min(240, sample[key] || 0) / maxValue) * LAB_CHART.height;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

  labRenderPathEl.setAttribute('d', makePath('renderFps'));
  labSimPathEl.setAttribute('d', makePath('simCapacityFps'));
}

function sampleLab(now) {
  const elapsedMs = now - labRun.startedAt;
  const sample = {
    elapsedMs,
    bodyCount: physics.getBodyCount(),
    awakeBodies: physics.getAwakeBodyCount(),
    renderFps: fpsAverage,
    simFps: physics.getPhysicsHz(),
    simCapacityFps: physics.getPhysicsCapacityFps(),
    physicsStepMs: physics.getPhysicsStepMs(),
    renderSyncMs: physics.getRenderSyncMs(),
    syncMs,
    renderMs,
    snapshotCopyMs: physics.getSnapshotCopyMs(),
    spawnBodiesMs: physics.getSpawnBodiesMs(),
    spawnBodiesCount: physics.getSpawnBodiesCount(),
    spawnBatchCount: physics.getSpawnBatchCount(),
  };
  labRun.samples.push(sample);
  drawLabChart(labRun.samples);
  labLastSampleEl.textContent =
    `${Math.round(elapsedMs / 1000)}s ${sample.bodyCount} bodies render ${sample.renderFps.toFixed(1)} sim cap ${sample.simCapacityFps.toFixed(1)}`;
}

function finalizeLabRun(reason = 'complete') {
  if (!labRun.active && !labRun.result) {
    return null;
  }

  const endedAt = performance.now();
  const result = {
    runId: `lab-${Date.now()}`,
    engine: physicsEngine,
    reason,
    config: cloneConfig(labRun.config ?? labConfig),
    startedAt: labRun.startedAt,
    endedAt,
    durationMs: labRun.startedAt ? endedAt - labRun.startedAt : 0,
    spawned: labRun.spawned,
    bodyCount: physics?.getBodyCount?.() ?? 0,
    samples: labRun.samples,
  };
  labRun.active = false;
  labRun.result = result;
  window.__wasmBox3DLabResult = result;
  setLabControls(false);
  setLabStatus(`${reason}: ${result.spawned} bodies`);
  labDownloadButton.disabled = false;
  if (labRun.resolve) {
    labRun.resolve(result);
    labRun.resolve = null;
  }
  return result;
}

function stopLab(reason = 'stopped') {
  if (!labRun.active) {
    return labRun.result;
  }
  return finalizeLabRun(reason);
}

function startLab(config = readLabFormConfig()) {
  const normalized = normalizeLabConfig(config);
  labConfig = cloneConfig(normalized);
  syncLabFormFromConfig();
  window.clearTimeout(labArenaPreviewTimer);
  stopStress(stressRun.active ? 'stress stopped' : stressRun.result);
  currentScene = 4;
  paused = false;
  pauseButton.textContent = 'Pause';
  physics.setPaused(false);
  const halfWidth = estimateLabArenaHalfWidth(normalized);
  applyLabArenaVisuals(halfWidth);
  physics.resetArena(halfWidth);
  fpsSamples = [];
  lastSnapshotRequestedAt = 0;
  drawLabChart([]);
  labLastSampleEl.textContent = 'warming';

  const startedAt = performance.now();
  labRun = {
    active: true,
    config: normalized,
    startedAt,
    nextActionAt: startedAt,
    lastSampleAt: 0,
    spawned: 0,
    batchIndex: 0,
    samples: [],
    result: null,
    resolve: null,
  };
  setLabControls(true);
  setLabStatus(`${LAB_SCENARIOS[normalized.scenario].label} running`);

  return new Promise((resolve) => {
    labRun.resolve = resolve;
  });
}

function evaluateLabRun(now) {
  if (!labRun.active || paused) {
    return;
  }

  const config = labRun.config;
  while (labRun.spawned < config.count && now >= labRun.nextActionAt) {
    const bodies = makeLabBatch(config, labRun.spawned);
    if (bodies.length === 0) {
      break;
    }
    physics.addBodies(bodies);
    labRun.spawned += bodies.length;
    labRun.batchIndex += 1;
    labRun.nextActionAt += config.intervalMs;
  }

  if (labRun.lastSampleAt === 0 || now - labRun.lastSampleAt >= LAB_SAMPLE_MS) {
    sampleLab(now);
    labRun.lastSampleAt = now;
  }

  if (now - labRun.startedAt >= config.durationMs) {
    finalizeLabRun('complete');
  }
}

function downloadLabResult() {
  const result = labRun.result ?? window.__wasmBox3DLabResult;
  if (!result) {
    return;
  }
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${result.runId}-${result.engine}-${result.config.scenario}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function updateReadout() {
  bodyCountEl.textContent = `${physics.getBodyCount()} bodies`;
  stepCountEl.textContent = `step ${physics.getStepCount()}`;
  fpsReadoutEl.textContent = `render ${fpsAverage.toFixed(1)} fps`;
  physicsFpsReadoutEl.textContent = `phys ${physics.getPhysicsHz().toFixed(1)} fps awake ${physics.getAwakeBodyCount()}`;
  profileReadoutEl.textContent =
    `step ${physics.getPhysicsStepMs().toFixed(1)}ms spawn ${physics.getSpawnBodiesMs().toFixed(1)}ms/${physics.getSpawnBodiesCount()} wasm ${physics.getRenderSyncMs().toFixed(1)}ms sync ${syncMs.toFixed(1)}ms render ${renderMs.toFixed(1)}ms snap ${physics.getSnapshotCopyMs().toFixed(1)}ms`;
  stressStatusEl.textContent = getStressLabel();
  window.__wasmBox3DProfile = {
    bodies: physics.getBodyCount(),
    renderFps: fpsAverage,
    physicsFps: physics.getPhysicsHz(),
    awakeBodies: physics.getAwakeBodyCount(),
    physicsStepMs: physics.getPhysicsStepMs(),
    physicsCapacityFps: physics.getPhysicsCapacityFps(),
    renderSyncMs: physics.getRenderSyncMs(),
    syncMs,
    renderMs,
    snapshotCopyMs: physics.getSnapshotCopyMs(),
    snapshotBytes: physics.getSnapshotBytes(),
    resetStressMs: physics.getResetStressMs(),
    spawnBodiesMs: physics.getSpawnBodiesMs(),
    spawnBodiesCount: physics.getSpawnBodiesCount(),
    spawnBatchCount: physics.getSpawnBatchCount(),
    lastForceSleepMs: physics.getLastForceSleepMs(),
    forcedSleepBodies: physics.getForcedSleepBodies(),
    threadsEnabled: physics.getThreadsEnabled(),
    engine: physicsEngine,
    benchmarkMode,
    stressStatus: stressStatusEl.textContent,
    stepCount: physics.getStepCount(),
  };
}

function sampleMotionForTest() {
  if (!physics) {
    return null;
  }

  const bodyData = physics.getBodyData();
  const stride = physics.getBodyStride();
  const bodyCount = physics.getBodyCount();
  const snapshot = new Float32Array(bodyData);
  let maxPositionDelta = 0;
  let meanPositionDelta = 0;
  let movingBodies = 0;
  let comparedBodies = 0;

  if (lastSleepTestSample && lastSleepTestSample.length === snapshot.length) {
    for (let i = 5; i < bodyCount; ++i) {
      const offset = i * stride;
      const dx = snapshot[offset] - lastSleepTestSample[offset];
      const dy = snapshot[offset + 1] - lastSleepTestSample[offset + 1];
      const dz = snapshot[offset + 2] - lastSleepTestSample[offset + 2];
      const delta = Math.hypot(dx, dy, dz);
      maxPositionDelta = Math.max(maxPositionDelta, delta);
      meanPositionDelta += delta;
      comparedBodies += 1;
      if (delta > 0.001) {
        movingBodies += 1;
      }
    }

    if (comparedBodies > 0) {
      meanPositionDelta /= comparedBodies;
    }
  }

  lastSleepTestSample = snapshot;
  return {
    bodyCount,
    awakeBodies: physics.getAwakeBodyCount(),
    comparedBodies,
    maxPositionDelta,
    meanPositionDelta,
    movingBodies,
    physicsFps: physics.getPhysicsHz(),
    physicsStepMs: physics.getPhysicsStepMs(),
    stepCount: physics.getStepCount(),
    stressStatus: stressStatusEl.textContent,
  };
}

function getStressLabel() {
  if (!stressRun.active) {
    return stressRun.result;
  }

  const measured = stressRun.sampleFrames > 0 && stressRun.lastAverage > 0 ? stressRun.lastAverage.toFixed(1) : 'warming';
  return `stress ${stressRun.created}/${stressRun.target} blocks ${measured} phys fps`;
}

function recordFps(actualDt) {
  if (actualDt <= 0) {
    return;
  }

  fpsSamples.push(actualDt);
  if (fpsSamples.length > FPS_WINDOW_SIZE) {
    fpsSamples.shift();
  }

  const total = fpsSamples.reduce((sum, sample) => sum + sample, 0);
  fpsAverage = total > 0 ? fpsSamples.length / total : 0;
}

function setStressControls(active) {
  startStressButton.disabled = active;
  stopStressButton.disabled = !active;
}

function stopStress(result = 'stress idle') {
  stressRun = {
    active: false,
    target: stressRun.target,
    created: stressRun.created,
    bodies: stressRun.bodies,
    roundStartedAt: 0,
    sampleStartedAt: 0,
    sampleFrames: 0,
    sampleMs: 0,
    lastAverage: stressRun.lastAverage,
    result,
  };
  setStressControls(false);
  if (stressStatusEl) {
    stressStatusEl.textContent = result;
  }
}

function startStressRound(target) {
  const maxDynamicBlocks = Math.max(1, physics.getMaxBodies() - 5);
  const requested = Math.min(target, maxDynamicBlocks);

  physics.resetStress(requested);
  lastSleepTestSample = null;

  currentScene = 3;
  paused = false;
  pauseButton.textContent = 'Pause';
  physics.setPaused(false);
  fpsSamples = [];
  stressRun = {
    active: true,
    target: requested,
    created: 0,
    bodies: 0,
    roundStartedAt: performance.now(),
    sampleStartedAt: 0,
    sampleFrames: 0,
    sampleMs: 0,
    lastAverage: 0,
    result: `stress 0/${requested} blocks`,
  };
  setStressControls(true);
  updateReadout();
}

function startStress() {
  startStressRound(STRESS_START_BLOCKS);
}

function evaluateStressRound(now, actualDt) {
  if (!stressRun.active || paused) {
    return;
  }

  if (physics.getLastStressRequest() === stressRun.target) {
    stressRun.created = physics.getStressDynamicCount();
    stressRun.bodies = physics.getBodyCount();
  }

  if (now - stressRun.roundStartedAt < STRESS_WARMUP_MS) {
    return;
  }

  if (stressRun.sampleStartedAt === 0) {
    stressRun.sampleStartedAt = now;
    stressRun.sampleFrames = 0;
    stressRun.sampleMs = 0;
  }

  stressRun.sampleFrames += 1;
  stressRun.sampleMs += actualDt * 1000;
  stressRun.lastAverage = physics.getPhysicsHz();

  if (now - stressRun.sampleStartedAt < STRESS_SAMPLE_MS) {
    return;
  }

  const average = physics.getPhysicsHz();
  const maxDynamicBlocks = Math.max(1, physics.getMaxBodies() - 5);

  if (average > 0 && average < STRESS_TARGET_FPS) {
    stopStress(`physics floor hit: ${stressRun.created} blocks at ${average.toFixed(1)} phys fps`);
    return;
  }

  if (stressRun.created < stressRun.target) {
    stopStress(`memory limit near ${stressRun.target} blocks; created ${stressRun.created}`);
    return;
  }

  if (stressRun.target >= maxDynamicBlocks) {
    stopStress(`wasm body cap hit: ${stressRun.created} blocks at ${average.toFixed(1)} phys fps`);
    return;
  }

  startStressRound(Math.min(stressRun.target * 2, maxDynamicBlocks));
}

function screenSpawnPoint(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  raycaster.setFromCamera(pointer, camera);
  raycaster.ray.intersectPlane(spawnPlane, spawnPoint);
  return spawnPoint;
}

function spawn(kind, point = new THREE.Vector3(0, 7, 0)) {
  if (stressRun.active) {
    stopStress('stress stopped');
  }

  const position = {
    x: THREE.MathUtils.clamp(point.x, -6.5, 6.5),
    y: Math.max(4.8, point.y),
    z: THREE.MathUtils.clamp(point.z, -6.5, 6.5),
  };
  const velocity = {
    x: (Math.random() - 0.5) * 2.4,
    y: 0,
    z: (Math.random() - 0.5) * 2.4,
  };

  if (kind === 'sphere') {
    physics.spawnSphere(position, velocity);
  } else {
    physics.spawnBox(position, velocity);
  }
}

function syncLatestPhysicsState() {
  const stateVersion = physics.getStateVersion();
  if (stateVersion === syncedStateVersion) {
    return;
  }

  const syncStartedAt = performance.now();
  meshManager.sync(physics);
  syncMs = performance.now() - syncStartedAt;
  syncedStateVersion = stateVersion;
}

function getSnapshotIntervalMs() {
  if (benchmarkMode) {
    return Math.max(50, benchmarkSnapshotMs);
  }

  const awakeBodies = physics.getAwakeBodyCount();
  if (awakeBodies <= 0) {
    return 500;
  }
  return LIVE_SNAPSHOT_MS;
}

function animate() {
  requestAnimationFrame(animate);
  const actualDt = clock.getDelta();
  const now = performance.now();
  recordFps(actualDt);
  controls.update();

  if (physics) {
    const snapshotIntervalMs = getSnapshotIntervalMs();
    if (now - lastSnapshotRequestedAt >= snapshotIntervalMs) {
      physics.requestSnapshot();
      lastSnapshotRequestedAt = now;
    }
    syncLatestPhysicsState();
    evaluateStressRound(now, actualDt);
    evaluateLabRun(now);
    updateReadout();
  }

  const renderStartedAt = performance.now();
  renderer.render(scene, camera);
  renderMs = performance.now() - renderStartedAt;
}

function bindControls() {
  document.querySelector('#scene-stack').addEventListener('click', () => resetScene(0));
  document.querySelector('#scene-spheres').addEventListener('click', () => resetScene(1));
  document.querySelector('#scene-mixed').addEventListener('click', () => resetScene(2));
  startStressButton.addEventListener('click', startStress);
  stopStressButton.addEventListener('click', () => stopStress('stress stopped'));
  document.querySelector('#spawn-box').addEventListener('click', () => spawn('box'));
  document.querySelector('#spawn-sphere').addEventListener('click', () => spawn('sphere'));
  pauseButton.addEventListener('click', () => {
    paused = !paused;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
    physics.setPaused(paused);
  });
  gravityInput.addEventListener('change', () => physics.setGravityEnabled(gravityInput.checked));
  labScenarioInput.addEventListener('change', () => {
    labConfig = normalizeLabConfig(LAB_SCENARIOS[labScenarioInput.value].defaults);
    syncLabFormFromConfig();
    previewLabArena();
  });
  for (const input of [labDurationInput, labIntervalInput, labCountInput, labBatchInput, labRowsInput, labSpacingInput]) {
    input.addEventListener('input', () => {
      readLabFormConfig();
      previewLabArena();
    });
    input.addEventListener('change', () => {
      readLabFormConfig();
      previewLabArena({ immediate: true });
    });
  }
  labRunButton.addEventListener('click', () => {
    startLab(readLabFormConfig());
  });
  labStopButton.addEventListener('click', () => stopLab('stopped'));
  labApplyButton.addEventListener('click', () => {
    try {
      labConfig = normalizeLabConfig(JSON.parse(labJsonInput.value));
      syncLabFormFromConfig();
      setLabStatus('variant applied');
      previewLabArena({ immediate: true });
    } catch (error) {
      setLabStatus('json error');
      console.error(error);
    }
  });
  labDownloadButton.addEventListener('click', downloadLabResult);
  canvas.addEventListener('pointerdown', (event) => {
    dragStart.set(event.clientX, event.clientY);
    pointerWasDragged = false;
  });
  canvas.addEventListener('pointermove', (event) => {
    if (dragStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 6) {
      pointerWasDragged = true;
    }
  });
  canvas.addEventListener('pointerup', (event) => {
    if (pointerWasDragged) {
      return;
    }

    const point = screenSpawnPoint(event);
    spawn(event.shiftKey ? 'sphere' : 'box', point);
  });
}

window.__wasmBox3DLab = {
  scenarios: LAB_SCENARIOS,
  getConfig() {
    return cloneConfig(labConfig);
  },
  setConfig(config) {
    labConfig = normalizeLabConfig(config);
    syncLabFormFromConfig();
    previewLabArena({ immediate: true });
    return cloneConfig(labConfig);
  },
  run(config) {
    return startLab(config ? normalizeLabConfig(config) : readLabFormConfig());
  },
  stop(reason = 'stopped') {
    return stopLab(reason);
  },
  getResult() {
    return labRun.result ?? window.__wasmBox3DLabResult ?? null;
  },
};

window.__wasmBox3DTest = {
  startStress(dynamicBlockCount = STRESS_START_BLOCKS) {
    startStressRound(dynamicBlockCount);
  },
  resetStress(dynamicBlockCount = STRESS_START_BLOCKS) {
    stopStress(`fixed stress ${dynamicBlockCount}`);
    currentScene = 3;
    paused = false;
    pauseButton.textContent = 'Pause';
    physics.resetStress(dynamicBlockCount);
    physics.setPaused(false);
    lastSleepTestSample = null;
    lastSnapshotRequestedAt = 0;
  },
  stopStress() {
    stopStress('stress stopped');
  },
  sampleMotion() {
    return sampleMotionForTest();
  },
};

async function boot() {
  resize();
  window.addEventListener('resize', resize);

  physics = createWorkerPhysics(currentScene);
  await physics.ready;
  meshManager = createThreeBodyMeshManager({ THREE, scene: worldGroup });
  meshManager.sync(physics);
  syncedStateVersion = physics.getStateVersion();
  bindControls();
  labEngineEl.textContent = physicsEngine;
  syncLabFormFromConfig();
  setLabControls(false);
  updateReadout();
  wasmStatusEl.textContent =
    physicsEngine === 'rapier'
      ? 'rapier active'
      : physics.getThreadsEnabled()
        ? 'wasm pthreads active'
        : 'wasm single-thread active';
  animate();
}

boot().catch((error) => {
  wasmStatusEl.textContent = 'wasm failed';
  console.error(error);
});

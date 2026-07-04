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
const labLineWidthInput = document.querySelector('#lab-line-width');
const labSpacingInput = document.querySelector('#lab-spacing');
const labRunButton = document.querySelector('#lab-run');
const labStopButton = document.querySelector('#lab-stop');
const labApplyButton = document.querySelector('#lab-apply');
const labDownloadButton = document.querySelector('#lab-download');
const labJsonInput = document.querySelector('#lab-json');
const labRenderPathEl = document.querySelector('#lab-render-path');
const labSimPathEl = document.querySelector('#lab-sim-path');
const labLastSampleEl = document.querySelector('#lab-last-sample');
const tuningPanelEl = document.querySelector('.tuning-panel');
const tuningStatusEl = document.querySelector('#tuning-status');
const tuningSubstepsInput = document.querySelector('#tuning-substeps');
const tuningSubstepsValueEl = document.querySelector('#tuning-substeps-value');
const tuningLayoutInput = document.querySelector('#tuning-layout');
const tuningSleepInput = document.querySelector('#tuning-sleep');
const tuningWorkersInput = document.querySelector('#tuning-workers');
const tuningContactHertzInput = document.querySelector('#tuning-contact-hertz');
const tuningContactDampingInput = document.querySelector('#tuning-contact-damping');
const tuningContactSpeedInput = document.querySelector('#tuning-contact-speed');
const tuningContinuousInput = document.querySelector('#tuning-continuous');
const tuningForceSleepInput = document.querySelector('#tuning-force-sleep');
const tuningApplyButton = document.querySelector('#tuning-apply');
const tuningResetButton = document.querySelector('#tuning-reset');
const tuningUrlButton = document.querySelector('#tuning-url');

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
const CAMERA_PROJECTILE_RADIUS = 2.2;
const CAMERA_PROJECTILE_SPEED = 120;
const CAMERA_PROJECTILE_DENSITY = 80;
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
  pileSmash: {
    label: 'Pile smash',
    defaults: {
      scenario: 'pileSmash',
      name: '40k dense pile smash',
      durationMs: 18000,
      intervalMs: 1440,
      count: 40000,
      batchSize: 25600,
      rows: 1,
      spacing: 8,
      performanceOptions: {
        substeps: 2,
        stressLayout: 'islands',
        continuous: false,
        contactHertz: 60,
        contactDampingRatio: 10,
        contactSpeed: 3,
        workerCount: 5,
        contactRecycleDistance: 0.15,
        contactBudgetPerBody: 0,
        regionSleep: false,
      },
      smashShots: [
        { atMs: 5200, x: -42, y: 10, z: 0, targetX: 0, targetY: 4, targetZ: 0, radius: 3.8, speed: 150, density: 160 },
        { atMs: 7200, x: 42, y: 12, z: -10, targetX: 0, targetY: 4, targetZ: 0, radius: 3.8, speed: 155, density: 160 },
        { atMs: 9200, x: 0, y: 13, z: 44, targetX: 0, targetY: 4, targetZ: 0, radius: 4.4, speed: 145, density: 180 },
        { atMs: 11200, x: -24, y: 14, z: -38, targetX: 0, targetY: 4, targetZ: 0, radius: 4.4, speed: 150, density: 180 },
      ],
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
      lineWidth: 14999.5,
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
const parsePositiveNumberParam = (name, fallback) => {
  const value = Number(urlParams.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const parseNonNegativeNumberParam = (name, fallback) => {
  const value = Number(urlParams.get(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};
const resolveChoiceParam = (name, choices, fallback) => {
  const value = urlParams.get(name);
  return choices.includes(value) ? value : fallback;
};
const parseBooleanParam = (name, fallback) => {
  const value = urlParams.get(name);
  if (value == null) {
    return fallback;
  }
  return !['0', 'false', 'off', 'no'].includes(value.toLowerCase());
};
const benchmarkSubsteps = Math.max(1, Math.min(16, Math.round(parsePositiveNumberParam('substeps', 4))));
let box3dPerformanceOptions = {
  substeps: benchmarkSubsteps,
  stressLayout: resolveChoiceParam('stressLayout', ['dense', 'wide', 'islands'], 'dense'),
  sleepPolicy: resolveChoiceParam('sleepPolicy', ['normal', 'aggressive', 'disabled'], 'normal'),
  continuous: parseBooleanParam('continuous', true),
  contactHertz: parsePositiveNumberParam('contactHertz', 30),
  contactDampingRatio: parsePositiveNumberParam('contactDampingRatio', 10),
  contactSpeed: parsePositiveNumberParam('contactSpeed', 3),
  workerCount: Math.round(parsePositiveNumberParam('workerCount', 0)),
  contactRecycleDistance: parseNonNegativeNumberParam('contactRecycleDistance', 0.05),
  contactBudgetPerBody: Math.round(parseNonNegativeNumberParam('contactBudgetPerBody', 0)),
  regionSleep: parseBooleanParam('regionSleep', false),
  regionSleepTileSize: parsePositiveNumberParam('regionSleepTileSize', 8),
  regionSleepSpeed: parsePositiveNumberParam('regionSleepSpeed', 0.08),
  regionSleepMinBodies: Math.round(parsePositiveNumberParam('regionSleepMinBodies', 16)),
};
let forceSleepEnabled = parseBooleanParam('forceSleep', !benchmarkMode);

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
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const spawnPoint = new THREE.Vector3();
const aimPoint = new THREE.Vector3();
const cameraForward = new THREE.Vector3();
const cameraDown = new THREE.Vector3();
const projectileDirection = new THREE.Vector3();
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
    contactCount: 0,
    awakeContactCount: 0,
    islandCount: 0,
    taskCount: 0,
    stackUsed: 0,
    actualWorkers: 0,
    stressLayout: box3dPerformanceOptions.stressLayout,
    sleepPolicy: box3dPerformanceOptions.sleepPolicy,
    continuous: box3dPerformanceOptions.continuous,
    substeps: box3dPerformanceOptions.substeps,
    requestedWorkers: box3dPerformanceOptions.workerCount,
    forceSleepEnabled,
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
    dynamicTreeRebuildMs: 0,
    dynamicTreeRebuildLeaves: 0,
    lastForceSleepMs: 0,
    forcedSleepBodies: 0,
    threadsEnabled: false,
    profile: {},
  };
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });

  worker.addEventListener('message', (event) => {
    if (event.data.type !== 'state') {
      return;
    }

    state = { ...state, ...event.data };
    stateVersion += 1;
    snapshotPending = false;
    readyResolve();
  });

  worker.addEventListener('error', (error) => {
    wasmStatusEl.textContent = 'worker failed';
    console.error(error);
  });

  worker.postMessage({
    type: 'init',
    sceneIndex,
    threads: physicsThreadMode,
    benchmarkMode,
    performanceOptions: box3dPerformanceOptions,
    forceSleepEnabled,
  });

  return {
    ready,
    post(message) {
      worker.postMessage(message);
    },
    getStateVersion() {
      return stateVersion;
    },
    reset(nextSceneIndex = 0) {
      worker.postMessage({ type: 'reset', sceneIndex: nextSceneIndex, ...getPerformancePayload() });
    },
    resetStress(dynamicBlockCount = 64) {
      worker.postMessage({ type: 'resetStress', dynamicBlockCount, ...getPerformancePayload() });
    },
    resetArena(halfWidth = 64) {
      worker.postMessage({ type: 'resetArena', halfWidth, ...getPerformancePayload() });
    },
    setPerformanceOptions(performanceOptions = box3dPerformanceOptions, nextForceSleepEnabled = forceSleepEnabled) {
      worker.postMessage({
        type: 'setPerformanceOptions',
        performanceOptions,
        forceSleepEnabled: nextForceSleepEnabled,
      });
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
    getContactCount() {
      return state.contactCount;
    },
    getAwakeContactCount() {
      return state.awakeContactCount;
    },
    getIslandCount() {
      return state.islandCount;
    },
    getTaskCount() {
      return state.taskCount;
    },
    getStackUsed() {
      return state.stackUsed;
    },
    getActualWorkers() {
      return state.actualWorkers;
    },
    getStressLayout() {
      return state.stressLayout;
    },
    getSleepPolicy() {
      return state.sleepPolicy;
    },
    getContinuous() {
      return state.continuous;
    },
    getSubsteps() {
      return state.substeps;
    },
    getRequestedWorkers() {
      return state.requestedWorkers;
    },
    getForceSleepEnabled() {
      return state.forceSleepEnabled;
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
    getDynamicTreeRebuildMs() {
      return state.dynamicTreeRebuildMs;
    },
    getDynamicTreeRebuildLeaves() {
      return state.dynamicTreeRebuildLeaves;
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
    getProfile() {
      return state.profile ?? {};
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

function normalizePerformanceOptions(options = {}) {
  return {
    substeps: Math.round(boundedNumber(options.substeps, 4, 1, 16)),
    stressLayout: ['dense', 'wide', 'islands'].includes(options.stressLayout) ? options.stressLayout : 'dense',
    sleepPolicy: ['normal', 'aggressive', 'disabled'].includes(options.sleepPolicy) ? options.sleepPolicy : 'normal',
    continuous: options.continuous !== false,
    contactHertz: boundedNumber(options.contactHertz, 30, 1, 240),
    contactDampingRatio: boundedNumber(options.contactDampingRatio, 10, 0.1, 40),
    contactSpeed: boundedNumber(options.contactSpeed, 3, 0.1, 40),
    workerCount: Math.round(boundedNumber(options.workerCount, 0, 0, 32)),
    contactRecycleDistance: boundedNumber(options.contactRecycleDistance, 0.05, 0, 2),
    contactBudgetPerBody: Math.round(boundedNumber(options.contactBudgetPerBody, 0, 0, 64)),
    regionSleep: options.regionSleep === true,
    regionSleepTileSize: boundedNumber(options.regionSleepTileSize, 8, 0.5, 128),
    regionSleepSpeed: boundedNumber(options.regionSleepSpeed, 0.08, 0.001, 10),
    regionSleepMinBodies: Math.round(boundedNumber(options.regionSleepMinBodies, 16, 1, 4096)),
  };
}

function setTuningStatus(status) {
  tuningStatusEl.textContent = status;
}

function syncTuningFormFromOptions() {
  tuningSubstepsInput.value = box3dPerformanceOptions.substeps;
  tuningSubstepsValueEl.value = box3dPerformanceOptions.substeps;
  tuningSubstepsValueEl.textContent = box3dPerformanceOptions.substeps;
  tuningLayoutInput.value = box3dPerformanceOptions.stressLayout;
  tuningSleepInput.value = box3dPerformanceOptions.sleepPolicy;
  tuningWorkersInput.value = box3dPerformanceOptions.workerCount;
  tuningContactHertzInput.value = box3dPerformanceOptions.contactHertz;
  tuningContactDampingInput.value = box3dPerformanceOptions.contactDampingRatio;
  tuningContactSpeedInput.value = box3dPerformanceOptions.contactSpeed;
  tuningContinuousInput.checked = box3dPerformanceOptions.continuous;
  tuningForceSleepInput.checked = forceSleepEnabled;
}

function readTuningFormOptions() {
  box3dPerformanceOptions = normalizePerformanceOptions({
    substeps: tuningSubstepsInput.value,
    stressLayout: tuningLayoutInput.value,
    sleepPolicy: tuningSleepInput.value,
    continuous: tuningContinuousInput.checked,
    contactHertz: tuningContactHertzInput.value,
    contactDampingRatio: tuningContactDampingInput.value,
    contactSpeed: tuningContactSpeedInput.value,
    workerCount: tuningWorkersInput.value,
  });
  forceSleepEnabled = tuningForceSleepInput.checked;
  syncTuningFormFromOptions();
  return box3dPerformanceOptions;
}

function getPerformancePayload() {
  return {
    performanceOptions: box3dPerformanceOptions,
    forceSleepEnabled,
  };
}

function updateTuningUrl({ replace = true } = {}) {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('engine', physicsEngine);
  nextUrl.searchParams.set('substeps', String(box3dPerformanceOptions.substeps));
  nextUrl.searchParams.set('stressLayout', box3dPerformanceOptions.stressLayout);
  nextUrl.searchParams.set('sleepPolicy', box3dPerformanceOptions.sleepPolicy);
  nextUrl.searchParams.set('continuous', box3dPerformanceOptions.continuous ? '1' : '0');
  nextUrl.searchParams.set('contactHertz', String(box3dPerformanceOptions.contactHertz));
  nextUrl.searchParams.set('contactDampingRatio', String(box3dPerformanceOptions.contactDampingRatio));
  nextUrl.searchParams.set('contactSpeed', String(box3dPerformanceOptions.contactSpeed));
  nextUrl.searchParams.set('workerCount', String(box3dPerformanceOptions.workerCount));
  nextUrl.searchParams.set('contactRecycleDistance', String(box3dPerformanceOptions.contactRecycleDistance));
  nextUrl.searchParams.set('contactBudgetPerBody', String(box3dPerformanceOptions.contactBudgetPerBody));
  nextUrl.searchParams.set('regionSleep', box3dPerformanceOptions.regionSleep ? '1' : '0');
  nextUrl.searchParams.set('regionSleepTileSize', String(box3dPerformanceOptions.regionSleepTileSize));
  nextUrl.searchParams.set('regionSleepSpeed', String(box3dPerformanceOptions.regionSleepSpeed));
  nextUrl.searchParams.set('regionSleepMinBodies', String(box3dPerformanceOptions.regionSleepMinBodies));
  nextUrl.searchParams.set('forceSleep', forceSleepEnabled ? '1' : '0');
  if (replace) {
    window.history.replaceState(null, '', nextUrl);
  }
  return nextUrl.toString();
}

function resetCurrentWithPerformanceOptions() {
  window.clearTimeout(labArenaPreviewTimer);
  if (labRun.active) {
    stopLab('settings reset');
  }
  stopStress(stressRun.active ? 'settings reset' : stressRun.result);
  paused = false;
  pauseButton.textContent = 'Pause';
  physics.setPaused(false);
  fpsSamples = [];
  lastSnapshotRequestedAt = 0;
  lastSleepTestSample = null;

  if (currentScene === 4) {
    const halfWidth = estimateLabArenaHalfWidth(labConfig);
    applyLabArenaVisuals(halfWidth);
    physics.resetArena(halfWidth);
    setLabStatus(`arena ${Math.round(halfWidth * 2)} wide`);
    return;
  }

  physics.reset(currentScene);
}

function applyTuning({ reset = false } = {}) {
  if (physicsEngine !== 'box3d') {
    setTuningStatus('box3d only');
    return;
  }
  readTuningFormOptions();
  physics.setPerformanceOptions(box3dPerformanceOptions, forceSleepEnabled);
  updateTuningUrl();
  if (reset) {
    resetCurrentWithPerformanceOptions();
    setTuningStatus('applied + reset');
  } else {
    setTuningStatus('applied live');
  }
  updateReadout();
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
  const normalized = {
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

  if (scenario === 'pileSmash') {
    normalized.performanceOptions = normalizePerformanceOptions({
      ...(defaults.performanceOptions ?? {}),
      ...(config.performanceOptions ?? {}),
    });
    normalized.smashShots = Array.isArray(config.smashShots ?? defaults.smashShots)
      ? (config.smashShots ?? defaults.smashShots).map((shot) => ({
          atMs: Math.round(boundedNumber(shot.atMs, 5000, 0, normalized.durationMs)),
          x: boundedNumber(shot.x, -42, -100000, 100000),
          y: boundedNumber(shot.y, 10, -100000, 100000),
          z: boundedNumber(shot.z, 0, -100000, 100000),
          targetX: boundedNumber(shot.targetX, 0, -100000, 100000),
          targetY: boundedNumber(shot.targetY, 4, -100000, 100000),
          targetZ: boundedNumber(shot.targetZ, 0, -100000, 100000),
          radius: boundedNumber(shot.radius, 4, 0.1, 100),
          speed: boundedNumber(shot.speed, 150, 0, 10000),
          density: boundedNumber(shot.density, 160, 0.01, 10000),
        }))
      : [];
  } else {
    delete normalized.smashShots;
    delete normalized.performanceOptions;
  }

  if (scenario === 'lineSpawn') {
    const columnWidth = Number.isFinite(Number(config.columns))
      ? (Math.max(1, Math.round(Number(config.columns))) - 1) * normalized.spacing
      : undefined;
    normalized.lineWidth = boundedNumber(
      config.lineWidth ?? config.width ?? columnWidth,
      getLineSpawnDefaultWidth(normalized),
      0,
      10000000
    );
    delete normalized.width;
    delete normalized.columns;
  } else {
    delete normalized.lineWidth;
    delete normalized.width;
    delete normalized.columns;
  }

  return normalized;
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
  labLineWidthInput.value = labConfig.scenario === 'lineSpawn' ? labConfig.lineWidth : '';
  labLineWidthInput.disabled = labConfig.scenario !== 'lineSpawn';
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
    lineWidth: labLineWidthInput.value,
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

function getLineSpawnRows(config) {
  return Math.max(1, Math.round(boundedNumber(config.rows, 1, 1, 256)));
}

function getLineSpawnDefaultWidth(config) {
  const rows = getLineSpawnRows(config);
  const columns = Math.max(1, Math.ceil(config.count / rows));
  return Math.max(0, (columns - 1) * config.spacing);
}

function getLineSpawnWidth(config) {
  if (Number.isFinite(Number(config.lineWidth))) {
    return Math.max(0, Number(config.lineWidth));
  }
  if (Number.isFinite(Number(config.width))) {
    return Math.max(0, Number(config.width));
  }
  if (Number.isFinite(Number(config.columns))) {
    return (Math.max(1, Math.round(Number(config.columns))) - 1) * config.spacing;
  }
  return getLineSpawnDefaultWidth(config);
}

function getLineSpawnColumns(config) {
  return Math.max(1, Math.floor(getLineSpawnWidth(config) / config.spacing) + 1);
}

function estimateLabArenaHalfWidth(config) {
  if (config.scenario === 'pileDrop' || config.scenario === 'pileSmash') {
    const bounds = getPileLayoutBounds(config);
    const pileRadius = getPileRadius(config);
    return Math.max(
      48,
      (bounds.maxX - bounds.minX) * 0.5 + pileRadius + LAB_ARENA_MARGIN,
      (bounds.maxZ - bounds.minZ) * 0.5 + pileRadius + LAB_ARENA_MARGIN
    );
  }
  if (config.scenario === 'lineSpawn') {
    const lineWidth = getLineSpawnWidth(config);
    const rows = getLineSpawnRows(config);
    return Math.max(48, lineWidth * 0.5 + LAB_ARENA_MARGIN, (rows - 1) * config.spacing * 0.5 + LAB_ARENA_MARGIN);
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
  const columns = getLineSpawnColumns(config);
  const rows = getLineSpawnRows(config);
  const layerSize = columns * rows;
  const lineWidth = getLineSpawnWidth(config);
  const xStep = columns > 1 ? lineWidth / (columns - 1) : 0;
  const startX = lineWidth * -0.5;
  const startZ = (rows - 1) * config.spacing * -0.5;
  for (let i = 0; i < batchSize; i += 1) {
    const index = startIndex + i;
    const slot = index % layerSize;
    const layer = Math.floor(index / layerSize);
    const column = slot % columns;
    const row = Math.floor(slot / columns);
    const x = startX + column * xStep;
    const z = startZ + row * config.spacing;
    bodies.push({
      bodyType: 'dynamic',
      position: { x, y: 3.8 + layer * 0.72 + (index % 4) * 0.02, z },
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

function fireLabSmashShot(shot, shotIndex = 0) {
  const position = {
    x: shot.x ?? -42,
    y: shot.y ?? 10,
    z: shot.z ?? 0,
  };
  const target = {
    x: shot.targetX ?? 0,
    y: shot.targetY ?? 4,
    z: shot.targetZ ?? 0,
  };
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const dz = target.z - position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  const speed = shot.speed ?? 150;
  physics.addBodies([
    {
      shape: 'sphere',
      shapeType: 'sphere',
      bodyType: 'dynamic',
      position,
      radius: shot.radius ?? 4,
      velocity: {
        x: (dx / length) * speed,
        y: (dy / length) * speed,
        z: (dz / length) * speed,
      },
      color: { x: 1, y: 0.34 + (shotIndex % 2) * 0.18, z: 0.08 },
      density: shot.density ?? 160,
    },
  ]);
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
  const cProfile = physics.getProfile();
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
    lastForceSleepMs: physics.getLastForceSleepMs(),
    forcedSleepBodies: physics.getForcedSleepBodies(),
    dynamicTreeRebuildMs: physics.getDynamicTreeRebuildMs(),
    dynamicTreeRebuildLeaves: physics.getDynamicTreeRebuildLeaves(),
    smashShotCount: labRun.nextShotIndex ?? 0,
    broadphasePairsMs: cProfile.pairs ?? 0,
    broadphaseMoves: cProfile.broadphaseMoves ?? 0,
    broadphaseNodes: cProfile.broadphaseTreeNodeVisits ?? 0,
    broadphaseLeaves: cProfile.broadphaseTreeLeafVisits ?? 0,
    broadphaseExisting: cProfile.broadphaseExistingPairs ?? 0,
    broadphaseEmitted: cProfile.broadphaseCandidatePairs ?? 0,
    broadphaseCreated: cProfile.broadphaseCreatedContacts ?? 0,
    broadphasePairSet: cProfile.broadphasePairSetCount ?? 0,
    dynamicTreeHeight: cProfile.dynamicTreeHeight ?? 0,
    dynamicTreeAreaRatio: cProfile.dynamicTreeAreaRatio ?? 0,
    collideMs: cProfile.collide ?? 0,
    collideGatherMs: cProfile.collideGather ?? 0,
    collideTaskMs: cProfile.collideTask ?? 0,
    collideContactStateMs: cProfile.collideContactState ?? 0,
    collideTouchingContacts: cProfile.collideTouchingContacts ?? 0,
    collideNonTouchingContacts: cProfile.collideNonTouchingContacts ?? 0,
    collideTotalContacts: cProfile.collideTotalContacts ?? 0,
    collideRecycledContacts: cProfile.collideRecycledContacts ?? 0,
    collideUpdatedContacts: cProfile.collideUpdatedContacts ?? 0,
    collideDisjointContacts: cProfile.collideDisjointContacts ?? 0,
    collideStartedTouching: cProfile.collideStartedTouching ?? 0,
    collideStoppedTouching: cProfile.collideStoppedTouching ?? 0,
    collideManifoldContacts: cProfile.collideManifoldContacts ?? 0,
    collideSatCalls: cProfile.collideSatCalls ?? 0,
    collideSatCacheHits: cProfile.collideSatCacheHits ?? 0,
    collideSatSameHullCalls: cProfile.collideSatSameHullCalls ?? 0,
    collideSatBoxHullCalls: cProfile.collideSatBoxHullCalls ?? 0,
    collideSatCacheSeparationHits: cProfile.collideSatCacheSeparationHits ?? 0,
    collideSatCacheFaceHits: cProfile.collideSatCacheFaceHits ?? 0,
    collideSatCacheEdgeHits: cProfile.collideSatCacheEdgeHits ?? 0,
    collideSatFullSearches: cProfile.collideSatFullSearches ?? 0,
    collideRecycleCandidates: cProfile.collideRecycleCandidates ?? 0,
    collideRecycleMissingCache: cProfile.collideRecycleMissingCache ?? 0,
    collideRecycleFastMesh: cProfile.collideRecycleFastMesh ?? 0,
    collideRecycleTested: cProfile.collideRecycleTested ?? 0,
    collideRecycleRejectedAngular: cProfile.collideRecycleRejectedAngular ?? 0,
    collideRecycleRejectedLinear: cProfile.collideRecycleRejectedLinear ?? 0,
    collideRecycleRejectedArc: cProfile.collideRecycleRejectedArc ?? 0,
    solveMs: cProfile.solve ?? 0,
    solverSetupMs: cProfile.solverSetup ?? 0,
    solverAwakeBodies: cProfile.solverAwakeBodies ?? 0,
    solverActiveColors: cProfile.solverActiveColors ?? 0,
    solverWideContacts: cProfile.solverWideContacts ?? 0,
    solverMeshContacts: cProfile.solverMeshContacts ?? 0,
    solverManifolds: cProfile.solverManifolds ?? 0,
    solverOverflowContacts: cProfile.solverOverflowContacts ?? 0,
    solverOverflowManifolds: cProfile.solverOverflowManifolds ?? 0,
    solverGraphBlocks: cProfile.solverGraphBlocks ?? 0,
    solverConstraintsMs: cProfile.constraints ?? 0,
    solverPrepareMs: cProfile.prepareConstraints ?? 0,
    solverPrepareJointsMs: cProfile.prepareJoints ?? 0,
    solverPrepareWideContactsMs: cProfile.prepareWideContacts ?? 0,
    solverPrepareMeshContactsMs: cProfile.prepareMeshContacts ?? 0,
    solverPrepareOverflowMs: cProfile.prepareOverflow ?? 0,
    solverIntegrateVelocitiesMs: cProfile.integrateVelocities ?? 0,
    solverWarmStartMs: cProfile.warmStart ?? 0,
    solverSolveImpulsesMs: cProfile.solveImpulses ?? 0,
    solverIntegratePositionsMs: cProfile.integratePositions ?? 0,
    solverRelaxImpulsesMs: cProfile.relaxImpulses ?? 0,
    solverRestitutionMs: cProfile.applyRestitution ?? 0,
    solverStoreImpulsesMs: cProfile.storeImpulses ?? 0,
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
  if (normalized.performanceOptions && physicsEngine === 'box3d') {
    box3dPerformanceOptions = normalizePerformanceOptions({
      ...box3dPerformanceOptions,
      ...normalized.performanceOptions,
    });
    syncTuningFormFromOptions();
    physics.setPerformanceOptions(box3dPerformanceOptions, forceSleepEnabled);
    updateTuningUrl({ replace: true });
  }
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
    nextShotIndex: 0,
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

  const elapsedMs = now - labRun.startedAt;
  const smashShots = config.smashShots ?? [];
  while (labRun.nextShotIndex < smashShots.length && elapsedMs >= smashShots[labRun.nextShotIndex].atMs) {
    fireLabSmashShot(smashShots[labRun.nextShotIndex], labRun.nextShotIndex);
    labRun.nextShotIndex += 1;
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
  const cProfile = physics.getProfile();
  const cStep = cProfile.step ?? 0;
  const cPairs = cProfile.pairs ?? 0;
  const cCollide = cProfile.collide ?? 0;
  const cSolve = cProfile.solve ?? 0;
  const cTransforms = cProfile.transforms ?? 0;
  const cSleep = cProfile.sleepIslands ?? 0;
  const broadphaseMoves = Math.round(cProfile.broadphaseMoves ?? 0);
  const broadphaseNodeVisits = Math.round(cProfile.broadphaseTreeNodeVisits ?? 0);
  const broadphaseLeafVisits = Math.round(cProfile.broadphaseTreeLeafVisits ?? 0);
  const broadphaseDuplicates = Math.round(cProfile.broadphaseDuplicatePairs ?? 0);
  const broadphaseExisting = Math.round(cProfile.broadphaseExistingPairs ?? 0);
  const broadphaseCandidates = Math.round(cProfile.broadphaseCandidatePairs ?? 0);
  const broadphaseOverflow = Math.round(cProfile.broadphaseOverflowPairs ?? 0);
  const broadphaseCreated = Math.round(cProfile.broadphaseCreatedContacts ?? 0);
  const broadphasePairSet = Math.round(cProfile.broadphasePairSetCount ?? 0);
  const dynamicTreeHeight = Math.round(cProfile.dynamicTreeHeight ?? 0);
  const dynamicTreeAreaRatio = cProfile.dynamicTreeAreaRatio ?? 0;
  bodyCountEl.textContent = `${physics.getBodyCount()} bodies`;
  stepCountEl.textContent = `step ${physics.getStepCount()}`;
  fpsReadoutEl.textContent = `render ${fpsAverage.toFixed(1)} fps`;
  physicsFpsReadoutEl.textContent = `phys ${physics.getPhysicsHz().toFixed(1)} fps awake ${physics.getAwakeBodyCount()}`;
  profileReadoutEl.textContent =
    `step ${physics.getPhysicsStepMs().toFixed(1)}ms c ${cStep.toFixed(1)} p/c/s/x/sl ${cPairs.toFixed(1)}/${cCollide.toFixed(1)}/${cSolve.toFixed(1)}/${cTransforms.toFixed(1)}/${cSleep.toFixed(1)} moves ${broadphaseMoves.toLocaleString()} nodes ${broadphaseNodeVisits.toLocaleString()} leaves ${broadphaseLeafVisits.toLocaleString()} dup ${broadphaseDuplicates.toLocaleString()} exist ${broadphaseExisting.toLocaleString()} cand ${broadphaseCandidates.toLocaleString()} over ${broadphaseOverflow.toLocaleString()} new ${broadphaseCreated.toLocaleString()} set ${broadphasePairSet.toLocaleString()} tree ${dynamicTreeHeight}/${dynamicTreeAreaRatio.toFixed(1)} contacts ${physics.getContactCount().toLocaleString()} awake ${physics.getAwakeContactCount().toLocaleString()} islands ${physics.getIslandCount().toLocaleString()} workers ${physics.getActualWorkers()} sub ${physics.getSubsteps()} spawn ${physics.getSpawnBodiesMs().toFixed(1)}ms/${physics.getSpawnBodiesCount()} wasm ${physics.getRenderSyncMs().toFixed(1)}ms sync ${syncMs.toFixed(1)}ms render ${renderMs.toFixed(1)}ms snap ${physics.getSnapshotCopyMs().toFixed(1)}ms`;
  stressStatusEl.textContent = getStressLabel();
  window.__wasmBox3DProfile = {
    bodies: physics.getBodyCount(),
    renderFps: fpsAverage,
    physicsFps: physics.getPhysicsHz(),
    awakeBodies: physics.getAwakeBodyCount(),
    physicsStepMs: physics.getPhysicsStepMs(),
    physicsCapacityFps: physics.getPhysicsCapacityFps(),
    contactCount: physics.getContactCount(),
    awakeContactCount: physics.getAwakeContactCount(),
    islandCount: physics.getIslandCount(),
    taskCount: physics.getTaskCount(),
    stackUsed: physics.getStackUsed(),
    actualWorkers: physics.getActualWorkers(),
    stressLayout: physics.getStressLayout(),
    sleepPolicy: physics.getSleepPolicy(),
    continuous: physics.getContinuous(),
    substeps: physics.getSubsteps(),
    requestedWorkers: physics.getRequestedWorkers(),
    forceSleepEnabled: physics.getForceSleepEnabled(),
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
    profile: cProfile,
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

function updateMouseRay(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  raycaster.setFromCamera(pointer, camera);
}

function getMouseWorldAimPoint(event) {
  updateMouseRay(event);
  worldGroup.updateMatrixWorld(true);
  const hits = raycaster.intersectObjects(worldGroup.children, true);
  if (hits.length > 0) {
    return hits[0].point;
  }
  if (raycaster.ray.intersectPlane(aimPlane, aimPoint)) {
    return aimPoint;
  }
  return raycaster.ray.at(controls.getDistance ? controls.getDistance() : 160, aimPoint);
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

function fireCameraProjectile(event) {
  if (stressRun.active) {
    stopStress('stress stopped');
  }

  const target = getMouseWorldAimPoint(event);
  camera.getWorldDirection(cameraForward).normalize();
  cameraDown.set(0, -1, 0).applyQuaternion(camera.quaternion).normalize();
  const positionVector = camera.position
    .clone()
    .addScaledVector(cameraForward, CAMERA_PROJECTILE_RADIUS * 2.4)
    .addScaledVector(cameraDown, CAMERA_PROJECTILE_RADIUS * 2.1);
  projectileDirection.subVectors(target, positionVector).normalize();
  const velocity = {
    x: projectileDirection.x * CAMERA_PROJECTILE_SPEED,
    y: projectileDirection.y * CAMERA_PROJECTILE_SPEED,
    z: projectileDirection.z * CAMERA_PROJECTILE_SPEED,
  };

  physics.addBodies([
    {
      shape: 'sphere',
      shapeType: 'sphere',
      bodyType: 'dynamic',
      position: {
        x: positionVector.x,
        y: positionVector.y,
        z: positionVector.z,
      },
      radius: CAMERA_PROJECTILE_RADIUS,
      velocity,
      color: { x: 0.98, y: 0.48, z: 0.12 },
      density: CAMERA_PROJECTILE_DENSITY,
    },
  ]);
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
  tuningSubstepsInput.addEventListener('input', () => {
    tuningSubstepsValueEl.value = tuningSubstepsInput.value;
    tuningSubstepsValueEl.textContent = tuningSubstepsInput.value;
  });
  for (const input of [
    tuningLayoutInput,
    tuningSleepInput,
    tuningWorkersInput,
    tuningContactHertzInput,
    tuningContactDampingInput,
    tuningContactSpeedInput,
    tuningContinuousInput,
    tuningForceSleepInput,
  ]) {
    input.addEventListener('change', () => {
      readTuningFormOptions();
      updateTuningUrl();
      setTuningStatus('edited');
    });
  }
  tuningSubstepsInput.addEventListener('change', () => {
    readTuningFormOptions();
    updateTuningUrl();
    setTuningStatus('edited');
  });
  tuningApplyButton.addEventListener('click', () => applyTuning());
  tuningResetButton.addEventListener('click', () => applyTuning({ reset: true }));
  tuningUrlButton.addEventListener('click', async () => {
    readTuningFormOptions();
    const nextUrl = updateTuningUrl();
    try {
      await navigator.clipboard.writeText(nextUrl);
      setTuningStatus('url copied');
    } catch {
      setTuningStatus('url updated');
    }
  });
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
  for (const input of [labDurationInput, labIntervalInput, labCountInput, labBatchInput, labRowsInput, labLineWidthInput, labSpacingInput]) {
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

    fireCameraProjectile(event);
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

window.__wasmBox3DTuning = {
  getOptions() {
    return {
      ...box3dPerformanceOptions,
      forceSleepEnabled,
    };
  },
  apply(options = {}, { reset = false } = {}) {
    box3dPerformanceOptions = normalizePerformanceOptions({ ...box3dPerformanceOptions, ...options });
    if (options.forceSleepEnabled != null || options.forceSleep != null) {
      forceSleepEnabled = Boolean(options.forceSleepEnabled ?? options.forceSleep);
    }
    syncTuningFormFromOptions();
    applyTuning({ reset });
    return this.getOptions();
  },
  copyUrl() {
    return updateTuningUrl();
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
  bodyStats() {
    const bodyData = physics.getBodyData();
    const stride = physics.getBodyStride();
    const bodyCount = physics.getBodyCount();
    const stats = {
      bodyCount,
      invalidBodies: 0,
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
      maxAbs: 0,
    };
    for (let i = 5; i < bodyCount; ++i) {
      const offset = i * stride;
      const x = bodyData[offset];
      const y = bodyData[offset + 1];
      const z = bodyData[offset + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        stats.invalidBodies += 1;
        continue;
      }
      stats.minX = Math.min(stats.minX, x);
      stats.maxX = Math.max(stats.maxX, x);
      stats.minY = Math.min(stats.minY, y);
      stats.maxY = Math.max(stats.maxY, y);
      stats.minZ = Math.min(stats.minZ, z);
      stats.maxZ = Math.max(stats.maxZ, z);
      stats.maxAbs = Math.max(stats.maxAbs, Math.abs(x), Math.abs(y), Math.abs(z));
    }
    return stats;
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
  syncTuningFormFromOptions();
  updateTuningUrl();
  if (physicsEngine !== 'box3d') {
    tuningPanelEl.querySelectorAll('input, select, button').forEach((control) => {
      control.disabled = true;
    });
    setTuningStatus('box3d only');
  }
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

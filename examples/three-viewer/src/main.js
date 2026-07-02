import * as THREE from 'three';
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

const STRESS_START_BLOCKS = 64;
const STRESS_TARGET_FPS = 20;
const STRESS_WARMUP_MS = 1000;
const STRESS_SAMPLE_MS = 2400;
const FPS_WINDOW_SIZE = 90;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111419);

const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 160);
camera.position.set(24, 18, 30);
camera.lookAt(0, 3.0, 0);

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

let physics;
let meshManager;
let currentScene = 0;
let paused = false;
let syncedStateVersion = -1;
let fpsSamples = [];
let fpsAverage = 0;
let syncMs = 0;
let renderMs = 0;
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

function createWorkerPhysics(sceneIndex) {
  const worker = new Worker(new URL('./physics-worker.js', import.meta.url), { type: 'module' });
  let readyResolve;
  let stateVersion = 0;
  let snapshotPending = false;
  let state = {
    bodyCount: 0,
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

  worker.postMessage({ type: 'init', sceneIndex });

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
    spawnBox(position = {}, velocity = {}) {
      worker.postMessage({ type: 'spawnBox', position, velocity });
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
  };
}

function resize() {
  const { clientWidth, clientHeight } = canvas;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / Math.max(1, clientHeight);
  camera.updateProjectionMatrix();
}

function resetScene(index) {
  stopStress(stressRun.active ? 'stress stopped' : stressRun.result);
  currentScene = index;
  physics.reset(index);
}

function updateReadout() {
  bodyCountEl.textContent = `${physics.getBodyCount()} bodies`;
  stepCountEl.textContent = `step ${physics.getStepCount()}`;
  fpsReadoutEl.textContent = `render ${fpsAverage.toFixed(1)} fps`;
  physicsFpsReadoutEl.textContent = `phys ${physics.getPhysicsHz().toFixed(1)} fps`;
  profileReadoutEl.textContent =
    `step ${physics.getPhysicsStepMs().toFixed(1)}ms wasm ${physics.getRenderSyncMs().toFixed(1)}ms sync ${syncMs.toFixed(1)}ms render ${renderMs.toFixed(1)}ms snap ${physics.getSnapshotCopyMs().toFixed(1)}ms`;
  stressStatusEl.textContent = getStressLabel();
  window.__wasmBox3DProfile = {
    bodies: physics.getBodyCount(),
    renderFps: fpsAverage,
    physicsFps: physics.getPhysicsHz(),
    physicsStepMs: physics.getPhysicsStepMs(),
    physicsCapacityFps: physics.getPhysicsCapacityFps(),
    renderSyncMs: physics.getRenderSyncMs(),
    syncMs,
    renderMs,
    snapshotCopyMs: physics.getSnapshotCopyMs(),
    snapshotBytes: physics.getSnapshotBytes(),
    resetStressMs: physics.getResetStressMs(),
    stressStatus: stressStatusEl.textContent,
    stepCount: physics.getStepCount(),
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

function animate() {
  requestAnimationFrame(animate);
  const actualDt = clock.getDelta();
  const now = performance.now();
  recordFps(actualDt);

  if (physics) {
    physics.requestSnapshot();
    syncLatestPhysicsState();
    evaluateStressRound(now, actualDt);
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
  canvas.addEventListener('pointerdown', (event) => {
    const point = screenSpawnPoint(event);
    spawn(event.shiftKey ? 'sphere' : 'box', point);
  });
}

async function boot() {
  resize();
  window.addEventListener('resize', resize);

  physics = createWorkerPhysics(currentScene);
  await physics.ready;
  meshManager = createThreeBodyMeshManager({ THREE, scene: worldGroup });
  meshManager.sync(physics);
  syncedStateVersion = physics.getStateVersion();
  bindControls();
  updateReadout();
  wasmStatusEl.textContent = 'wasm active';
  animate();
}

boot().catch((error) => {
  wasmStatusEl.textContent = 'wasm failed';
  console.error(error);
});

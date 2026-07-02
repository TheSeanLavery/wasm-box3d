import * as THREE from 'three';
import { createBox3DDemo } from '@threecyborgs/wasm-box3d';
import { createThreeBodyMeshManager } from '@threecyborgs/wasm-box3d-three';
import './styles.css';

const canvas = document.querySelector('#scene');
const bodyCountEl = document.querySelector('#body-count');
const stepCountEl = document.querySelector('#step-count');
const fpsReadoutEl = document.querySelector('#fps-readout');
const stressStatusEl = document.querySelector('#stress-status');
const wasmStatusEl = document.querySelector('#wasm-status');
const pauseButton = document.querySelector('#toggle-pause');
const startStressButton = document.querySelector('#start-stress');
const stopStressButton = document.querySelector('#stop-stress');
const gravityInput = document.querySelector('#gravity');

const STRESS_START_BLOCKS = 64;
const STRESS_TARGET_FPS = 20;
const STRESS_WARMUP_MS = 500;
const STRESS_SAMPLE_MS = 2400;
const FPS_WINDOW_SIZE = 90;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111419);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
camera.position.set(22, 15, 24);
camera.lookAt(0, 3.4, 0);

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const hemi = new THREE.HemisphereLight(0xf1f5f9, 0x1c2128, 2.4);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 3.0);
sun.position.set(-6, 12, 8);
sun.castShadow = true;
sun.shadow.camera.left = -24;
sun.shadow.camera.right = 24;
sun.shadow.camera.top = 24;
sun.shadow.camera.bottom = -24;
sun.shadow.mapSize.set(2048, 2048);
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
let fpsSamples = [];
let fpsAverage = 0;
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
  meshManager.sync(physics);
}

function updateReadout() {
  bodyCountEl.textContent = `${physics.getBodyCount()} bodies`;
  stepCountEl.textContent = `step ${physics.getStepCount()}`;
  fpsReadoutEl.textContent = `${fpsAverage.toFixed(1)} fps`;
  stressStatusEl.textContent = getStressLabel();
}

function getStressLabel() {
  if (!stressRun.active) {
    return stressRun.result;
  }

  const measured = stressRun.sampleFrames > 0 ? stressRun.lastAverage.toFixed(1) : 'warming';
  return `stress ${stressRun.created}/${stressRun.target} blocks ${measured} fps`;
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
  let bodies = 0;
  let created = 0;

  try {
    bodies = physics.resetStress(requested);
    created = physics.getStressDynamicCount();
  } catch (error) {
    stopStress(`memory limit near ${target} blocks`);
    console.error(error);
    return;
  }

  currentScene = 3;
  paused = false;
  pauseButton.textContent = 'Pause';
  fpsSamples = [];
  meshManager.sync(physics);
  stressRun = {
    active: true,
    target: requested,
    created,
    bodies,
    roundStartedAt: performance.now(),
    sampleStartedAt: 0,
    sampleFrames: 0,
    sampleMs: 0,
    lastAverage: 0,
    result: `stress ${created}/${requested} blocks`,
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
  stressRun.lastAverage = stressRun.sampleMs > 0 ? (stressRun.sampleFrames * 1000) / stressRun.sampleMs : 0;

  if (now - stressRun.sampleStartedAt < STRESS_SAMPLE_MS) {
    return;
  }

  const average = stressRun.lastAverage;
  const maxDynamicBlocks = Math.max(1, physics.getMaxBodies() - 5);

  if (average < STRESS_TARGET_FPS) {
    stopStress(`fps floor hit: ${stressRun.created} blocks at ${average.toFixed(1)} fps`);
    return;
  }

  if (stressRun.created < stressRun.target) {
    stopStress(`memory limit near ${stressRun.target} blocks; created ${stressRun.created}`);
    return;
  }

  if (stressRun.target >= maxDynamicBlocks) {
    stopStress(`wasm body cap hit: ${stressRun.created} blocks at ${average.toFixed(1)} fps`);
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

  meshManager.sync(physics);
}

function animate() {
  requestAnimationFrame(animate);
  const actualDt = clock.getDelta();
  const dt = Math.min(actualDt, 1 / 30);
  const now = performance.now();
  recordFps(actualDt);

  if (physics && !paused) {
    physics.step(dt, 4);
    meshManager.sync(physics);
    evaluateStressRound(now, actualDt);
    updateReadout();
  }

  worldGroup.rotation.y += dt * (stressRun.active ? 0.018 : 0.04);
  renderer.render(scene, camera);
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

  physics = await createBox3DDemo({ sceneIndex: currentScene });
  meshManager = createThreeBodyMeshManager({ THREE, scene: worldGroup });
  meshManager.sync(physics);
  bindControls();
  updateReadout();
  wasmStatusEl.textContent = 'wasm active';
  animate();
}

boot().catch((error) => {
  wasmStatusEl.textContent = 'wasm failed';
  console.error(error);
});

import * as THREE from 'three';
import { createBox3DDemo } from '@threecyborgs/wasm-box3d';
import { createThreeBodyMeshManager } from '@threecyborgs/wasm-box3d-three';
import './styles.css';

const canvas = document.querySelector('#scene');
const bodyCountEl = document.querySelector('#body-count');
const stepCountEl = document.querySelector('#step-count');
const wasmStatusEl = document.querySelector('#wasm-status');
const pauseButton = document.querySelector('#toggle-pause');
const gravityInput = document.querySelector('#gravity');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111419);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
camera.position.set(13, 11, 15);
camera.lookAt(0, 2.3, 0);

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const hemi = new THREE.HemisphereLight(0xf1f5f9, 0x1c2128, 2.4);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 3.0);
sun.position.set(-6, 12, 8);
sun.castShadow = true;
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 14;
sun.shadow.camera.bottom = -14;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const grid = new THREE.GridHelper(18, 18, 0x5c6670, 0x252c35);
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

function resize() {
  const { clientWidth, clientHeight } = canvas;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / Math.max(1, clientHeight);
  camera.updateProjectionMatrix();
}

function resetScene(index) {
  currentScene = index;
  physics.reset(index);
  meshManager.sync(physics);
}

function updateReadout() {
  bodyCountEl.textContent = `${physics.getBodyCount()} bodies`;
  stepCountEl.textContent = `step ${physics.getStepCount()}`;
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
  const dt = Math.min(clock.getDelta(), 1 / 30);

  if (physics && !paused) {
    physics.step(dt, 4);
    meshManager.sync(physics);
    updateReadout();
  }

  worldGroup.rotation.y += dt * 0.05;
  renderer.render(scene, camera);
}

function bindControls() {
  document.querySelector('#scene-stack').addEventListener('click', () => resetScene(0));
  document.querySelector('#scene-spheres').addEventListener('click', () => resetScene(1));
  document.querySelector('#scene-mixed').addEventListener('click', () => resetScene(2));
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


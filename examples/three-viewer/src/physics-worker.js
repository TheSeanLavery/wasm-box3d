import { createBox3DDemo } from '@threecyborgs/wasm-box3d';

let physics;
let sceneIndex = 0;
let paused = false;
let lastStepAt = 0;
let intervalId = 0;
const METRIC_INTERVAL_MS = 500;

let metricStartedAt = 0;
let metricStepCount = 0;
let metricStepMs = 0;
let physicsHz = 0;
let physicsStepMs = 0;
let physicsCapacityFps = 0;
let renderSyncMs = 0;
let snapshotCopyMs = 0;
let snapshotBytes = 0;
let resetStressMs = 0;

function resetMetrics(now = performance.now()) {
  metricStartedAt = now;
  metricStepCount = 0;
  metricStepMs = 0;
  physicsHz = 0;
  physicsStepMs = 0;
  physicsCapacityFps = 0;
}

function snapshot() {
  const renderSyncStartedAt = performance.now();
  physics.syncRenderData();
  renderSyncMs = performance.now() - renderSyncStartedAt;

  const snapshotStartedAt = performance.now();
  const bodyData = new Float32Array(physics.getBodyData());
  snapshotCopyMs = performance.now() - snapshotStartedAt;
  snapshotBytes = bodyData.byteLength;
  postMessage(
    {
      type: 'state',
      bodyCount: physics.getBodyCount(),
      bodyStride: physics.getBodyStride(),
      bodyData,
      stepCount: physics.getStepCount(),
      stressDynamicCount: physics.getStressDynamicCount(),
      lastStressRequest: physics.getLastStressRequest(),
      maxBodies: physics.getMaxBodies(),
      physicsHz,
      physicsStepMs,
      physicsCapacityFps,
      renderSyncMs,
      snapshotCopyMs,
      snapshotBytes,
      resetStressMs,
    },
    [bodyData.buffer]
  );
}

function tick() {
  if (!physics || paused) {
    return;
  }

  const now = performance.now();
  const dt = Math.min((now - lastStepAt) / 1000 || 1 / 60, 1 / 30);
  lastStepAt = now;
  const stepStartedAt = performance.now();
  physics.step(dt, 4);
  const stepEndedAt = performance.now();
  metricStepCount += 1;
  metricStepMs += stepEndedAt - stepStartedAt;

  if (stepEndedAt - metricStartedAt >= METRIC_INTERVAL_MS) {
    physicsHz = (metricStepCount * 1000) / (stepEndedAt - metricStartedAt);
    physicsStepMs = metricStepCount > 0 ? metricStepMs / metricStepCount : 0;
    physicsCapacityFps = physicsStepMs > 0 ? 1000 / physicsStepMs : 0;
    metricStartedAt = stepEndedAt;
    metricStepCount = 0;
    metricStepMs = 0;
  }

}

function startLoop() {
  if (intervalId) {
    clearInterval(intervalId);
  }
  lastStepAt = performance.now();
  resetMetrics(lastStepAt);
  intervalId = setInterval(tick, 1000 / 60);
}

async function init() {
  physics = await createBox3DDemo({ sceneIndex });
  startLoop();
  snapshot();
}

self.onmessage = async (event) => {
  const message = event.data;

  if (message.type === 'init') {
    sceneIndex = message.sceneIndex ?? 0;
    await init();
    return;
  }

  if (!physics) {
    return;
  }

  if (message.type === 'reset') {
    sceneIndex = message.sceneIndex ?? 0;
    physics.reset(sceneIndex);
    paused = false;
    lastStepAt = performance.now();
    resetMetrics(lastStepAt);
    snapshot();
    return;
  }

  if (message.type === 'resetStress') {
    const resetStartedAt = performance.now();
    physics.resetStress(message.dynamicBlockCount ?? 64);
    resetStressMs = performance.now() - resetStartedAt;
    paused = false;
    lastStepAt = performance.now();
    resetMetrics(lastStepAt);
    snapshot();
    return;
  }

  if (message.type === 'spawnBox') {
    physics.spawnBox(message.position, message.velocity);
    snapshot();
    return;
  }

  if (message.type === 'spawnSphere') {
    physics.spawnSphere(message.position, message.velocity);
    snapshot();
    return;
  }

  if (message.type === 'setGravityEnabled') {
    physics.setGravityEnabled(Boolean(message.enabled));
    return;
  }

  if (message.type === 'setPaused') {
    paused = Boolean(message.paused);
    lastStepAt = performance.now();
    resetMetrics(lastStepAt);
    return;
  }

  if (message.type === 'requestSnapshot') {
    snapshot();
  }
};

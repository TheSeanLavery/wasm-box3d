import { createBox3DDemo } from '@threecyborgs/wasm-box3d';

let physics;
let sceneIndex = 0;
let paused = false;
let benchmarkMode = false;
let performanceOptions = {
  substeps: 4,
  stressLayout: 'dense',
  sleepPolicy: 'normal',
  continuous: true,
  contactHertz: 30,
  contactDampingRatio: 10,
  contactSpeed: 3,
  workerCount: 0,
};
let forceSleepEnabled = true;
let lastStepAt = 0;
let intervalId = 0;
const METRIC_INTERVAL_MS = 500;
const QUIET_MOVING_RATIO = 0.01;
const QUIET_MAX_DELTA = 0.002;
const QUIET_VISIBLE_MAX_DELTA = 0.04;
const QUIET_MEAN_DELTA = 0.001;
const QUIET_FORCE_SLEEP_MS = 1000;

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
let spawnBodiesMs = 0;
let spawnBodiesCount = 0;
let spawnBatchCount = 0;
let lastForceSleepMs = 0;
let forcedSleepBodies = 0;
let lastSleepSample = null;
let quietStartedAt = 0;

function resetMetrics(now = performance.now()) {
  metricStartedAt = now;
  metricStepCount = 0;
  metricStepMs = 0;
  physicsHz = 0;
  physicsStepMs = 0;
  physicsCapacityFps = 0;
}

function resetSpawnMetrics() {
  spawnBodiesMs = 0;
  spawnBodiesCount = 0;
  spawnBatchCount = 0;
}

function resetSleepMonitor() {
  lastSleepSample = null;
  quietStartedAt = 0;
  lastForceSleepMs = 0;
  forcedSleepBodies = 0;
}

function maybeForceSleepQuietStressBodies(bodyData, now = performance.now()) {
  const bodyCount = physics.getBodyCount();
  const awakeBodyCount = physics.getAwakeBodyCount();
  const comparedBodies = Math.max(0, bodyCount - 5);

  if (!forceSleepEnabled || physics.getLastStressRequest() <= 0 || comparedBodies === 0 || awakeBodyCount === 0) {
    quietStartedAt = 0;
    lastSleepSample = new Float32Array(bodyData);
    return;
  }

  let movingBodies = 0;
  let maxPositionDelta = 0;
  let meanPositionDelta = 0;

  if (lastSleepSample && lastSleepSample.length === bodyData.length) {
    const stride = physics.getBodyStride();
    for (let i = 5; i < bodyCount; ++i) {
      const offset = i * stride;
      const dx = bodyData[offset] - lastSleepSample[offset];
      const dy = bodyData[offset + 1] - lastSleepSample[offset + 1];
      const dz = bodyData[offset + 2] - lastSleepSample[offset + 2];
      const delta = Math.hypot(dx, dy, dz);
      maxPositionDelta = Math.max(maxPositionDelta, delta);
      meanPositionDelta += delta;
      if (delta > QUIET_MAX_DELTA) {
        movingBodies += 1;
      }
    }

    meanPositionDelta /= comparedBodies;
    const movingRatio = movingBodies / comparedBodies;
    if (
      movingRatio <= QUIET_MOVING_RATIO &&
      meanPositionDelta <= QUIET_MEAN_DELTA &&
      maxPositionDelta <= QUIET_VISIBLE_MAX_DELTA
    ) {
      if (quietStartedAt === 0) {
        quietStartedAt = now;
      } else if (now - quietStartedAt >= QUIET_FORCE_SLEEP_MS) {
        const forceStartedAt = performance.now();
        forcedSleepBodies += physics.forceSleepAwakeBodies();
        lastForceSleepMs = performance.now() - forceStartedAt;
        quietStartedAt = 0;
      }
    } else {
      quietStartedAt = 0;
    }
  }

  lastSleepSample = new Float32Array(bodyData);
}

function snapshot() {
  const renderSyncStartedAt = performance.now();
  physics.syncRenderData();
  renderSyncMs = performance.now() - renderSyncStartedAt;

  const snapshotStartedAt = performance.now();
  const bodyData = new Float32Array(physics.getBodyData());
  if (forceSleepEnabled) {
    maybeForceSleepQuietStressBodies(bodyData, snapshotStartedAt);
  }
  snapshotCopyMs = performance.now() - snapshotStartedAt;
  snapshotBytes = bodyData.byteLength;
  postMessage(
    {
      type: 'state',
      bodyCount: physics.getBodyCount(),
      awakeBodyCount: physics.getAwakeBodyCount(),
      bodyStride: physics.getBodyStride(),
      bodyData,
      stepCount: physics.getStepCount(),
      stressDynamicCount: physics.getStressDynamicCount(),
      lastStressRequest: physics.getLastStressRequest(),
      maxBodies: physics.getMaxBodies(),
      contactCount: physics.getContactCount(),
      awakeContactCount: physics.getAwakeContactCount(),
      islandCount: physics.getIslandCount(),
      taskCount: physics.getTaskCount(),
      stackUsed: physics.getStackUsed(),
      actualWorkers: physics.getActualWorkerCount(),
      stressLayout: performanceOptions.stressLayout,
      sleepPolicy: performanceOptions.sleepPolicy,
      continuous: physics.getContinuousEnabled(),
      substeps: performanceOptions.substeps,
      requestedWorkers: performanceOptions.workerCount,
      forceSleepEnabled,
      physicsHz,
      physicsStepMs,
      physicsCapacityFps,
      renderSyncMs,
      snapshotCopyMs,
      snapshotBytes,
      resetStressMs,
      spawnBodiesMs,
      spawnBodiesCount,
      spawnBatchCount,
      lastForceSleepMs,
      forcedSleepBodies,
      threadsEnabled: physics.threadsEnabled,
      benchmarkMode,
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
  physics.step(dt, performanceOptions.substeps ?? 4);
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
  physics = await createBox3DDemo({
    sceneIndex,
    threads: self.__wasmBox3DThreadMode ?? 'auto',
    performanceOptions,
  });
  resetSleepMonitor();
  resetSpawnMetrics();
  startLoop();
  snapshot();
}

self.onmessage = async (event) => {
  const message = event.data;

  if (message.type === 'init') {
    sceneIndex = message.sceneIndex ?? 0;
    self.__wasmBox3DThreadMode = message.threads ?? 'auto';
    benchmarkMode = Boolean(message.benchmarkMode);
    performanceOptions = { ...performanceOptions, ...(message.performanceOptions ?? {}) };
    forceSleepEnabled = message.forceSleepEnabled ?? !benchmarkMode;
    await init();
    return;
  }

  if (!physics) {
    return;
  }

  if (message.type === 'reset') {
    sceneIndex = message.sceneIndex ?? 0;
    if (message.performanceOptions) {
      performanceOptions = { ...performanceOptions, ...message.performanceOptions };
      physics.setPerformanceOptions(performanceOptions);
    }
    physics.reset(sceneIndex);
    resetSleepMonitor();
    resetSpawnMetrics();
    paused = false;
    lastStepAt = performance.now();
    resetMetrics(lastStepAt);
    snapshot();
    return;
  }

  if (message.type === 'resetStress') {
    if (message.performanceOptions) {
      performanceOptions = { ...performanceOptions, ...message.performanceOptions };
      physics.setPerformanceOptions(performanceOptions);
    }
    const resetStartedAt = performance.now();
    physics.resetStress(message.dynamicBlockCount ?? 64);
    resetSleepMonitor();
    resetSpawnMetrics();
    resetStressMs = performance.now() - resetStartedAt;
    paused = false;
    lastStepAt = performance.now();
    resetMetrics(lastStepAt);
    snapshot();
    return;
  }

  if (message.type === 'resetArena') {
    if (message.performanceOptions) {
      performanceOptions = { ...performanceOptions, ...message.performanceOptions };
      physics.setPerformanceOptions(performanceOptions);
    }
    physics.resetArena(message.halfWidth ?? 64);
    resetSleepMonitor();
    resetSpawnMetrics();
    paused = false;
    lastStepAt = performance.now();
    resetMetrics(lastStepAt);
    snapshot();
    return;
  }

  if (message.type === 'spawnBox') {
    physics.spawnBox(message.position, message.velocity);
    resetSleepMonitor();
    snapshot();
    return;
  }

  if (message.type === 'addBodies') {
    const result = physics.addBodies(message.bodies ?? [], { sync: false });
    spawnBodiesMs = result.spawnMs;
    spawnBodiesCount = result.created;
    spawnBatchCount += 1;
    resetSleepMonitor();
    snapshot();
    return;
  }

  if (message.type === 'spawnSphere') {
    physics.spawnSphere(message.position, message.velocity);
    resetSleepMonitor();
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

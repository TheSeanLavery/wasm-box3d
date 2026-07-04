import RAPIER from '@dimforge/rapier3d-compat';

const BODY_FLOAT_STRIDE = 14;
const RENDER_BOX = 0;
const RENDER_SPHERE = 1;
const MAX_RENDER_BODIES = 10000000;
const DEFAULT_ARENA_HALF_WIDTH = 14.0;
const METRIC_INTERVAL_MS = 500;

let rapierReady;
let world;
let sceneIndex = 0;
let paused = false;
let gravityEnabled = true;
let lastStepAt = 0;
let intervalId = 0;
let stepCount = 0;
let lastStressRequested = 0;
let lastStressDynamicCount = 0;
let bodyData = new Float32Array(0);
const bodies = [];

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

function ceilSqrtInt(value) {
  let result = 1;
  while (result * result < value) {
    result += 1;
  }
  return result;
}

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

function createWorld() {
  world = new RAPIER.World(gravityEnabled ? { x: 0, y: -10, z: 0 } : { x: 0, y: 0, z: 0 });
  world.integrationParameters.numSolverIterations = 4;
  world.integrationParameters.numAdditionalFrictionIterations = 4;
  bodies.length = 0;
  stepCount = 0;
}

function ensureBodyDataCapacity() {
  const required = bodies.length * BODY_FLOAT_STRIDE;
  if (bodyData.length >= required) {
    return;
  }

  let nextLength = bodyData.length === 0 ? 256 * BODY_FLOAT_STRIDE : bodyData.length;
  while (nextLength < required) {
    nextLength *= 2;
  }
  bodyData = new Float32Array(nextLength);
}

function addBox(type, position, halfExtents, density, color, velocity = { x: 0, y: 0, z: 0 }, rotationY = 0) {
  if (bodies.length >= MAX_RENDER_BODIES) {
    return -1;
  }

  const desc =
    type === 'dynamic'
      ? RAPIER.RigidBodyDesc.dynamic().setCanSleep(true)
      : RAPIER.RigidBodyDesc.fixed();
  desc.setTranslation(position.x, position.y, position.z);
  if (rotationY) {
    desc.setRotation({ x: 0, y: Math.sin(rotationY * 0.5), z: 0, w: Math.cos(rotationY * 0.5) });
  }
  if (type === 'dynamic') {
    desc.setLinvel(velocity.x, velocity.y, velocity.z);
  }

  const body = world.createRigidBody(desc);
  const collider = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
    .setDensity(density)
    .setFriction(0.62)
    .setRestitution(type === 'dynamic' ? 0.08 : 0.0);
  world.createCollider(collider, body);

  bodies.push({
    body,
    dynamic: type === 'dynamic',
    shapeType: RENDER_BOX,
    hx: halfExtents.x,
    hy: halfExtents.y,
    hz: halfExtents.z,
    radius: 0,
    color,
  });
  return bodies.length - 1;
}

function addBodies(nextBodies = []) {
  let created = 0;
  for (const body of nextBodies) {
    const position = body.position ?? { x: 0, y: 6, z: 0 };
    const halfExtents = body.halfExtents ?? { x: 0.45, y: 0.45, z: 0.45 };
    const velocity = body.velocity ?? { x: 0, y: 0, z: 0 };
    const color = body.color ?? { x: 0.94, y: 0.6, z: 0.22 };
    const type = body.bodyType === 'fixed' ? 'fixed' : 'dynamic';
    const shapeType = body.shapeType ?? body.shape ?? 'box';
    const bodyIndex =
      shapeType === RENDER_SPHERE || shapeType === 'sphere'
        ? addSphere(type, position, body.radius ?? 0.45, body.density ?? 1, color, velocity)
        : addBox(type, position, halfExtents, body.density ?? 1, color, velocity, body.rotationY ?? 0);
    if (bodyIndex >= 0) {
      created += 1;
    }
  }
  return created;
}

function addSphere(type, position, radius, density, color, velocity = { x: 0, y: 0, z: 0 }) {
  if (bodies.length >= MAX_RENDER_BODIES) {
    return -1;
  }

  const desc =
    type === 'dynamic'
      ? RAPIER.RigidBodyDesc.dynamic().setCanSleep(true)
      : RAPIER.RigidBodyDesc.fixed();
  desc.setTranslation(position.x, position.y, position.z);
  if (type === 'dynamic') {
    desc.setLinvel(velocity.x, velocity.y, velocity.z);
  }

  const body = world.createRigidBody(desc);
  const collider = RAPIER.ColliderDesc.ball(radius).setDensity(density).setFriction(0.45).setRestitution(0.18);
  world.createCollider(collider, body);

  bodies.push({
    body,
    dynamic: type === 'dynamic',
    shapeType: RENDER_SPHERE,
    hx: radius,
    hy: radius,
    hz: radius,
    radius,
    color,
  });
  return bodies.length - 1;
}

function addSizedBounds(halfWidth, wallCenterY, wallHalfHeight) {
  addBox('fixed', { x: 0, y: -0.55, z: 0 }, { x: halfWidth, y: 0.5, z: halfWidth }, 0, { x: 0.33, y: 0.36, z: 0.4 });
  addBox(
    'fixed',
    { x: -halfWidth - 0.25, y: wallCenterY, z: 0 },
    { x: 0.25, y: wallHalfHeight, z: halfWidth },
    0,
    { x: 0.24, y: 0.27, z: 0.31 }
  );
  addBox(
    'fixed',
    { x: halfWidth + 0.25, y: wallCenterY, z: 0 },
    { x: 0.25, y: wallHalfHeight, z: halfWidth },
    0,
    { x: 0.24, y: 0.27, z: 0.31 }
  );
  addBox(
    'fixed',
    { x: 0, y: wallCenterY, z: -halfWidth - 0.25 },
    { x: halfWidth, y: wallHalfHeight, z: 0.25 },
    0,
    { x: 0.24, y: 0.27, z: 0.31 }
  );
  addBox(
    'fixed',
    { x: 0, y: wallCenterY, z: halfWidth + 0.25 },
    { x: halfWidth, y: wallHalfHeight, z: 0.25 },
    0,
    { x: 0.24, y: 0.27, z: 0.31 }
  );
}

function addBounds() {
  addSizedBounds(DEFAULT_ARENA_HALF_WIDTH, 3.0, 3.6);
}

function addStressBlocks(requestedDynamicCount) {
  const maxDynamicCount = MAX_RENDER_BODIES - 5;
  const target = Math.max(1, Math.min(requestedDynamicCount, maxDynamicCount));
  const horizontalSpacing = 0.76;
  const verticalSpacing = 0.74;
  const footprint = Math.min(32, ceilSqrtInt(target));
  const halfWidth = Math.max(DEFAULT_ARENA_HALF_WIDTH, footprint * horizontalSpacing * 0.5 + 5.5);

  addSizedBounds(halfWidth, 8.0, 8.5);

  let created = 0;
  for (let y = 0; created < target; y += 1) {
    for (let z = 0; z < footprint && created < target; z += 1) {
      for (let x = 0; x < footprint && created < target; x += 1) {
        const fx = (x - (footprint - 1) * 0.5) * horizontalSpacing;
        const fz = (z - (footprint - 1) * 0.5) * horizontalSpacing;
        const fy = 0.42 + y * verticalSpacing;
        const tint = ((x * 17 + z * 31 + y * 13) % 100) / 100;
        const color = { x: 0.18 + tint * 0.54, y: 0.46 + tint * 0.28, z: 0.72 - tint * 0.38 };
        if (addBox('dynamic', { x: fx, y: fy, z: fz }, { x: 0.34, y: 0.34, z: 0.34 }, 1, color) < 0) {
          return created;
        }
        created += 1;
      }
    }
  }

  return created;
}

function addStackScene() {
  addBounds();
  const colors = [
    { x: 0.93, y: 0.34, z: 0.25 },
    { x: 0.17, y: 0.61, z: 0.74 },
    { x: 0.96, y: 0.72, z: 0.19 },
    { x: 0.38, y: 0.68, z: 0.34 },
  ];

  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      const jitter = (x + y) % 2 === 0 ? 0.08 : -0.08;
      addBox(
        'dynamic',
        { x: -2.4 + x * 1.2 + jitter, y: 0.55 + y * 1.08, z: 0 },
        { x: 0.5, y: 0.5, z: 0.5 },
        1,
        colors[(x + y) % 4]
      );
    }
  }
}

function addSphereScene() {
  addBounds();

  for (let i = 0; i < 42; i += 1) {
    const x = -5.0 + (i % 7) * 1.55;
    const z = -3.8 + Math.floor(i / 7) * 1.25;
    const y = 1.0 + Math.floor(i / 7) * 1.1;
    const radius = 0.32 + 0.06 * (i % 3);
    addSphere('dynamic', { x, y, z }, radius, 1, { x: 0.22 + 0.05 * (i % 4), y: 0.44 + 0.06 * (i % 5), z: 0.86 });
  }
}

function addMixedScene() {
  addBounds();
  addBox('fixed', { x: 0, y: 1, z: 0 }, { x: 3.3, y: 0.18, z: 2.2 }, 0, { x: 0.46, y: 0.4, z: 0.32 });

  for (let i = 0; i < 48; i += 1) {
    const x = -4.8 + (i % 8) * 1.35;
    const z = -4.2 + ((i * 5) % 9) * 1.0;
    const y = 5.0 + Math.floor(i / 8) * 0.85;
    const velocity = { x: i % 2 ? -1.2 : 1.2, y: 0, z: ((i % 3) - 1) * 0.55 };

    if (i % 3 === 0) {
      addSphere('dynamic', { x, y, z }, 0.42, 1, { x: 0.9, y: 0.38, z: 0.26 }, velocity);
    } else {
      addBox('dynamic', { x, y, z }, { x: 0.34, y: 0.47, z: 0.34 }, 1, { x: 0.25, y: 0.66, z: 0.54 }, velocity);
    }
  }
}

function syncRenderData() {
  ensureBodyDataCapacity();

  for (let i = 0; i < bodies.length; i += 1) {
    const record = bodies[i];
    const position = record.body.translation();
    const quaternion = record.body.rotation();
    const offset = i * BODY_FLOAT_STRIDE;
    bodyData[offset] = position.x;
    bodyData[offset + 1] = position.y;
    bodyData[offset + 2] = position.z;
    bodyData[offset + 3] = quaternion.x;
    bodyData[offset + 4] = quaternion.y;
    bodyData[offset + 5] = quaternion.z;
    bodyData[offset + 6] = quaternion.w;
    bodyData[offset + 7] = record.shapeType === RENDER_BOX ? record.hx * 2 : record.radius * 2;
    bodyData[offset + 8] = record.shapeType === RENDER_BOX ? record.hy * 2 : record.radius * 2;
    bodyData[offset + 9] = record.shapeType === RENDER_BOX ? record.hz * 2 : record.radius * 2;
    bodyData[offset + 10] = record.shapeType;
    bodyData[offset + 11] = record.color.x;
    bodyData[offset + 12] = record.color.y;
    bodyData[offset + 13] = record.color.z;
  }
}

function reset(index = 0) {
  createWorld();
  lastStressRequested = 0;
  lastStressDynamicCount = 0;
  sceneIndex = index % 3;

  if (sceneIndex === 1) {
    addSphereScene();
  } else if (sceneIndex === 2) {
    addMixedScene();
  } else {
    addStackScene();
  }

  syncRenderData();
  return bodies.length;
}

function resetStress(dynamicBlockCount = 64) {
  createWorld();
  sceneIndex = 3;
  lastStressRequested = dynamicBlockCount;
  lastStressDynamicCount = addStressBlocks(dynamicBlockCount);
  syncRenderData();
  return bodies.length;
}

function resetArena(halfWidth = 64) {
  createWorld();
  sceneIndex = 4;
  lastStressRequested = 0;
  lastStressDynamicCount = 0;
  addSizedBounds(Math.max(DEFAULT_ARENA_HALF_WIDTH, halfWidth), 8.0, 8.5);
  syncRenderData();
  return bodies.length;
}

function getAwakeBodyCount() {
  let count = 0;
  for (const record of bodies) {
    if (record.dynamic && !record.body.isSleeping()) {
      count += 1;
    }
  }
  return count;
}

function snapshot() {
  const renderSyncStartedAt = performance.now();
  syncRenderData();
  renderSyncMs = performance.now() - renderSyncStartedAt;

  const snapshotStartedAt = performance.now();
  const visibleBodyData = new Float32Array(bodyData.subarray(0, bodies.length * BODY_FLOAT_STRIDE));
  snapshotCopyMs = performance.now() - snapshotStartedAt;
  snapshotBytes = visibleBodyData.byteLength;

  postMessage(
    {
      type: 'state',
      bodyCount: bodies.length,
      awakeBodyCount: getAwakeBodyCount(),
      bodyStride: BODY_FLOAT_STRIDE,
      bodyData: visibleBodyData,
      stepCount,
      stressDynamicCount: lastStressDynamicCount,
      lastStressRequest: lastStressRequested,
      maxBodies: MAX_RENDER_BODIES,
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
      lastForceSleepMs: 0,
      forcedSleepBodies: 0,
      threadsEnabled: false,
    },
    [visibleBodyData.buffer]
  );
}

function tick() {
  if (!world || paused) {
    return;
  }

  const now = performance.now();
  const dt = Math.min((now - lastStepAt) / 1000 || 1 / 60, 1 / 30);
  lastStepAt = now;
  world.timestep = dt;
  const stepStartedAt = performance.now();
  world.step();
  const stepEndedAt = performance.now();

  stepCount += 1;
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
  if (!rapierReady) {
    rapierReady = RAPIER.init();
  }
  await rapierReady;
  reset(sceneIndex);
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

  if (!world) {
    return;
  }

  if (message.type === 'reset') {
    reset(message.sceneIndex ?? 0);
    resetSpawnMetrics();
    paused = false;
    lastStepAt = performance.now();
    resetMetrics(lastStepAt);
    snapshot();
    return;
  }

  if (message.type === 'resetStress') {
    const resetStartedAt = performance.now();
    resetStress(message.dynamicBlockCount ?? 64);
    resetSpawnMetrics();
    resetStressMs = performance.now() - resetStartedAt;
    paused = false;
    lastStepAt = performance.now();
    resetMetrics(lastStepAt);
    snapshot();
    return;
  }

  if (message.type === 'resetArena') {
    resetArena(message.halfWidth ?? 64);
    resetSpawnMetrics();
    paused = false;
    lastStepAt = performance.now();
    resetMetrics(lastStepAt);
    snapshot();
    return;
  }

  if (message.type === 'spawnBox') {
    addBox('dynamic', message.position ?? { x: 0, y: 6, z: 0 }, { x: 0.45, y: 0.45, z: 0.45 }, 1, {
      x: 0.94,
      y: 0.6,
      z: 0.22,
    }, message.velocity ?? { x: 0, y: 0, z: 0 });
    snapshot();
    return;
  }

  if (message.type === 'addBodies') {
    const spawnStartedAt = performance.now();
    spawnBodiesCount = addBodies(message.bodies ?? []);
    spawnBodiesMs = performance.now() - spawnStartedAt;
    spawnBatchCount += 1;
    snapshot();
    return;
  }

  if (message.type === 'spawnSphere') {
    addSphere(
      'dynamic',
      message.position ?? { x: 0, y: 6, z: 0 },
      0.45,
      1,
      { x: 0.3, y: 0.63, z: 0.95 },
      message.velocity ?? { x: 0, y: 0, z: 0 }
    );
    snapshot();
    return;
  }

  if (message.type === 'setGravityEnabled') {
    gravityEnabled = Boolean(message.enabled);
    world.gravity = gravityEnabled ? { x: 0, y: -10, z: 0 } : { x: 0, y: 0, z: 0 };
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

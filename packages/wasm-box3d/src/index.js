export const BODY_FLOAT_STRIDE = 14;
export const PROFILE_FLOAT_STRIDE = 73;

export const RenderShapeType = Object.freeze({
  box: 0,
  sphere: 1,
});

const StressLayoutCode = Object.freeze({
  dense: 0,
  wide: 1,
  islands: 2,
});

const SleepPolicyCode = Object.freeze({
  normal: 0,
  aggressive: 1,
  disabled: 2,
});

const ProfileKeys = Object.freeze([
  'step',
  'pairs',
  'broadphaseMoves',
  'broadphaseTreeNodeVisits',
  'broadphaseTreeLeafVisits',
  'broadphaseDuplicatePairs',
  'broadphaseExistingPairs',
  'broadphaseCandidatePairs',
  'broadphaseOverflowPairs',
  'broadphaseCreatedContacts',
  'broadphasePairSetCount',
  'dynamicTreeHeight',
  'dynamicTreeAreaRatio',
  'collide',
  'collideGather',
  'collideTask',
  'collideContactState',
  'collideTouchingContacts',
  'collideNonTouchingContacts',
  'collideTotalContacts',
  'collideRecycledContacts',
  'collideUpdatedContacts',
  'collideDisjointContacts',
  'collideStartedTouching',
  'collideStoppedTouching',
  'collideManifoldContacts',
  'collideSatCalls',
  'collideSatCacheHits',
  'collideSatSameHullCalls',
  'collideSatBoxHullCalls',
  'collideSatCacheSeparationHits',
  'collideSatCacheFaceHits',
  'collideSatCacheEdgeHits',
  'collideSatFullSearches',
  'collideRecycleCandidates',
  'collideRecycleMissingCache',
  'collideRecycleFastMesh',
  'collideRecycleTested',
  'collideRecycleRejectedAngular',
  'collideRecycleRejectedLinear',
  'collideRecycleRejectedArc',
  'solve',
  'solverSetup',
  'solverAwakeBodies',
  'solverActiveColors',
  'solverWideContacts',
  'solverMeshContacts',
  'solverManifolds',
  'solverOverflowContacts',
  'solverOverflowManifolds',
  'solverGraphBlocks',
  'constraints',
  'prepareConstraints',
  'prepareJoints',
  'prepareWideContacts',
  'prepareMeshContacts',
  'prepareOverflow',
  'integrateVelocities',
  'warmStart',
  'solveImpulses',
  'integratePositions',
  'relaxImpulses',
  'applyRestitution',
  'storeImpulses',
  'splitIslands',
  'transforms',
  'sensorHits',
  'jointEvents',
  'hitEvents',
  'refit',
  'bullets',
  'sleepIslands',
  'sensors',
]);

function resolveStressLayout(value = 'dense') {
  return StressLayoutCode[value] ?? StressLayoutCode.dense;
}

function resolveSleepPolicy(value = 'normal') {
  return SleepPolicyCode[value] ?? SleepPolicyCode.normal;
}

function normalizePerformanceOptions(options = {}) {
  return {
    stressLayout: options.stressLayout ?? 'dense',
    sleepPolicy: options.sleepPolicy ?? 'normal',
    continuous: options.continuous !== false,
    contactHertz: Number.isFinite(options.contactHertz) && options.contactHertz > 0 ? options.contactHertz : 30,
    contactDampingRatio:
      Number.isFinite(options.contactDampingRatio) && options.contactDampingRatio > 0 ? options.contactDampingRatio : 10,
    contactSpeed: Number.isFinite(options.contactSpeed) && options.contactSpeed > 0 ? options.contactSpeed : 3,
    workerCount: Number.isFinite(options.workerCount) && options.workerCount > 0 ? Math.round(options.workerCount) : 0,
    contactRecycleDistance:
      Number.isFinite(options.contactRecycleDistance) && options.contactRecycleDistance >= 0
        ? options.contactRecycleDistance
        : 0.05,
    contactBudgetPerBody:
      Number.isFinite(options.contactBudgetPerBody) && options.contactBudgetPerBody > 0
        ? Math.round(options.contactBudgetPerBody)
        : 0,
  };
}

function canUsePthreads() {
  return typeof crossOriginIsolated === 'boolean' && crossOriginIsolated && typeof SharedArrayBuffer === 'function';
}

function resolveThreadsEnabled(threads = 'auto') {
  if (threads === false || threads === 'single') {
    return false;
  }

  const supported = canUsePthreads();
  if (threads === true || threads === 'pthreads') {
    if (!supported) {
      throw new Error(
        'Threaded wasm-box3d requires SharedArrayBuffer and cross-origin isolation. Serve COOP/COEP headers or pass { threads: false }.'
      );
    }
    return true;
  }

  return supported;
}

export async function loadBox3D(options = {}) {
  const threadsEnabled = resolveThreadsEnabled(options.threads);
  const { default: Box3DModule } = threadsEnabled
    ? await import('./wasm/box3d-wasm-pthreads.js')
    : await import('./wasm/box3d-wasm.js');
  const moduleOptions = {
    ...options.module,
    locateFile(path, prefix) {
      if (typeof options.locateFile === 'function') {
        return options.locateFile(path, prefix);
      }
      return new URL(`./wasm/${path}`, import.meta.url).href;
    },
  };

  const module = await Box3DModule(moduleOptions);
  module.__wasmBox3DThreads = threadsEnabled;
  return module;
}

export async function createBox3DDemo(options = {}) {
  const module = await loadBox3D(options);
  const api = {
    reset: module.cwrap('wb3_reset', 'number', ['number']),
    resetStressRaw: module.cwrap('wb3_reset_stress', 'number', ['number']),
    resetArenaRaw: module.cwrap('wb3_reset_arena', 'number', ['number']),
    stepWorld: module.cwrap('wb3_step', null, ['number', 'number']),
    syncRenderDataRaw: module.cwrap('wb3_sync_render_data', null, []),
    rebuildDynamicTreeRaw: module.cwrap('wb3_rebuild_dynamic_tree', 'number', []),
    spawnBoxRaw: module.cwrap('wb3_spawn_box', 'number', ['number', 'number', 'number', 'number', 'number', 'number']),
    spawnBoxExRaw: module.cwrap('wb3_spawn_box_ex', 'number', [
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
    ]),
    spawnBoxExNoSyncRaw: module.cwrap('wb3_spawn_box_ex_no_sync', 'number', [
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
    ]),
    spawnSphereRaw: module.cwrap('wb3_spawn_sphere', 'number', ['number', 'number', 'number', 'number', 'number', 'number']),
    spawnSphereExRaw: module.cwrap('wb3_spawn_sphere_ex', 'number', [
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
    ]),
    spawnSphereExNoSyncRaw: module.cwrap('wb3_spawn_sphere_ex_no_sync', 'number', [
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
    ]),
    setGravityEnabledRaw: module.cwrap('wb3_set_gravity_enabled', null, ['number']),
    setPerformanceOptionsRaw: module.cwrap('wb3_set_performance_options', null, [
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
    ]),
    forceSleepAwakeBodiesRaw: module.cwrap('wb3_force_sleep_awake_bodies', 'number', []),
    sleepQuietRegionsRaw: module.cwrap('wb3_sleep_quiet_regions', 'number', ['number', 'number', 'number', 'number']),
    getBodyCountRaw: module.cwrap('wb3_get_body_count', 'number', []),
    getAwakeBodyCountRaw: module.cwrap('wb3_get_awake_body_count', 'number', []),
    getContactCountRaw: module.cwrap('wb3_get_contact_count', 'number', []),
    getAwakeContactCountRaw: module.cwrap('wb3_get_awake_contact_count', 'number', []),
    getIslandCountRaw: module.cwrap('wb3_get_island_count', 'number', []),
    getTaskCountRaw: module.cwrap('wb3_get_task_count', 'number', []),
    getStackUsedRaw: module.cwrap('wb3_get_stack_used', 'number', []),
    getActualWorkerCountRaw: module.cwrap('wb3_get_actual_worker_count', 'number', []),
    getStressLayoutRaw: module.cwrap('wb3_get_stress_layout', 'number', []),
    getSleepPolicyRaw: module.cwrap('wb3_get_sleep_policy', 'number', []),
    getContinuousEnabledRaw: module.cwrap('wb3_get_continuous_enabled', 'number', []),
    getBodyStrideRaw: module.cwrap('wb3_get_body_stride', 'number', []),
    getBodyDataRaw: module.cwrap('wb3_get_body_data', 'pointer', []),
    getProfileStrideRaw: module.cwrap('wb3_get_profile_stride', 'number', []),
    getProfileDataRaw: module.cwrap('wb3_get_profile_data', 'pointer', []),
    getStepCountRaw: module.cwrap('wb3_get_step_count', 'number', []),
    getStressDynamicCountRaw: module.cwrap('wb3_get_stress_dynamic_count', 'number', []),
    getLastStressRequestRaw: module.cwrap('wb3_get_last_stress_request', 'number', []),
    getMaxBodiesRaw: module.cwrap('wb3_get_max_bodies', 'number', []),
  };

  const applyPerformanceOptions = (performanceOptions = {}) => {
    const normalized = normalizePerformanceOptions(performanceOptions);
    api.setPerformanceOptionsRaw(
      resolveStressLayout(normalized.stressLayout),
      resolveSleepPolicy(normalized.sleepPolicy),
      normalized.continuous ? 1 : 0,
      normalized.contactHertz,
      normalized.contactDampingRatio,
      normalized.contactSpeed,
      normalized.workerCount,
      normalized.contactRecycleDistance,
      normalized.contactBudgetPerBody
    );
  };

  applyPerformanceOptions(options.performance ?? options.performanceOptions ?? {});
  api.reset(options.sceneIndex ?? 0);

  return {
    module,
    threadsEnabled: module.__wasmBox3DThreads === true,
    reset(sceneIndex = 0) {
      return api.reset(sceneIndex);
    },
    resetStress(dynamicBlockCount = 64) {
      return api.resetStressRaw(dynamicBlockCount);
    },
    resetArena(halfWidth = 64) {
      return api.resetArenaRaw(halfWidth);
    },
    step(dt = 1 / 60, substeps = 4) {
      api.stepWorld(dt, substeps);
    },
    syncRenderData() {
      api.syncRenderDataRaw();
    },
    rebuildDynamicTree() {
      return api.rebuildDynamicTreeRaw();
    },
    spawnBox(position = {}, velocity = {}) {
      return api.spawnBoxRaw(
        position.x ?? 0,
        position.y ?? 6,
        position.z ?? 0,
        velocity.x ?? 0,
        velocity.y ?? 0,
        velocity.z ?? 0
      );
    },
    addBox(options = {}, addOptions = {}) {
      const position = options.position ?? {};
      const halfExtents = options.halfExtents ?? {};
      const velocity = options.velocity ?? {};
      const color = options.color ?? {};
      const spawnRaw = addOptions.sync === false ? api.spawnBoxExNoSyncRaw : api.spawnBoxExRaw;
      return spawnRaw(
        position.x ?? 0,
        position.y ?? 6,
        position.z ?? 0,
        halfExtents.x ?? 0.45,
        halfExtents.y ?? 0.45,
        halfExtents.z ?? 0.45,
        velocity.x ?? 0,
        velocity.y ?? 0,
        velocity.z ?? 0,
        color.x ?? color.r ?? 0.94,
        color.y ?? color.g ?? 0.6,
        color.z ?? color.b ?? 0.22,
        options.bodyType === 'fixed' ? 0 : 1,
        options.rotationY ?? 0,
        options.density ?? 1
      );
    },
    addBodies(bodies = [], options = {}) {
      const startedAt = performance.now();
      let created = 0;
      for (const body of bodies) {
        const shapeType = body.shapeType ?? body.shape ?? 'box';
        const bodyIndex =
          shapeType === RenderShapeType.sphere || shapeType === 'sphere'
            ? this.addSphere(body, { sync: false })
            : this.addBox(body, { sync: false });
        if (bodyIndex >= 0) {
          created += 1;
        }
      }
      const spawnMs = performance.now() - startedAt;
      let syncMs = 0;
      if (options.sync !== false) {
        const syncStartedAt = performance.now();
        api.syncRenderDataRaw();
        syncMs = performance.now() - syncStartedAt;
      }
      return { created, spawnMs, syncMs };
    },
    spawnSphere(position = {}, velocity = {}) {
      return api.spawnSphereRaw(
        position.x ?? 0,
        position.y ?? 6,
        position.z ?? 0,
        velocity.x ?? 0,
        velocity.y ?? 0,
        velocity.z ?? 0
      );
    },
    addSphere(options = {}, addOptions = {}) {
      const position = options.position ?? {};
      const velocity = options.velocity ?? {};
      const color = options.color ?? {};
      const spawnRaw = addOptions.sync === false ? api.spawnSphereExNoSyncRaw : api.spawnSphereExRaw;
      return spawnRaw(
        position.x ?? 0,
        position.y ?? 6,
        position.z ?? 0,
        options.radius ?? 0.45,
        velocity.x ?? 0,
        velocity.y ?? 0,
        velocity.z ?? 0,
        color.x ?? color.r ?? 0.3,
        color.y ?? color.g ?? 0.63,
        color.z ?? color.b ?? 0.95,
        options.bodyType === 'fixed' ? 0 : 1,
        options.density ?? 1
      );
    },
    setGravityEnabled(enabled) {
      api.setGravityEnabledRaw(enabled ? 1 : 0);
    },
    setPerformanceOptions(options = {}) {
      applyPerformanceOptions(options);
    },
    forceSleepAwakeBodies() {
      return api.forceSleepAwakeBodiesRaw();
    },
    sleepQuietRegions(options = {}) {
      return api.sleepQuietRegionsRaw(
        Number.isFinite(options.tileSize) ? options.tileSize : 8,
        Number.isFinite(options.speedThreshold) ? options.speedThreshold : 0.08,
        Number.isFinite(options.minBodies) ? Math.round(options.minBodies) : 16,
        Number.isFinite(options.startBodyIndex) ? Math.round(options.startBodyIndex) : 5
      );
    },
    getBodyCount() {
      return api.getBodyCountRaw();
    },
    getAwakeBodyCount() {
      return api.getAwakeBodyCountRaw();
    },
    getContactCount() {
      return api.getContactCountRaw();
    },
    getAwakeContactCount() {
      return api.getAwakeContactCountRaw();
    },
    getIslandCount() {
      return api.getIslandCountRaw();
    },
    getTaskCount() {
      return api.getTaskCountRaw();
    },
    getStackUsed() {
      return api.getStackUsedRaw();
    },
    getActualWorkerCount() {
      return api.getActualWorkerCountRaw();
    },
    getStressLayoutCode() {
      return api.getStressLayoutRaw();
    },
    getSleepPolicyCode() {
      return api.getSleepPolicyRaw();
    },
    getContinuousEnabled() {
      return api.getContinuousEnabledRaw() !== 0;
    },
    getBodyStride() {
      return api.getBodyStrideRaw();
    },
    getBodyData() {
      const count = api.getBodyCountRaw();
      const stride = api.getBodyStrideRaw();
      const pointer = api.getBodyDataRaw();
      return new Float32Array(module.HEAPF32.buffer, Number(pointer), count * stride);
    },
    getProfileStride() {
      return api.getProfileStrideRaw();
    },
    getProfileData() {
      const stride = api.getProfileStrideRaw();
      const pointer = api.getProfileDataRaw();
      return new Float32Array(module.HEAPF32.buffer, Number(pointer), stride);
    },
    getProfile() {
      const values = this.getProfileData();
      const profile = {};
      for (let i = 0; i < ProfileKeys.length; ++i) {
        profile[ProfileKeys[i]] = values[i] ?? 0;
      }
      return profile;
    },
    getStepCount() {
      return api.getStepCountRaw();
    },
    getStressDynamicCount() {
      return api.getStressDynamicCountRaw();
    },
    getLastStressRequest() {
      return api.getLastStressRequestRaw();
    },
    getMaxBodies() {
      return api.getMaxBodiesRaw();
    },
  };
}

export function readBodyRecord(bodyData, index, stride = BODY_FLOAT_STRIDE) {
  const offset = index * stride;
  return {
    position: {
      x: bodyData[offset],
      y: bodyData[offset + 1],
      z: bodyData[offset + 2],
    },
    quaternion: {
      x: bodyData[offset + 3],
      y: bodyData[offset + 4],
      z: bodyData[offset + 5],
      w: bodyData[offset + 6],
    },
    size: {
      x: bodyData[offset + 7],
      y: bodyData[offset + 8],
      z: bodyData[offset + 9],
    },
    shapeType: bodyData[offset + 10],
    color: {
      r: bodyData[offset + 11],
      g: bodyData[offset + 12],
      b: bodyData[offset + 13],
    },
  };
}

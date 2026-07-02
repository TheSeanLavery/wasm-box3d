import Box3DModule from './wasm/box3d-wasm.js';

export const BODY_FLOAT_STRIDE = 14;

export const RenderShapeType = Object.freeze({
  box: 0,
  sphere: 1,
});

export async function loadBox3D(options = {}) {
  const moduleOptions = {
    ...options.module,
    locateFile(path, prefix) {
      if (typeof options.locateFile === 'function') {
        return options.locateFile(path, prefix);
      }
      return new URL(`./wasm/${path}`, import.meta.url).href;
    },
  };

  return Box3DModule(moduleOptions);
}

export async function createBox3DDemo(options = {}) {
  const module = await loadBox3D(options);
  const api = {
    reset: module.cwrap('wb3_reset', 'number', ['number']),
    stepWorld: module.cwrap('wb3_step', null, ['number', 'number']),
    spawnBoxRaw: module.cwrap('wb3_spawn_box', 'number', ['number', 'number', 'number', 'number', 'number', 'number']),
    spawnSphereRaw: module.cwrap('wb3_spawn_sphere', 'number', ['number', 'number', 'number', 'number', 'number', 'number']),
    setGravityEnabledRaw: module.cwrap('wb3_set_gravity_enabled', null, ['number']),
    getBodyCountRaw: module.cwrap('wb3_get_body_count', 'number', []),
    getBodyStrideRaw: module.cwrap('wb3_get_body_stride', 'number', []),
    getBodyDataRaw: module.cwrap('wb3_get_body_data', 'number', []),
    getStepCountRaw: module.cwrap('wb3_get_step_count', 'number', []),
    getMaxBodiesRaw: module.cwrap('wb3_get_max_bodies', 'number', []),
  };

  api.reset(options.sceneIndex ?? 0);

  return {
    module,
    reset(sceneIndex = 0) {
      return api.reset(sceneIndex);
    },
    step(dt = 1 / 60, substeps = 4) {
      api.stepWorld(dt, substeps);
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
    setGravityEnabled(enabled) {
      api.setGravityEnabledRaw(enabled ? 1 : 0);
    },
    getBodyCount() {
      return api.getBodyCountRaw();
    },
    getBodyStride() {
      return api.getBodyStrideRaw();
    },
    getBodyData() {
      const count = api.getBodyCountRaw();
      const stride = api.getBodyStrideRaw();
      const pointer = api.getBodyDataRaw();
      return new Float32Array(module.HEAPF32.buffer, pointer, count * stride);
    },
    getStepCount() {
      return api.getStepCountRaw();
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


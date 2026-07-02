import { RenderShapeType } from '@threecyborgs/wasm-box3d';

export function createThreeBodyMeshManager({ THREE, scene, materialFactory } = {}) {
  if (!THREE) {
    throw new Error('createThreeBodyMeshManager requires the THREE module.');
  }
  if (!scene) {
    throw new Error('createThreeBodyMeshManager requires a Three.js scene.');
  }

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sphereGeometry = new THREE.SphereGeometry(0.5, 12, 8);
  const arenaMeshes = [];
  const instanceMatrix = new THREE.Matrix4();
  const instancePosition = new THREE.Vector3();
  const instanceQuaternion = new THREE.Quaternion();
  const instanceScale = new THREE.Vector3();
  const instanceColor = new THREE.Color();

  let boxInstances;
  let sphereInstances;
  let boxCapacity = 0;
  let sphereCapacity = 0;
  let lastBoxColorCount = -1;
  let lastSphereColorCount = -1;

  function getRecordAt(bodyData, offset) {
    return {
      position: { x: bodyData[offset], y: bodyData[offset + 1], z: bodyData[offset + 2] },
      quaternion: { x: bodyData[offset + 3], y: bodyData[offset + 4], z: bodyData[offset + 5], w: bodyData[offset + 6] },
      size: { x: bodyData[offset + 7], y: bodyData[offset + 8], z: bodyData[offset + 9] },
      shapeType: bodyData[offset + 10],
      color: { r: bodyData[offset + 11], g: bodyData[offset + 12], b: bodyData[offset + 13] },
    };
  }

  function isArenaBoundAt(index, bodyData, offset) {
    return (
      index < 5 &&
      bodyData[offset + 10] === RenderShapeType.box &&
      (bodyData[offset + 7] > 10 || bodyData[offset + 8] > 5 || bodyData[offset + 9] > 10)
    );
  }

  function makeArenaMaterial(record, index) {
    if (materialFactory) {
      return materialFactory(record);
    }

    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(record.color.r, record.color.g, record.color.b),
      roughness: 0.82,
      metalness: 0.0,
      transparent: true,
      opacity: index === 0 ? 0.22 : 0.34,
      depthWrite: false,
      side: THREE.DoubleSide,
      wireframe: index !== 0,
    });
  }

  function makeInstanceMaterial(shapeType) {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: shapeType === RenderShapeType.sphere ? 0.42 : 0.58,
      metalness: 0.03,
      vertexColors: true,
    });
  }

  function hideArenaMeshes(fromIndex) {
    for (let i = fromIndex; i < arenaMeshes.length; i += 1) {
      arenaMeshes[i].visible = false;
    }
  }

  function syncArenaMesh(arenaIndex, bodyIndex, record) {
    let mesh = arenaMeshes[arenaIndex];
    if (!mesh) {
      mesh = new THREE.Mesh(boxGeometry, makeArenaMaterial(record, bodyIndex));
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      arenaMeshes[arenaIndex] = mesh;
      scene.add(mesh);
    }

    mesh.visible = true;
    mesh.position.set(record.position.x, record.position.y, record.position.z);
    mesh.quaternion.set(record.quaternion.x, record.quaternion.y, record.quaternion.z, record.quaternion.w);
    mesh.scale.set(record.size.x, record.size.y, record.size.z);
  }

  function disposeInstancedMesh(mesh) {
    if (!mesh) {
      return;
    }
    scene.remove(mesh);
    mesh.material.dispose();
  }

  function ensureInstances(kind, required) {
    if (kind === RenderShapeType.sphere) {
      if (sphereInstances && sphereCapacity >= required) {
        return sphereInstances;
      }
      disposeInstancedMesh(sphereInstances);
      sphereCapacity = Math.max(1, required);
      lastSphereColorCount = -1;
      sphereInstances = new THREE.InstancedMesh(sphereGeometry, makeInstanceMaterial(RenderShapeType.sphere), sphereCapacity);
      sphereInstances.castShadow = false;
      sphereInstances.receiveShadow = false;
      sphereInstances.frustumCulled = false;
      scene.add(sphereInstances);
      return sphereInstances;
    }

    if (boxInstances && boxCapacity >= required) {
      return boxInstances;
    }
    disposeInstancedMesh(boxInstances);
    boxCapacity = Math.max(1, required);
    lastBoxColorCount = -1;
    boxInstances = new THREE.InstancedMesh(boxGeometry, makeInstanceMaterial(RenderShapeType.box), boxCapacity);
    boxInstances.castShadow = false;
    boxInstances.receiveShadow = false;
    boxInstances.frustumCulled = false;
    scene.add(boxInstances);
    return boxInstances;
  }

  function writeInstance(mesh, instanceIndex, bodyData, offset, writeColor) {
    instancePosition.set(bodyData[offset], bodyData[offset + 1], bodyData[offset + 2]);
    instanceQuaternion.set(bodyData[offset + 3], bodyData[offset + 4], bodyData[offset + 5], bodyData[offset + 6]);
    instanceScale.set(bodyData[offset + 7], bodyData[offset + 8], bodyData[offset + 9]);
    instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale);
    mesh.setMatrixAt(instanceIndex, instanceMatrix);

    if (writeColor) {
      instanceColor.setRGB(bodyData[offset + 11], bodyData[offset + 12], bodyData[offset + 13]);
      mesh.setColorAt(instanceIndex, instanceColor);
    }
  }

  return {
    arenaMeshes,
    get meshes() {
      return [...arenaMeshes, boxInstances, sphereInstances].filter(Boolean);
    },
    sync(physics) {
      const count = physics.getBodyCount();
      const stride = physics.getBodyStride();
      const bodyData = physics.getBodyData();
      let arenaCount = 0;
      let boxCount = 0;
      let sphereCount = 0;

      for (let i = 0; i < count; i += 1) {
        const offset = i * stride;
        if (isArenaBoundAt(i, bodyData, offset)) {
          syncArenaMesh(arenaCount, i, getRecordAt(bodyData, offset));
          arenaCount += 1;
        } else if (bodyData[offset + 10] === RenderShapeType.sphere) {
          sphereCount += 1;
        } else {
          boxCount += 1;
        }
      }

      hideArenaMeshes(arenaCount);

      const boxes = ensureInstances(RenderShapeType.box, boxCount);
      const spheres = ensureInstances(RenderShapeType.sphere, sphereCount);
      let boxIndex = 0;
      let sphereIndex = 0;
      const writeBoxColors = boxCount !== lastBoxColorCount;
      const writeSphereColors = sphereCount !== lastSphereColorCount;

      for (let i = 0; i < count; i += 1) {
        const offset = i * stride;
        if (isArenaBoundAt(i, bodyData, offset)) {
          continue;
        }

        if (bodyData[offset + 10] === RenderShapeType.sphere) {
          writeInstance(spheres, sphereIndex, bodyData, offset, writeSphereColors);
          sphereIndex += 1;
        } else {
          writeInstance(boxes, boxIndex, bodyData, offset, writeBoxColors);
          boxIndex += 1;
        }
      }

      boxes.count = boxIndex;
      spheres.count = sphereIndex;
      boxes.instanceMatrix.needsUpdate = true;
      spheres.instanceMatrix.needsUpdate = true;
      if (writeBoxColors && boxes.instanceColor) {
        boxes.instanceColor.needsUpdate = true;
        lastBoxColorCount = boxIndex;
      }
      if (writeSphereColors && spheres.instanceColor) {
        spheres.instanceColor.needsUpdate = true;
        lastSphereColorCount = sphereIndex;
      }
    },
    dispose() {
      for (const mesh of arenaMeshes) {
        scene.remove(mesh);
        mesh.material.dispose();
      }
      disposeInstancedMesh(boxInstances);
      disposeInstancedMesh(sphereInstances);
      boxGeometry.dispose();
      sphereGeometry.dispose();
      arenaMeshes.length = 0;
      boxInstances = undefined;
      sphereInstances = undefined;
      boxCapacity = 0;
      sphereCapacity = 0;
      lastBoxColorCount = -1;
      lastSphereColorCount = -1;
    },
  };
}

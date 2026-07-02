import { RenderShapeType } from '@threecyborgs/wasm-box3d';

export function createThreeBodyMeshManager({ THREE, scene, materialFactory } = {}) {
  if (!THREE) {
    throw new Error('createThreeBodyMeshManager requires the THREE module.');
  }
  if (!scene) {
    throw new Error('createThreeBodyMeshManager requires a Three.js scene.');
  }

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sphereGeometry = new THREE.SphereGeometry(0.5, 32, 18);
  const meshes = [];

  function makeMaterial(record) {
    if (materialFactory) {
      return materialFactory(record);
    }

    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(record.color.r, record.color.g, record.color.b),
      roughness: record.shapeType === RenderShapeType.sphere ? 0.42 : 0.58,
      metalness: 0.03,
    });
  }

  function getRecord(bodyData, index, stride) {
    const offset = index * stride;
    return {
      position: { x: bodyData[offset], y: bodyData[offset + 1], z: bodyData[offset + 2] },
      quaternion: { x: bodyData[offset + 3], y: bodyData[offset + 4], z: bodyData[offset + 5], w: bodyData[offset + 6] },
      size: { x: bodyData[offset + 7], y: bodyData[offset + 8], z: bodyData[offset + 9] },
      shapeType: bodyData[offset + 10],
      color: { r: bodyData[offset + 11], g: bodyData[offset + 12], b: bodyData[offset + 13] },
    };
  }

  function ensureMesh(index, record) {
    let mesh = meshes[index];
    const geometry = record.shapeType === RenderShapeType.sphere ? sphereGeometry : boxGeometry;

    if (!mesh) {
      mesh = new THREE.Mesh(geometry, makeMaterial(record));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      meshes[index] = mesh;
      scene.add(mesh);
      return mesh;
    }

    if (mesh.geometry !== geometry) {
      mesh.geometry = geometry;
      mesh.material.dispose();
      mesh.material = makeMaterial(record);
    }

    return mesh;
  }

  return {
    meshes,
    sync(physics) {
      const count = physics.getBodyCount();
      const stride = physics.getBodyStride();
      const bodyData = physics.getBodyData();

      for (let i = 0; i < count; i += 1) {
        const record = getRecord(bodyData, i, stride);
        const mesh = ensureMesh(i, record);
        mesh.visible = true;
        mesh.position.set(record.position.x, record.position.y, record.position.z);
        mesh.quaternion.set(record.quaternion.x, record.quaternion.y, record.quaternion.z, record.quaternion.w);
        mesh.scale.set(record.size.x, record.size.y, record.size.z);
      }

      for (let i = count; i < meshes.length; i += 1) {
        meshes[i].visible = false;
      }
    },
    dispose() {
      for (const mesh of meshes) {
        scene.remove(mesh);
        mesh.material.dispose();
      }
      boxGeometry.dispose();
      sphereGeometry.dispose();
      meshes.length = 0;
    },
  };
}


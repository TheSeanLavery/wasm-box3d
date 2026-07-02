import type * as ThreeNamespace from 'three';
import type { Box3DDemo } from '@threecyborgs/wasm-box3d';

export type ThreeBodyMeshManagerOptions = {
  THREE: typeof ThreeNamespace;
  scene: ThreeNamespace.Scene;
  materialFactory?: (record: unknown) => ThreeNamespace.Material;
};

export type ThreeBodyMeshManager = {
  readonly meshes: ThreeNamespace.Object3D[];
  arenaMeshes: ThreeNamespace.Mesh[];
  sync(physics: Box3DDemo): void;
  dispose(): void;
};

export declare function createThreeBodyMeshManager(options: ThreeBodyMeshManagerOptions): ThreeBodyMeshManager;

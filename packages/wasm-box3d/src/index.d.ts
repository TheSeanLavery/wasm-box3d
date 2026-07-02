export declare const BODY_FLOAT_STRIDE = 14;

export declare const RenderShapeType: Readonly<{
  box: 0;
  sphere: 1;
}>;

export type Vec3Like = {
  x?: number;
  y?: number;
  z?: number;
};

export type Box3DLoaderOptions = {
  locateFile?: (path: string, prefix: string) => string;
  module?: Record<string, unknown>;
  sceneIndex?: number;
  threads?: 'auto' | 'single' | 'pthreads' | boolean;
};

export type BodyRecord = {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  size: { x: number; y: number; z: number };
  shapeType: number;
  color: { r: number; g: number; b: number };
};

export type BoxBodyOptions = {
  position?: Vec3Like;
  halfExtents?: Vec3Like;
  velocity?: Vec3Like;
  color?: Vec3Like & { r?: number; g?: number; b?: number };
  bodyType?: 'dynamic' | 'fixed';
  rotationY?: number;
  density?: number;
};

export type AddBodiesOptions = {
  sync?: boolean;
};

export type AddBodiesResult = {
  created: number;
  spawnMs: number;
  syncMs: number;
};

export type Box3DDemo = {
  module: unknown;
  threadsEnabled: boolean;
  reset(sceneIndex?: number): number;
  resetStress(dynamicBlockCount?: number): number;
  resetArena(halfWidth?: number): number;
  step(dt?: number, substeps?: number): void;
  syncRenderData(): void;
  spawnBox(position?: Vec3Like, velocity?: Vec3Like): number;
  addBox(options?: BoxBodyOptions, addOptions?: AddBodiesOptions): number;
  addBodies(bodies?: BoxBodyOptions[], options?: AddBodiesOptions): AddBodiesResult;
  spawnSphere(position?: Vec3Like, velocity?: Vec3Like): number;
  setGravityEnabled(enabled: boolean): void;
  forceSleepAwakeBodies(): number;
  getBodyCount(): number;
  getAwakeBodyCount(): number;
  getBodyStride(): number;
  getBodyData(): Float32Array;
  getStepCount(): number;
  getStressDynamicCount(): number;
  getLastStressRequest(): number;
  getMaxBodies(): number;
};

export declare function loadBox3D(options?: Box3DLoaderOptions): Promise<unknown>;
export declare function createBox3DDemo(options?: Box3DLoaderOptions): Promise<Box3DDemo>;
export declare function readBodyRecord(bodyData: Float32Array, index: number, stride?: number): BodyRecord;

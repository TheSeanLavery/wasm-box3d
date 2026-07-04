export declare const BODY_FLOAT_STRIDE = 14;
export declare const PROFILE_FLOAT_STRIDE = 73;

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
  performance?: Box3DPerformanceOptions;
  performanceOptions?: Box3DPerformanceOptions;
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

export type SphereBodyOptions = {
  shape?: 'sphere';
  shapeType?: 1 | 'sphere';
  position?: Vec3Like;
  radius?: number;
  velocity?: Vec3Like;
  color?: Vec3Like & { r?: number; g?: number; b?: number };
  bodyType?: 'dynamic' | 'fixed';
  density?: number;
};

export type BodyOptions = BoxBodyOptions | SphereBodyOptions;

export type AddBodiesOptions = {
  sync?: boolean;
};

export type AddBodiesResult = {
  created: number;
  spawnMs: number;
  syncMs: number;
};

export type Box3DPerformanceOptions = {
  stressLayout?: 'dense' | 'wide' | 'islands';
  sleepPolicy?: 'normal' | 'aggressive' | 'disabled';
  continuous?: boolean;
  contactHertz?: number;
  contactDampingRatio?: number;
  contactSpeed?: number;
  workerCount?: number;
  contactRecycleDistance?: number;
  contactBudgetPerBody?: number;
};

export type Box3DProfile = {
  step: number;
  pairs: number;
  broadphaseMoves: number;
  broadphaseTreeNodeVisits: number;
  broadphaseTreeLeafVisits: number;
  broadphaseDuplicatePairs: number;
  broadphaseExistingPairs: number;
  broadphaseCandidatePairs: number;
  broadphaseOverflowPairs: number;
  broadphaseCreatedContacts: number;
  broadphasePairSetCount: number;
  dynamicTreeHeight: number;
  dynamicTreeAreaRatio: number;
  collide: number;
  collideGather: number;
  collideTask: number;
  collideContactState: number;
  collideTouchingContacts: number;
  collideNonTouchingContacts: number;
  collideTotalContacts: number;
  collideRecycledContacts: number;
  collideUpdatedContacts: number;
  collideDisjointContacts: number;
  collideStartedTouching: number;
  collideStoppedTouching: number;
  collideManifoldContacts: number;
  collideSatCalls: number;
  collideSatCacheHits: number;
  collideSatSameHullCalls: number;
  collideSatBoxHullCalls: number;
  collideSatCacheSeparationHits: number;
  collideSatCacheFaceHits: number;
  collideSatCacheEdgeHits: number;
  collideSatFullSearches: number;
  collideRecycleCandidates: number;
  collideRecycleMissingCache: number;
  collideRecycleFastMesh: number;
  collideRecycleTested: number;
  collideRecycleRejectedAngular: number;
  collideRecycleRejectedLinear: number;
  collideRecycleRejectedArc: number;
  solve: number;
  solverSetup: number;
  solverAwakeBodies: number;
  solverActiveColors: number;
  solverWideContacts: number;
  solverMeshContacts: number;
  solverManifolds: number;
  solverOverflowContacts: number;
  solverOverflowManifolds: number;
  solverGraphBlocks: number;
  constraints: number;
  prepareConstraints: number;
  prepareJoints: number;
  prepareWideContacts: number;
  prepareMeshContacts: number;
  prepareOverflow: number;
  integrateVelocities: number;
  warmStart: number;
  solveImpulses: number;
  integratePositions: number;
  relaxImpulses: number;
  applyRestitution: number;
  storeImpulses: number;
  splitIslands: number;
  transforms: number;
  sensorHits: number;
  jointEvents: number;
  hitEvents: number;
  refit: number;
  bullets: number;
  sleepIslands: number;
  sensors: number;
};

export type Box3DDemo = {
  module: unknown;
  threadsEnabled: boolean;
  reset(sceneIndex?: number): number;
  resetStress(dynamicBlockCount?: number): number;
  resetArena(halfWidth?: number): number;
  step(dt?: number, substeps?: number): void;
  syncRenderData(): void;
  rebuildDynamicTree(): number;
  spawnBox(position?: Vec3Like, velocity?: Vec3Like): number;
  addBox(options?: BoxBodyOptions, addOptions?: AddBodiesOptions): number;
  addSphere(options?: SphereBodyOptions, addOptions?: AddBodiesOptions): number;
  addBodies(bodies?: BodyOptions[], options?: AddBodiesOptions): AddBodiesResult;
  spawnSphere(position?: Vec3Like, velocity?: Vec3Like): number;
  setGravityEnabled(enabled: boolean): void;
  setPerformanceOptions(options?: Box3DPerformanceOptions): void;
  forceSleepAwakeBodies(): number;
  sleepQuietRegions(options?: {
    tileSize?: number;
    speedThreshold?: number;
    minBodies?: number;
    startBodyIndex?: number;
  }): number;
  getBodyCount(): number;
  getAwakeBodyCount(): number;
  getContactCount(): number;
  getAwakeContactCount(): number;
  getIslandCount(): number;
  getTaskCount(): number;
  getStackUsed(): number;
  getActualWorkerCount(): number;
  getStressLayoutCode(): number;
  getSleepPolicyCode(): number;
  getContinuousEnabled(): boolean;
  getBodyStride(): number;
  getBodyData(): Float32Array;
  getProfileStride(): number;
  getProfileData(): Float32Array;
  getProfile(): Box3DProfile;
  getStepCount(): number;
  getStressDynamicCount(): number;
  getLastStressRequest(): number;
  getMaxBodies(): number;
};

export declare function loadBox3D(options?: Box3DLoaderOptions): Promise<unknown>;
export declare function createBox3DDemo(options?: Box3DLoaderOptions): Promise<Box3DDemo>;
export declare function readBodyRecord(bodyData: Float32Array, index: number, stride?: number): BodyRecord;

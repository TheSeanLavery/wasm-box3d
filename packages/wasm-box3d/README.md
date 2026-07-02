# @threecyborgs/wasm-box3d

WebAssembly build and JavaScript loader for Box3D.

```sh
npm install @threecyborgs/wasm-box3d
```

```js
import { createBox3DDemo } from '@threecyborgs/wasm-box3d';

const physics = await createBox3DDemo();
physics.step(1 / 60, 4);
console.log(physics.getBodyCount(), physics.getBodyData());
```

Threaded WASM is optional. By default the loader uses pthreads only when the
browser exposes `SharedArrayBuffer` and the page is cross-origin isolated. It
falls back to the single-thread build everywhere else.

```js
await createBox3DDemo({ threads: 'auto' }); // default
await createBox3DDemo({ threads: false }); // force single-thread
await createBox3DDemo({ threads: true }); // require pthreads or throw
```

To use the threaded build, serve the app with:

```txt
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Stress scenes are available through `resetStress(dynamicBlockCount)`. The call
rebuilds the world with the requested number of dynamic boxes, capped by
`getMaxBodies()`, and `getStressDynamicCount()` reports how many stress boxes
were actually created.

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

Stress scenes are available through `resetStress(dynamicBlockCount)`. The call
rebuilds the world with the requested number of dynamic boxes, capped by
`getMaxBodies()`, and `getStressDynamicCount()` reports how many stress boxes
were actually created.

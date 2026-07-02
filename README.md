# wasm-box3d

WebAssembly packaging and Three.js rendering helpers for Erin Catto's Box3D.

This repository is not a fork of Box3D. It keeps upstream Box3D pinned as a Git submodule in `vendor/box3d`, then builds a browser-ready WASM module and npm packages around it.

## Packages

- `@threecyborgs/wasm-box3d`: ESM loader, TypeScript declarations, prebuilt `box3d-wasm.wasm`, and a demo-world API over the WASM module.
- `@threecyborgs/wasm-box3d-three`: Three.js mesh manager for syncing Box3D render-body data into a scene.
- `examples/three-viewer`: Vite app used for local development and GitHub Pages.

## Install

```sh
npm install @threecyborgs/wasm-box3d
```

For Three.js rendering helpers:

```sh
npm install three @threecyborgs/wasm-box3d @threecyborgs/wasm-box3d-three
```

## Setup

```sh
git clone --recurse-submodules https://github.com/TheSeanLavery/wasm-box3d.git
cd wasm-box3d
npm install
npm run build
npm run dev
```

Open `http://127.0.0.1:5300`.

## Verify

With the dev server running:

```sh
npm run verify:browser
```

The verifier checks desktop and mobile viewports for WASM activation, advancing physics steps, spawn behavior, console errors, viewport overflow, and nonblank Three.js screenshot pixels.

## Engine Benchmark

The example can compare the Box3D WASM worker with a Rapier worker using the same Three.js renderer and body snapshot format.

With the dev server running on `http://127.0.0.1:5300`:

```sh
npm run benchmark:engines
```

The benchmark launches headed Playwright by default and writes:

- `bench-results/latest.json`
- `bench-results/latest.csv`
- `bench-results/latest.html`

Useful overrides:

```sh
WB3_BENCH_LEVELS=64,256,1024 WB3_BENCH_SAMPLE_MS=3000 npm run benchmark:engines
WB3_BENCH_HEADLESS=1 npm run benchmark:engines
WB3_VERIFY_ENGINE=rapier npm run verify:browser
```

## Updating Box3D

```sh
./scripts/update-box3d.sh main
npm run build
npm run verify:browser
```

You can pass any upstream branch, tag, or commit SHA to `update-box3d.sh`.

## Publishing

Publishing is intended to happen from GitHub Actions with npm trusted publishing. Configure trusted publishers on npm for:

- `@threecyborgs/wasm-box3d`
- `@threecyborgs/wasm-box3d-three`

Use the workflow `.github/workflows/publish-npm.yml`.

GitHub Pages builds the example with `VITE_BASE_PATH=/wasm-box3d/` so the generated asset URLs work under the repository site path.

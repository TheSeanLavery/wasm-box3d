const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

async function verifyViewport(viewport, label) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport });
  const errors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('http://127.0.0.1:5300/', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => document.querySelector('#wasm-status')?.textContent === 'wasm active',
    null,
    { timeout: 10000 }
  );
  await page.waitForTimeout(1000);

  const before = await page.locator('#step-count').textContent();
  await page.waitForTimeout(800);
  const after = await page.locator('#step-count').textContent();

  const boxButton = page.getByRole('button', { name: 'Box' });
  const boxButtonCount = await boxButton.count();
  if (boxButtonCount !== 1) {
    throw new Error(`Expected one Box button, found ${boxButtonCount}`);
  }
  await boxButton.click();
  await page.waitForTimeout(300);

  const stressButton = page.getByRole('button', { name: 'Stress' });
  const stressButtonCount = await stressButton.count();
  if (stressButtonCount !== 1) {
    throw new Error(`Expected one Stress button, found ${stressButtonCount}`);
  }
  await stressButton.click();
  await page.waitForFunction(
    () => Number(document.querySelector('#body-count')?.textContent?.replace(/\D+/g, '') ?? 0) >= 69,
    null,
    { timeout: 10000 }
  );
  await page.waitForTimeout(500);

  const canvasBounds = await page.locator('#scene').boundingBox();
  const screenshot = await page.screenshot({ fullPage: true });
  const screenshotPath = path.resolve('../../artifacts', `${label}.png`);
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, screenshot);

  const png = PNG.sync.read(screenshot);
  let brightPixels = 0;
  const uniqueBuckets = new Set();
  let sampledPixels = 0;

  const x0 = Math.max(0, Math.floor(canvasBounds.x));
  const y0 = Math.max(0, Math.floor(canvasBounds.y));
  const x1 = Math.min(png.width, Math.ceil(canvasBounds.x + canvasBounds.width));
  const y1 = Math.min(png.height, Math.ceil(canvasBounds.y + canvasBounds.height));

  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      const index = (png.width * y + x) << 2;
      const r = png.data[index];
      const g = png.data[index + 1];
      const b = png.data[index + 2];
      const sum = r + g + b;
      if (sum > 140) {
        brightPixels += 1;
      }
      uniqueBuckets.add(`${r >> 4}:${g >> 4}:${b >> 4}`);
      sampledPixels += 1;
    }
  }

  const state = await page.evaluate(() => {
    return {
      status: document.querySelector('#wasm-status')?.textContent,
      bodies: document.querySelector('#body-count')?.textContent,
      fps: document.querySelector('#fps-readout')?.textContent,
      stress: document.querySelector('#stress-status')?.textContent,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      overflowY: document.documentElement.scrollHeight > window.innerHeight,
    };
  });

  await browser.close();

  const beforeStep = Number(before.replace(/\D+/g, ''));
  const afterStep = Number(after.replace(/\D+/g, ''));
  const finalBodies = Number(state.bodies.replace(/\D+/g, ''));

  if (errors.length > 0) {
    throw new Error(`${label} console errors:\n${errors.join('\n')}`);
  }
  if (state.status !== 'wasm active') {
    throw new Error(`${label} did not activate WASM`);
  }
  if (!(afterStep > beforeStep)) {
    throw new Error(`${label} physics step did not advance: ${before} -> ${after}`);
  }
  if (finalBodies < 41) {
    throw new Error(`${label} spawn check failed: ${state.bodies}`);
  }
  if (finalBodies < 69 || !state.stress?.startsWith('stress ')) {
    throw new Error(`${label} stress check failed: bodies=${state.bodies}, stress=${state.stress}`);
  }
  if (!/^\d+(\.\d+)? fps$/.test(state.fps ?? '')) {
    throw new Error(`${label} fps readout invalid: ${state.fps}`);
  }
  if (state.overflowX || state.overflowY) {
    throw new Error(`${label} viewport overflow detected`);
  }
  if (brightPixels < 500 || uniqueBuckets.size < 20) {
    throw new Error(
      `${label} canvas screenshot looked blank: bright=${brightPixels}, buckets=${uniqueBuckets.size}, sampled=${sampledPixels}`
    );
  }

  return { label, viewport, step: `${before} -> ${after}`, bodies: state.bodies, fps: state.fps, stress: state.stress, screenshotPath, brightPixels };
}

(async () => {
  const results = [
    await verifyViewport({ width: 1440, height: 900 }, 'wasm-box3d-desktop'),
    await verifyViewport({ width: 390, height: 844 }, 'wasm-box3d-mobile'),
  ];
  console.log(JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

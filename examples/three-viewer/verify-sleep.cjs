const { chromium } = require('playwright');

const STRESS_BLOCKS = Number(process.env.WB3_SLEEP_BLOCKS ?? 4096);
const SAMPLE_COUNT = Number(process.env.WB3_SLEEP_SAMPLES ?? 18);
const SAMPLE_INTERVAL_MS = Number(process.env.WB3_SLEEP_INTERVAL_MS ?? 1000);
const MAX_QUIET_AWAKE_RATIO = Number(process.env.WB3_SLEEP_MAX_AWAKE_RATIO ?? 0.05);
const QUIET_MOVING_RATIO = Number(process.env.WB3_SLEEP_QUIET_MOVING_RATIO ?? 0.01);
const QUIET_MAX_DELTA = Number(process.env.WB3_SLEEP_QUIET_MAX_DELTA ?? 0.002);
const QUIET_VISIBLE_MAX_DELTA = Number(process.env.WB3_SLEEP_QUIET_VISIBLE_MAX_DELTA ?? 0.04);
const QUIET_MEAN_DELTA = Number(process.env.WB3_SLEEP_QUIET_MEAN_DELTA ?? 0.001);
const MAX_QUIET_SLEEP_MS = Number(process.env.WB3_SLEEP_MAX_QUIET_MS ?? 5000);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('http://127.0.0.1:5300/', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () =>
      /^wasm (pthreads|single-thread) active$/.test(document.querySelector('#wasm-status')?.textContent ?? '') &&
      typeof window.__wasmBox3DTest?.resetStress === 'function',
    null,
    { timeout: 10000 }
  );

  await page.evaluate((count) => window.__wasmBox3DTest.resetStress(count), STRESS_BLOCKS);
  await page.waitForFunction(
    (count) => Number(document.querySelector('#body-count')?.textContent?.replace(/\D+/g, '') ?? 0) >= count,
    STRESS_BLOCKS,
    { timeout: 30000 }
  );

  const samples = [];
  await page.evaluate(() => window.__wasmBox3DTest.sampleMotion());

  for (let i = 0; i < SAMPLE_COUNT; ++i) {
    await page.waitForTimeout(SAMPLE_INTERVAL_MS);
    const sample = await page.evaluate(() => window.__wasmBox3DTest.sampleMotion());
    samples.push({
      t: (i + 1) * SAMPLE_INTERVAL_MS,
      ...sample,
      awakeRatio: sample.comparedBodies > 0 ? sample.awakeBodies / sample.comparedBodies : 0,
      movingRatio: sample.comparedBodies > 0 ? sample.movingBodies / sample.comparedBodies : 0,
    });
  }

  await browser.close();

  if (errors.length > 0) {
    throw new Error(`console errors:\n${errors.join('\n')}`);
  }

  const tail = samples.slice(-3);
  const quietTail = tail.filter(
    (sample) =>
      sample.movingRatio <= QUIET_MOVING_RATIO &&
      sample.meanPositionDelta <= QUIET_MEAN_DELTA &&
      sample.maxPositionDelta <= QUIET_VISIBLE_MAX_DELTA
  );
  const final = samples[samples.length - 1];
  const minAwakeRatio = Math.min(...samples.map((sample) => sample.awakeRatio));

  const result = {
    stressBlocks: STRESS_BLOCKS,
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    quietMaxDelta: QUIET_MAX_DELTA,
    quietVisibleMaxDelta: QUIET_VISIBLE_MAX_DELTA,
    quietMeanDelta: QUIET_MEAN_DELTA,
    quietMovingRatio: QUIET_MOVING_RATIO,
    maxQuietAwakeRatio: MAX_QUIET_AWAKE_RATIO,
    maxQuietSleepMs: MAX_QUIET_SLEEP_MS,
    minAwakeRatio,
    final,
    samples,
  };

  console.log(JSON.stringify(result, null, 2));

  if (quietTail.length === tail.length && final.awakeRatio > MAX_QUIET_AWAKE_RATIO) {
    throw new Error(
      `sleep regression: bodies are quiet but awake ratio stayed ${(final.awakeRatio * 100).toFixed(1)}%`
    );
  }

  if (final.awakeRatio > MAX_QUIET_AWAKE_RATIO && final.movingRatio <= QUIET_MOVING_RATIO) {
    throw new Error(
      `sleep regression: final sample is mostly still but ${final.awakeBodies}/${final.comparedBodies} bodies are awake`
    );
  }

  const firstQuietIndex = samples.findIndex(
    (sample) =>
      sample.movingRatio <= QUIET_MOVING_RATIO &&
      sample.meanPositionDelta <= QUIET_MEAN_DELTA &&
      sample.maxPositionDelta <= QUIET_VISIBLE_MAX_DELTA
  );
  if (firstQuietIndex !== -1) {
    const quietStartedAt = samples[firstQuietIndex].t;
    const deadline = quietStartedAt + MAX_QUIET_SLEEP_MS;
    const deadlineSample = samples.find((sample) => sample.t >= deadline) ?? final;
    if (deadlineSample.awakeRatio > MAX_QUIET_AWAKE_RATIO) {
      throw new Error(
        `sleep regression: quiet at ${quietStartedAt}ms but awake ratio was ${(deadlineSample.awakeRatio * 100).toFixed(
          1
        )}% at ${deadlineSample.t}ms`
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

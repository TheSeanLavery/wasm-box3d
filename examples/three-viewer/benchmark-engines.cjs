const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.join(ROOT, 'bench-results');
const SERVER_URL = process.env.WB3_BENCH_URL ?? 'http://127.0.0.1:5300/';
const ENGINES = (process.env.WB3_BENCH_ENGINES ?? 'box3d,rapier').split(',').map((engine) => engine.trim()).filter(Boolean);
const LEVELS = (process.env.WB3_BENCH_LEVELS ?? '64,256,1024,4096,8192,16384,32768')
  .split(',')
  .map((level) => Number(level.trim()))
  .filter((level) => Number.isFinite(level) && level > 0);
const WARMUP_MS = Number(process.env.WB3_BENCH_WARMUP_MS ?? 1000);
const SAMPLE_MS = Number(process.env.WB3_BENCH_SAMPLE_MS ?? 4000);
const SAMPLE_INTERVAL_MS = Number(process.env.WB3_BENCH_INTERVAL_MS ?? 250);
const MIN_FPS_FLOOR = Number(process.env.WB3_BENCH_MIN_FPS ?? 20);
const HEADLESS = process.env.WB3_BENCH_HEADLESS === '1';
const THREADS = process.env.WB3_BENCH_THREADS ?? 'auto';

function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  return clean.length > 0 ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function median(values) {
  return percentile(values, 50);
}

function makeUrl(engine) {
  const url = new URL(SERVER_URL);
  url.searchParams.set('engine', engine);
  url.searchParams.set('benchmark', '1');
  if (engine === 'box3d' && THREADS !== 'auto') {
    url.searchParams.set('threads', THREADS);
  }
  return url.toString();
}

async function waitForReady(page) {
  await page.waitForFunction(
    () =>
      /^(wasm (pthreads|single-thread)|rapier) active$/.test(document.querySelector('#wasm-status')?.textContent ?? '') &&
      typeof window.__wasmBox3DTest?.resetStress === 'function' &&
      window.__wasmBox3DProfile,
    null,
    { timeout: 15000 }
  );
}

async function runLevel(page, engine, level) {
  await page.evaluate((count) => window.__wasmBox3DTest.resetStress(count), level);
  await page.waitForFunction(
    (count) => Number(document.querySelector('#body-count')?.textContent?.replace(/\D+/g, '') ?? 0) >= count,
    level,
    { timeout: 60000 }
  );
  await page.waitForTimeout(WARMUP_MS);

  const startedAt = Date.now();
  const samples = [];
  while (Date.now() - startedAt < SAMPLE_MS) {
    await page.waitForTimeout(SAMPLE_INTERVAL_MS);
    const sample = await page.evaluate(() => ({ ...window.__wasmBox3DProfile, now: performance.now() }));
    samples.push({
      tMs: Date.now() - startedAt,
      engine,
      requestedBodies: level,
      bodies: sample.bodies,
      awakeBodies: sample.awakeBodies,
      renderFps: sample.renderFps,
      simFps: sample.physicsFps,
      physicsStepMs: sample.physicsStepMs,
      physicsCapacityFps: sample.physicsCapacityFps,
      simCapacityFps: sample.physicsCapacityFps,
      renderSyncMs: sample.renderSyncMs,
      syncMs: sample.syncMs,
      renderMs: sample.renderMs,
      snapshotCopyMs: sample.snapshotCopyMs,
      snapshotBytes: sample.snapshotBytes,
      threadsEnabled: sample.threadsEnabled,
      stressStatus: sample.stressStatus,
      stepCount: sample.stepCount,
    });
  }

  const summary = {
    engine,
    requestedBodies: level,
    bodies: samples.at(-1)?.bodies ?? 0,
    threadsEnabled: samples.some((sample) => sample.threadsEnabled),
    avgRenderFps: average(samples.map((sample) => sample.renderFps)),
    p50RenderFps: median(samples.map((sample) => sample.renderFps)),
    p95RenderMs: percentile(samples.map((sample) => sample.renderMs), 95),
    avgSimFps: average(samples.map((sample) => sample.simFps)),
    p50SimFps: median(samples.map((sample) => sample.simFps)),
    avgSimCapacityFps: average(samples.map((sample) => sample.simCapacityFps)),
    p50SimCapacityFps: median(samples.map((sample) => sample.simCapacityFps)),
    p95PhysicsStepMs: percentile(samples.map((sample) => sample.physicsStepMs), 95),
    avgSyncMs: average(samples.map((sample) => sample.syncMs)),
    avgRenderSyncMs: average(samples.map((sample) => sample.renderSyncMs)),
    avgSnapshotCopyMs: average(samples.map((sample) => sample.snapshotCopyMs)),
    minRenderFps: Math.min(...samples.map((sample) => sample.renderFps)),
    minSimFps: Math.min(...samples.map((sample) => sample.simFps)),
    minSimCapacityFps: Math.min(...samples.map((sample) => sample.simCapacityFps)),
  };

  return { summary, samples };
}

function writeCsv(samples, filePath) {
  const columns = [
    'engine',
    'requestedBodies',
    'tMs',
    'bodies',
    'awakeBodies',
    'renderFps',
    'simFps',
    'simCapacityFps',
    'physicsStepMs',
    'physicsCapacityFps',
    'renderSyncMs',
    'syncMs',
    'renderMs',
    'snapshotCopyMs',
    'snapshotBytes',
    'threadsEnabled',
    'stepCount',
  ];
  const rows = [columns.join(',')];
  for (const sample of samples) {
    rows.push(columns.map((column) => JSON.stringify(sample[column] ?? '')).join(','));
  }
  fs.writeFileSync(filePath, `${rows.join('\n')}\n`);
}

function makeSeriesPath(points, width, height, xMax, yMax, valueKey) {
  return points
    .map((point, index) => {
      const x = (point.tMs / xMax) * width;
      const y = height - (Math.max(0, point[valueKey]) / yMax) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function makeMetricChart({ level, levelSamples, metricKey, label, chartHeight = 210 }) {
  const colors = {
    box3d: '#58a6ff',
    rapier: '#f59e0b',
  };
  const chartWidth = 760;
  const xMax = Math.max(1, ...levelSamples.map((sample) => sample.tMs));
  const yMax = Math.max(1, ...levelSamples.map((sample) => sample[metricKey] ?? 0)) * 1.12;
  const paths = ENGINES.flatMap((engine) => {
    const points = levelSamples.filter((sample) => sample.engine === engine);
    if (points.length === 0) {
      return [];
    }
    const color = colors[engine] ?? '#94a3b8';
    return `<path d="${makeSeriesPath(points, chartWidth, chartHeight, xMax, yMax, metricKey)}" fill="none" stroke="${color}" stroke-width="2.5" />`;
  }).join('\n');

  return `
    <div class="chart">
      <h3>${label}</h3>
      <svg viewBox="0 0 ${chartWidth + 72} ${chartHeight + 54}" role="img" aria-label="${label} over time for ${level} bodies">
        <g transform="translate(52 18)">
          <rect width="${chartWidth}" height="${chartHeight}" rx="6" fill="#111827" />
          <line x1="0" y1="${chartHeight}" x2="${chartWidth}" y2="${chartHeight}" stroke="#334155" />
          <line x1="0" y1="0" x2="0" y2="${chartHeight}" stroke="#334155" />
          <text x="-8" y="8" text-anchor="end">${Math.round(yMax)} fps</text>
          <text x="-8" y="${chartHeight}" text-anchor="end">0</text>
          ${paths}
        </g>
      </svg>
    </div>
  `;
}

function makeChartHtml(result) {
  const levels = [...new Set(result.summary.map((row) => row.requestedBodies))];

  const panels = levels
    .map((level) => {
      const levelSamples = result.samples.filter((sample) => sample.requestedBodies === level);

      return `
        <section class="panel">
          <h2>${level.toLocaleString()} requested bodies</h2>
          ${makeMetricChart({ level, levelSamples, metricKey: 'renderFps', label: 'Render FPS' })}
          ${makeMetricChart({ level, levelSamples, metricKey: 'simCapacityFps', label: 'Simulation capacity FPS' })}
        </section>
      `;
    })
    .join('\n');

  const rows = result.summary
    .map(
      (row) => `
        <tr>
          <td>${row.engine}${row.threadsEnabled ? ' pthreads' : ''}</td>
          <td>${row.requestedBodies.toLocaleString()}</td>
          <td>${Math.round(row.bodies).toLocaleString()}</td>
          <td>${row.avgRenderFps.toFixed(1)}</td>
          <td>${row.p50RenderFps.toFixed(1)}</td>
          <td>${row.avgSimCapacityFps.toFixed(1)}</td>
          <td>${row.p50SimCapacityFps.toFixed(1)}</td>
          <td>${row.avgSimFps.toFixed(1)}</td>
          <td>${row.p95PhysicsStepMs.toFixed(2)}</td>
          <td>${row.avgSyncMs.toFixed(2)}</td>
        </tr>
      `
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WasmBox3D Engine Benchmark</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #0f172a; color: #e5edf6; }
      body { margin: 0; padding: 28px; }
      main { max-width: 1100px; margin: 0 auto; }
      h1 { margin: 0 0 6px; font-size: 28px; }
      h2 { margin: 0 0 14px; font-size: 18px; }
      h3 { margin: 0 0 8px; font-size: 13px; color: #c9d7e8; }
      p { margin: 0 0 22px; color: #a8b3c2; }
      table { width: 100%; border-collapse: collapse; margin: 22px 0 28px; font-size: 13px; }
      th, td { padding: 10px 12px; border-bottom: 1px solid #263244; text-align: right; }
      th:first-child, td:first-child { text-align: left; }
      th { color: #bfcede; font-weight: 700; }
      .legend { display: flex; gap: 18px; flex-wrap: wrap; margin: 12px 0 20px; color: #cbd5e1; font-size: 13px; }
      .key { display: inline-flex; align-items: center; gap: 7px; }
      .swatch { width: 22px; height: 3px; border-radius: 999px; background: var(--color); }
      .dash { border-top: 3px dashed var(--color); background: transparent; height: 0; }
      .panel { margin: 0 0 22px; padding: 18px; border: 1px solid #243041; border-radius: 8px; background: #151f31; }
      .chart + .chart { margin-top: 16px; }
      svg { width: 100%; height: auto; display: block; }
      text { fill: #8ea0b8; font-size: 12px; }
    </style>
  </head>
  <body>
    <main>
      <h1>WasmBox3D Engine Benchmark</h1>
      <p>Generated ${new Date(result.generatedAt).toLocaleString()} from headed Playwright against ${SERVER_URL}. Benchmark mode uses a dense stacked stress layout and disables the Box3D worker's forced-sleep shortcut.</p>
      <div class="legend">
        <span class="key"><span class="swatch" style="--color:#58a6ff"></span>Box3D render</span>
        <span class="key"><span class="swatch" style="--color:#f59e0b"></span>Rapier render</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Engine</th><th>Requested</th><th>Bodies</th><th>Avg Render FPS</th><th>P50 Render FPS</th><th>Avg Sim Capacity FPS</th><th>P50 Sim Capacity FPS</th><th>Scheduled Sim Hz</th><th>P95 Step ms</th><th>Avg Sync ms</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${panels}
    </main>
  </body>
</html>`;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !/Failed to load resource: the server responded with a status of 404/.test(text)) {
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  const samples = [];
  const summary = [];

  for (const engine of ENGINES) {
    await page.goto(makeUrl(engine), { waitUntil: 'networkidle' });
    await waitForReady(page);
    for (const level of LEVELS) {
      const result = await runLevel(page, engine, level);
      samples.push(...result.samples);
      summary.push(result.summary);
      console.log(
        `${engine} ${level} bodies: render ${result.summary.avgRenderFps.toFixed(1)} fps, sim ${result.summary.avgSimFps.toFixed(1)} fps`
      );
      if (result.summary.minRenderFps < MIN_FPS_FLOOR || result.summary.minSimCapacityFps < MIN_FPS_FLOOR) {
        console.log(`${engine} stopped after ${level}; minimum FPS floor ${MIN_FPS_FLOOR} reached`);
        break;
      }
    }
  }

  await browser.close();

  if (consoleErrors.length > 0) {
    throw new Error(`console errors:\n${consoleErrors.join('\n')}`);
  }

  const result = {
    generatedAt: new Date().toISOString(),
    serverUrl: SERVER_URL,
    headed: !HEADLESS,
    engines: ENGINES,
    levels: LEVELS,
    warmupMs: WARMUP_MS,
    sampleMs: SAMPLE_MS,
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    minFpsFloor: MIN_FPS_FLOOR,
    summary,
    samples,
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'latest.json'), `${JSON.stringify(result, null, 2)}\n`);
  writeCsv(samples, path.join(OUTPUT_DIR, 'latest.csv'));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'latest.html'), makeChartHtml(result));
  console.log(JSON.stringify({ outputDir: OUTPUT_DIR, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

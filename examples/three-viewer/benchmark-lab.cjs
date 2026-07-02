const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.join(ROOT, 'bench-results');
const SERVER_URL = process.env.WB3_BENCH_URL ?? 'http://127.0.0.1:5300/';
const ENGINES = (process.env.WB3_LAB_ENGINES ?? 'box3d,rapier').split(',').map((engine) => engine.trim()).filter(Boolean);
const HEADLESS = process.env.WB3_LAB_HEADLESS === '1';
const THREADS = process.env.WB3_LAB_THREADS ?? 'auto';
const RUN_TIMEOUT_MS = Number(process.env.WB3_LAB_TIMEOUT_MS ?? 180000);
const DEFAULT_VARIANTS = [
  {
    scenario: 'pileDrop',
    name: '256 block pile drops',
    durationMs: 12000,
    intervalMs: 1400,
    count: 2048,
    batchSize: 256,
    rows: 1,
    spacing: 8,
  },
  {
    scenario: 'lineSpawn',
    name: 'line spawn 20 per burst',
    durationMs: 10000,
    intervalMs: 180,
    count: 3000,
    batchSize: 20,
    rows: 1,
    spacing: 0.82,
  },
  {
    scenario: 'dominoSpiral',
    name: 'single spiral dominoes',
    durationMs: 12000,
    intervalMs: 750,
    count: 720,
    batchSize: 720,
    rows: 1,
    spacing: 0.42,
  },
  {
    scenario: 'multiSpiral',
    name: 'four spiral rows',
    durationMs: 14000,
    intervalMs: 900,
    count: 1440,
    batchSize: 360,
    rows: 4,
    spacing: 0.48,
  },
];
const VARIANTS = process.env.WB3_LAB_VARIANTS ? JSON.parse(process.env.WB3_LAB_VARIANTS) : DEFAULT_VARIANTS;

function makeUrl(engine) {
  const url = new URL(SERVER_URL);
  url.searchParams.set('engine', engine);
  url.searchParams.set('benchmark', '1');
  url.searchParams.set('snapshotMs', '250');
  if (engine === 'box3d' && THREADS !== 'auto') {
    url.searchParams.set('threads', THREADS);
  }
  return url.toString();
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  return clean.length > 0 ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(result) {
  const samples = result.samples ?? [];
  return {
    engine: result.engine,
    scenario: result.config?.scenario ?? '',
    name: result.config?.name ?? '',
    requestedBodies: result.config?.count ?? 0,
    spawned: result.spawned ?? 0,
    bodyCount: result.bodyCount ?? 0,
    durationMs: result.durationMs ?? 0,
    avgRenderFps: average(samples.map((sample) => sample.renderFps)),
    p50RenderFps: percentile(samples.map((sample) => sample.renderFps), 50),
    avgSimCapacityFps: average(samples.map((sample) => sample.simCapacityFps)),
    p50SimCapacityFps: percentile(samples.map((sample) => sample.simCapacityFps), 50),
    p95PhysicsStepMs: percentile(samples.map((sample) => sample.physicsStepMs), 95),
    avgSyncMs: average(samples.map((sample) => sample.syncMs)),
    sampleCount: samples.length,
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char]);
}

function format(value, suffix = '') {
  return Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : '';
}

function makePath(samples, key, width, height, xMax, yMax) {
  return samples
    .map((sample, index) => {
      const x = (sample.elapsedMs / xMax) * width;
      const y = height - (Math.min(sample[key] ?? 0, yMax) / yMax) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function makeChart(run) {
  const samples = run.samples ?? [];
  if (samples.length < 2) {
    return '<div class="chart empty">not enough samples</div>';
  }
  const width = 760;
  const height = 180;
  const xMax = Math.max(1, ...samples.map((sample) => sample.elapsedMs));
  const yMax = Math.max(60, ...samples.flatMap((sample) => [sample.renderFps ?? 0, sample.simCapacityFps ?? 0]));
  return `
    <div class="chart">
      <h3>${escapeHtml(run.engine)} - ${escapeHtml(run.config.name)}</h3>
      <svg viewBox="0 0 ${width + 64} ${height + 48}">
        <g transform="translate(46 16)">
          <rect width="${width}" height="${height}" rx="6"></rect>
          <line class="axis" x1="0" y1="${height}" x2="${width}" y2="${height}"></line>
          <line class="axis" x1="0" y1="0" x2="0" y2="${height}"></line>
          <path class="render" d="${makePath(samples, 'renderFps', width, height, xMax, yMax)}"></path>
          <path class="sim" d="${makePath(samples, 'simCapacityFps', width, height, xMax, yMax)}"></path>
          <text x="0" y="${height + 26}">0s</text>
          <text x="${width}" y="${height + 26}" text-anchor="end">${(xMax / 1000).toFixed(1)}s</text>
          <text x="-10" y="4" text-anchor="end">${format(yMax, ' fps')}</text>
        </g>
      </svg>
    </div>
  `;
}

function writeHtml(report, outputPath) {
  const rows = report.summary
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.scenario)}</td>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.engine)}</td>
          <td>${row.requestedBodies.toLocaleString()}</td>
          <td>${row.spawned.toLocaleString()}</td>
          <td>${format(row.avgSimCapacityFps)}</td>
          <td>${format(row.p50SimCapacityFps)}</td>
          <td>${format(row.p95PhysicsStepMs, ' ms')}</td>
          <td>${format(row.avgSyncMs, ' ms')}</td>
          <td>${format(row.avgRenderFps)}</td>
          <td>${format(row.p50RenderFps)}</td>
          <td>${row.sampleCount}</td>
        </tr>
      `
    )
    .join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WasmBox3D Benchmark Lab</title>
  <style>
    body { margin: 0; padding: 24px; color: #e5edf6; background: #0f1419; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    .meta { color: #9aa7b5; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; background: #151c24; }
    th, td { padding: 9px 10px; border-bottom: 1px solid #273241; text-align: right; font-size: 13px; }
    th:first-child, td:first-child, th:nth-child(2), td:nth-child(2), th:nth-child(3), td:nth-child(3) { text-align: left; }
    th { color: #aab5c2; background: #1d2630; position: sticky; top: 0; }
    .chart { margin: 0 0 18px; padding: 14px; border: 1px solid #273241; border-radius: 8px; background: #151c24; }
    .chart h3 { margin: 0 0 10px; font-size: 15px; }
    svg { width: 100%; height: auto; overflow: visible; }
    rect { fill: #101720; }
    .axis { stroke: #405064; stroke-width: 1; }
    .render { fill: none; stroke: #58a6ff; stroke-width: 2.4; }
    .sim { fill: none; stroke: #f2b84b; stroke-width: 2.4; }
    text { fill: #9aa7b5; font-size: 11px; }
  </style>
</head>
<body>
  <h1>Benchmark Lab</h1>
  <div class="meta">Generated ${escapeHtml(report.generatedAt)} from ${escapeHtml(SERVER_URL)}</div>
  <table>
    <thead>
      <tr>
        <th>Scenario</th>
        <th>Name</th>
        <th>Engine</th>
        <th>Bodies</th>
        <th>Spawned</th>
        <th>Avg sim cap</th>
        <th>P50 sim cap</th>
        <th>P95 step</th>
        <th>Avg sync</th>
        <th>Avg render FPS</th>
        <th>P50 render FPS</th>
        <th>Samples</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  ${report.runs.map(makeChart).join('\n')}
</body>
</html>`;
  fs.writeFileSync(outputPath, html);
}

async function waitForReady(page) {
  await page.waitForFunction(
    () =>
      /^(wasm (pthreads|single-thread)|rapier) active$/.test(document.querySelector('#wasm-status')?.textContent ?? '') &&
      typeof window.__wasmBox3DLab?.run === 'function',
    null,
    { timeout: 30000 }
  );
}

async function run() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: HEADLESS });
  const runs = [];
  try {
    for (const engine of ENGINES) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.on('console', (message) => console.log(`[${engine}] ${message.type()}: ${message.text()}`));
      page.on('pageerror', (error) => console.error(`[${engine}] ${error.message}`));
      await page.goto(makeUrl(engine));
      await waitForReady(page);
      for (const variant of VARIANTS) {
        console.log(`Running ${engine} ${variant.scenario} ${variant.name}`);
        const result = await Promise.race([
          page.evaluate((config) => window.__wasmBox3DLab.run(config), variant),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`${engine} ${variant.name} timed out`)), RUN_TIMEOUT_MS)),
        ]);
        runs.push(result);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    serverUrl: SERVER_URL,
    engines: ENGINES,
    variants: VARIANTS,
    summary: runs.map(summarize),
    runs,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'lab-latest.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeHtml(report, path.join(OUTPUT_DIR, 'lab-latest.html'));
  console.log(`Wrote ${path.join(OUTPUT_DIR, 'lab-latest.html')}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

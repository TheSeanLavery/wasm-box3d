const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.join(ROOT, 'bench-results');
const SERVER_URL = process.env.WB3_BENCH_URL ?? 'http://127.0.0.1:5300/';
const ENGINES = (process.env.WB3_BENCH_ENGINES ?? 'box3d,rapier').split(',').map((engine) => engine.trim()).filter(Boolean);
const LEVELS = (process.env.WB3_BENCH_LEVELS ?? '64,1024,4096,16384,65536,262144,1000000')
  .split(',')
  .map((level) => Number(level.trim()))
  .filter((level) => Number.isFinite(level) && level > 0);
const WARMUP_MS = Number(process.env.WB3_BENCH_WARMUP_MS ?? 1000);
const SAMPLE_MS = Number(process.env.WB3_BENCH_SAMPLE_MS ?? 3000);
const SAMPLE_INTERVAL_MS = Number(process.env.WB3_BENCH_INTERVAL_MS ?? 250);
const MIN_FPS_FLOOR = Number(process.env.WB3_BENCH_MIN_FPS ?? 20);
const RESET_TIMEOUT_MS = Number(process.env.WB3_BENCH_RESET_TIMEOUT_MS ?? 180000);
const LEVEL_TIMEOUT_MS = Number(process.env.WB3_BENCH_LEVEL_TIMEOUT_MS ?? Math.max(RESET_TIMEOUT_MS + WARMUP_MS + SAMPLE_MS + 30000, 240000));
const STOP_ON_FLOOR = process.env.WB3_BENCH_STOP_ON_FLOOR === '1';
const SNAPSHOT_INTERVAL_MS = Number(process.env.WB3_BENCH_SNAPSHOT_MS ?? 250);
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

function positive(values) {
  return values.filter((value) => Number.isFinite(value) && value > 0);
}

function median(values) {
  return percentile(values, 50);
}

function makeUrl(engine) {
  const url = new URL(SERVER_URL);
  url.searchParams.set('engine', engine);
  url.searchParams.set('benchmark', '1');
  url.searchParams.set('snapshotMs', String(SNAPSHOT_INTERVAL_MS));
  if (engine === 'box3d' && THREADS !== 'auto') {
    url.searchParams.set('threads', THREADS);
  }
  return url.toString();
}

function estimateSnapshotBytes(bodyCount) {
  return bodyCount * 14 * Float32Array.BYTES_PER_ELEMENT;
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
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
  const resetStartedAt = Date.now();
  await page.evaluate((count) => window.__wasmBox3DTest.resetStress(count), level);
  await page.waitForFunction(
    (count) => Number(document.querySelector('#body-count')?.textContent?.replace(/\D+/g, '') ?? 0) >= count,
    level,
    { timeout: RESET_TIMEOUT_MS }
  );
  const resetWallMs = Date.now() - resetStartedAt;
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
      snapshotMB: sample.snapshotBytes / (1024 * 1024),
      threadsEnabled: sample.threadsEnabled,
      stressStatus: sample.stressStatus,
      stepCount: sample.stepCount,
      resetWallMs,
    });
  }

  const renderFpsValues = positive(samples.map((sample) => sample.renderFps));
  const simFpsValues = positive(samples.map((sample) => sample.simFps));
  const simCapacityValues = positive(samples.map((sample) => sample.simCapacityFps));
  const floorHit =
    Math.min(...renderFpsValues) < MIN_FPS_FLOOR || simCapacityValues.length === 0 || Math.min(...simCapacityValues) < MIN_FPS_FLOOR;
  const summary = {
    ok: true,
    error: '',
    engine,
    requestedBodies: level,
    bodies: samples.at(-1)?.bodies ?? 0,
    threadsEnabled: samples.some((sample) => sample.threadsEnabled),
    estimatedSnapshotMB: estimateSnapshotBytes(level + 5) / (1024 * 1024),
    observedSnapshotMB: (samples.at(-1)?.snapshotBytes ?? 0) / (1024 * 1024),
    resetWallMs,
    sampleCount: samples.length,
    floorHit,
    avgRenderFps: average(renderFpsValues),
    p50RenderFps: median(renderFpsValues),
    p95RenderMs: percentile(samples.map((sample) => sample.renderMs), 95),
    avgSimFps: average(simFpsValues),
    p50SimFps: median(simFpsValues),
    avgSimCapacityFps: average(simCapacityValues),
    p50SimCapacityFps: median(simCapacityValues),
    p95PhysicsStepMs: percentile(samples.map((sample) => sample.physicsStepMs), 95),
    avgSyncMs: average(samples.map((sample) => sample.syncMs)),
    avgRenderSyncMs: average(samples.map((sample) => sample.renderSyncMs)),
    avgSnapshotCopyMs: average(samples.map((sample) => sample.snapshotCopyMs)),
    minRenderFps: renderFpsValues.length > 0 ? Math.min(...renderFpsValues) : 0,
    minSimFps: simFpsValues.length > 0 ? Math.min(...simFpsValues) : 0,
    minSimCapacityFps: simCapacityValues.length > 0 ? Math.min(...simCapacityValues) : 0,
  };

  return { summary, samples };
}

function makeFailureSummary(engine, level, error) {
  return {
    ok: false,
    error: error?.message ?? String(error),
    engine,
    requestedBodies: level,
    bodies: 0,
    threadsEnabled: false,
    estimatedSnapshotMB: estimateSnapshotBytes(level + 5) / (1024 * 1024),
    observedSnapshotMB: 0,
    resetWallMs: 0,
    sampleCount: 0,
    floorHit: false,
    avgRenderFps: 0,
    p50RenderFps: 0,
    p95RenderMs: 0,
    avgSimFps: 0,
    p50SimFps: 0,
    avgSimCapacityFps: 0,
    p50SimCapacityFps: 0,
    p95PhysicsStepMs: 0,
    avgSyncMs: 0,
    avgRenderSyncMs: 0,
    avgSnapshotCopyMs: 0,
    minRenderFps: 0,
    minSimFps: 0,
    minSimCapacityFps: 0,
  };
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
    'snapshotMB',
    'threadsEnabled',
    'resetWallMs',
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char]);
}

function engineLabel(engine) {
  return engine === 'box3d' ? 'Box3D' : engine === 'rapier' ? 'Rapier' : engine;
}

function engineRank(engine) {
  return engine === 'box3d' ? 0 : engine === 'rapier' ? 1 : 2;
}

function formatMetric(value, suffix = '') {
  return Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : '';
}

function sortSummaryRows(summary) {
  return [...summary].sort((a, b) => a.requestedBodies - b.requestedBodies || engineRank(a.engine) - engineRank(b.engine));
}

function makeSamplePoints(points, width, height, xMax, yMax, valueKey, color, label) {
  return points
    .map((point) => {
      const x = (point.tMs / xMax) * width;
      const y = height - (Math.max(0, point[valueKey]) / yMax) * height;
      const title = `${label} ${point.requestedBodies.toLocaleString()} bodies\n${Math.round(point.tMs)}ms\n${valueKey}: ${formatMetric(point[valueKey], ' fps')}\nrender: ${formatMetric(point.renderFps, ' fps')}\nsim capacity: ${formatMetric(point.simCapacityFps, ' fps')}\nsync: ${formatMetric(point.syncMs, ' ms')}\nsnapshot: ${formatMetric(point.snapshotMB, ' MB')}`;
      return `<circle class="sample-point" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${color}" tabindex="0"><title>${escapeHtml(title)}</title></circle>`;
    })
    .join('\n');
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
    const sortedPoints = [...points].sort((a, b) => a.tMs - b.tMs);
    const last = sortedPoints.at(-1);
    const lastX = last ? (last.tMs / xMax) * chartWidth : 0;
    const lastY = last ? chartHeight - (Math.max(0, last[metricKey]) / yMax) * chartHeight : 0;
    return `
      <path d="${makeSeriesPath(sortedPoints, chartWidth, chartHeight, xMax, yMax, metricKey)}" fill="none" stroke="${color}" stroke-width="2.5">
        <title>${escapeHtml(`${engineLabel(engine)} ${label}`)}</title>
      </path>
      ${makeSamplePoints(sortedPoints, chartWidth, chartHeight, xMax, yMax, metricKey, color, engineLabel(engine))}
      ${last ? `<text class="line-label" x="${Math.min(chartWidth - 78, lastX + 8).toFixed(1)}" y="${Math.max(12, Math.min(chartHeight - 6, lastY - 6)).toFixed(1)}" fill="${color}">${engineLabel(engine)}</text>` : ''}
    `;
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
          <text class="axis-label" x="${chartWidth / 2}" y="${chartHeight + 34}" text-anchor="middle">time in sample window</text>
          <text class="axis-label" x="-${chartHeight / 2}" y="-38" transform="rotate(-90)" text-anchor="middle">${label}</text>
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

  const rows = sortSummaryRows(result.summary)
    .map((row) => {
      const levelIndex = levels.indexOf(row.requestedBodies);
      return `
        <tr class="engine-row ${row.engine} ${levelIndex % 2 === 0 ? 'pair-even' : 'pair-odd'}">
          <td><span class="engine-chip ${row.engine}">${engineLabel(row.engine)}</span></td>
          <td>${row.ok ? (row.floorHit ? 'floor' : 'ok') : 'failed'}</td>
          <td class="issue-cell">${escapeHtml(row.error)}</td>
          <td>${row.requestedBodies.toLocaleString()}</td>
          <td>${Math.round(row.bodies).toLocaleString()}</td>
          <td>${row.estimatedSnapshotMB.toFixed(1)}</td>
          <td>${row.observedSnapshotMB.toFixed(1)}</td>
          <td>${Math.round(row.resetWallMs).toLocaleString()}</td>
          <td>${row.avgRenderFps.toFixed(1)}</td>
          <td>${row.p50RenderFps.toFixed(1)}</td>
          <td>${row.avgSimCapacityFps.toFixed(1)}</td>
          <td>${row.p50SimCapacityFps.toFixed(1)}</td>
          <td>${row.avgSimFps.toFixed(1)}</td>
          <td>${row.p95PhysicsStepMs.toFixed(2)}</td>
          <td>${row.avgSyncMs.toFixed(2)}</td>
        </tr>
      `;
    })
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
      tbody tr.pair-even.box3d { background: rgba(88, 166, 255, 0.12); }
      tbody tr.pair-even.rapier { background: rgba(245, 158, 11, 0.12); }
      tbody tr.pair-odd.box3d { background: rgba(88, 166, 255, 0.06); }
      tbody tr.pair-odd.rapier { background: rgba(245, 158, 11, 0.06); }
      tbody tr.rapier td { border-bottom-color: #3a4658; }
      .engine-chip { display: inline-flex; align-items: center; min-width: 58px; font-weight: 800; }
      .engine-chip.box3d { color: #8ec5ff; }
      .engine-chip.rapier { color: #f9c46f; }
      .issue-cell { max-width: 290px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #f3b0a8; text-align: left; }
      .legend { display: flex; gap: 18px; flex-wrap: wrap; margin: 12px 0 20px; color: #cbd5e1; font-size: 13px; }
      .key { display: inline-flex; align-items: center; gap: 7px; }
      .swatch { width: 22px; height: 3px; border-radius: 999px; background: var(--color); }
      .dash { border-top: 3px dashed var(--color); background: transparent; height: 0; }
      .panel { margin: 0 0 22px; padding: 18px; border: 1px solid #243041; border-radius: 8px; background: #151f31; }
      .chart + .chart { margin-top: 16px; }
      svg { width: 100%; height: auto; display: block; }
      text { fill: #8ea0b8; font-size: 12px; }
      .axis-label { fill: #728199; font-size: 11px; }
      .line-label { font-size: 12px; font-weight: 800; paint-order: stroke; stroke: #111827; stroke-width: 4px; stroke-linejoin: round; }
      .sample-point { cursor: crosshair; stroke: #0f172a; stroke-width: 1.5px; opacity: 0.86; }
      .sample-point:hover, .sample-point:focus { opacity: 1; stroke: #f8fafc; stroke-width: 2.5px; outline: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>WasmBox3D Engine Benchmark</h1>
      <p>Generated ${new Date(result.generatedAt).toLocaleString()} from headed Playwright against ${SERVER_URL}. Benchmark mode uses a dense stacked stress layout, disables the Box3D worker's forced-sleep shortcut, and throttles large body snapshots to ${SNAPSHOT_INTERVAL_MS}ms.</p>
      <div class="legend">
        <span class="key"><span class="swatch" style="--color:#58a6ff"></span>Box3D render</span>
        <span class="key"><span class="swatch" style="--color:#f59e0b"></span>Rapier render</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Engine</th><th>Status</th><th>Issue</th><th>Requested</th><th>Bodies</th><th>Est Snapshot MB</th><th>Seen Snapshot MB</th><th>Reset ms</th><th>Avg Render FPS</th><th>P50 Render FPS</th><th>Avg Sim Capacity FPS</th><th>P50 Sim Capacity FPS</th><th>Scheduled Sim Hz</th><th>P95 Step ms</th><th>Avg Sync ms</th>
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
  if (process.env.WB3_BENCH_RENDER_ONLY === '1') {
    const latestPath = path.join(OUTPUT_DIR, 'latest.json');
    const result = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'latest.html'), makeChartHtml(result));
    writeCsv(result.samples ?? [], path.join(OUTPUT_DIR, 'latest.csv'));
    console.log(JSON.stringify({ outputDir: OUTPUT_DIR, renderedOnly: true, summaryRows: result.summary?.length ?? 0 }, null, 2));
    return;
  }

  const browser = await chromium.launch({ headless: HEADLESS });
  const consoleErrors = [];
  const attachPageChecks = (checkedPage) => {
    checkedPage.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && !/Failed to load resource: the server responded with a status of 404/.test(text)) {
        consoleErrors.push(text);
      }
    });
    checkedPage.on('pageerror', (error) => consoleErrors.push(error.message));
  };
  let page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  attachPageChecks(page);

  const samples = [];
  const summary = [];

  for (const engine of ENGINES) {
    await page.goto(makeUrl(engine), { waitUntil: 'networkidle' });
    await waitForReady(page);
    for (const level of LEVELS) {
      try {
        const consoleErrorStart = consoleErrors.length;
        const result = await withTimeout(runLevel(page, engine, level), LEVEL_TIMEOUT_MS, `${engine} ${level}`);
        const levelConsoleErrors = consoleErrors.slice(consoleErrorStart);
        if (levelConsoleErrors.length > 0) {
          result.summary.ok = false;
          result.summary.error = levelConsoleErrors.slice(0, 4).join(' | ');
        }
        samples.push(...result.samples);
        summary.push(result.summary);
        console.log(
          `${engine} ${level} bodies: render ${result.summary.avgRenderFps.toFixed(1)} fps, sim capacity ${result.summary.avgSimCapacityFps.toFixed(1)} fps, reset ${Math.round(result.summary.resetWallMs)}ms`
        );
        if (result.summary.floorHit) {
          console.log(`${engine} ${level} hit minimum FPS floor ${MIN_FPS_FLOOR}`);
          if (STOP_ON_FLOOR) {
            break;
          }
        }
      } catch (error) {
        console.error(`${engine} ${level} failed: ${error.message}`);
        summary.push(makeFailureSummary(engine, level, error));
        await page.close({ runBeforeUnload: false }).catch(() => {});
        page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
        attachPageChecks(page);
        await page.goto(makeUrl(engine), { waitUntil: 'networkidle' });
        await waitForReady(page);
        if (STOP_ON_FLOOR) {
          break;
        }
      }
      if (level >= 1000000) {
        break;
      }
    }
  }

  await browser.close();

  const result = {
    generatedAt: new Date().toISOString(),
    serverUrl: SERVER_URL,
    headed: !HEADLESS,
    engines: ENGINES,
    levels: LEVELS,
    warmupMs: WARMUP_MS,
    sampleMs: SAMPLE_MS,
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    snapshotIntervalMs: SNAPSHOT_INTERVAL_MS,
    resetTimeoutMs: RESET_TIMEOUT_MS,
    levelTimeoutMs: LEVEL_TIMEOUT_MS,
    minFpsFloor: MIN_FPS_FLOOR,
    stopOnFloor: STOP_ON_FLOOR,
    consoleErrors,
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

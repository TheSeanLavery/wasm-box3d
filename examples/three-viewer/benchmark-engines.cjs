const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.join(ROOT, 'bench-results');
const SERVER_URL = process.env.WB3_BENCH_URL ?? 'http://127.0.0.1:5300/';
const ENGINES = (process.env.WB3_BENCH_ENGINES ?? 'box3d,rapier').split(',').map((engine) => engine.trim()).filter(Boolean);
const DEFAULT_LEVELS = [
  100,
  500,
  1000,
  ...Array.from({ length: 24 }, (_, index) => (index + 1) * 5000),
];
const LEVELS = (process.env.WB3_BENCH_LEVELS
  ? process.env.WB3_BENCH_LEVELS.split(',').map((level) => Number(level.trim()))
  : DEFAULT_LEVELS
).filter((level) => Number.isFinite(level) && level > 0);
const WARMUP_MS = Number(process.env.WB3_BENCH_WARMUP_MS ?? 1000);
const SAMPLE_MS = Number(process.env.WB3_BENCH_SAMPLE_MS ?? 3000);
const SAMPLE_INTERVAL_MS = Number(process.env.WB3_BENCH_INTERVAL_MS ?? 250);
const MIN_FPS_FLOOR = Number(process.env.WB3_BENCH_MIN_FPS ?? 20);
const RESET_TIMEOUT_MS = Number(process.env.WB3_BENCH_RESET_TIMEOUT_MS ?? 180000);
const FIRST_STEP_TIMEOUT_MS = Number(process.env.WB3_BENCH_FIRST_STEP_TIMEOUT_MS ?? 600000);
const LEVEL_TIMEOUT_MS = Number(
  process.env.WB3_BENCH_LEVEL_TIMEOUT_MS ??
    Math.max(RESET_TIMEOUT_MS + FIRST_STEP_TIMEOUT_MS + WARMUP_MS + SAMPLE_MS + 30000, 240000)
);
const STOP_ON_FLOOR = process.env.WB3_BENCH_STOP_ON_FLOOR === '1';
const SNAPSHOT_INTERVAL_MS = Number(process.env.WB3_BENCH_SNAPSHOT_MS ?? 250);
const HEADLESS = process.env.WB3_BENCH_HEADLESS === '1';
const THREADS = process.env.WB3_BENCH_THREADS ?? 'auto';
const REQUIRE_FIRST_STEP = process.env.WB3_BENCH_REQUIRE_FIRST_STEP !== '0';

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
  const resetProfile = await page.evaluate(() => ({ ...window.__wasmBox3DProfile }));
  const firstStepStartedAt = Date.now();
  if (REQUIRE_FIRST_STEP && (resetProfile.stepCount ?? 0) <= 0) {
    await page.waitForFunction(() => (window.__wasmBox3DProfile?.stepCount ?? 0) > 0, null, { timeout: FIRST_STEP_TIMEOUT_MS });
  }
  const firstStepWallMs = Date.now() - firstStepStartedAt;
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
      firstStepWallMs,
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
    firstStepWallMs,
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
    firstStepWallMs: 0,
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
    'firstStepWallMs',
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

function formatAxisValue(value, suffix = '') {
  if (!Number.isFinite(value)) {
    return '';
  }
  if (value === 0) {
    return `0${suffix}`;
  }
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(Math.abs(value) >= 10000 ? 0 : 1)}k${suffix}`;
  }
  if (Math.abs(value) >= 100) {
    return `${Math.round(value)}${suffix}`;
  }
  if (Math.abs(value) >= 10) {
    return `${value.toFixed(0)}${suffix}`;
  }
  return `${value.toFixed(1)}${suffix}`;
}

function niceCeil(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * power;
}

function makeTicks(maxValue, tickCount = 5) {
  const niceMax = niceCeil(maxValue);
  return Array.from({ length: tickCount }, (_, index) => (niceMax * index) / (tickCount - 1));
}

function makeGridLines({ width, height, xTicks = [], yTicks = [], xMax, yMax, ySuffix = '', xFormatter, yFormatter }) {
  const horizontal = yTicks
    .map((tick) => {
      const y = height - (tick / yMax) * height;
      return `
        <line class="grid-line" x1="0" y1="${y.toFixed(1)}" x2="${width}" y2="${y.toFixed(1)}" />
        <text class="tick-label" x="-10" y="${(y + 4).toFixed(1)}" text-anchor="end">${escapeHtml((yFormatter ?? formatAxisValue)(tick, ySuffix))}</text>
      `;
    })
    .join('\n');
  const vertical = xTicks
    .map((tick) => {
      const x = (tick / xMax) * width;
      return `
        <line class="grid-line vertical" x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${height}" />
        <text class="tick-label" x="${x.toFixed(1)}" y="${height + 20}" text-anchor="middle">${escapeHtml((xFormatter ?? formatAxisValue)(tick))}</text>
      `;
    })
    .join('\n');
  return `${horizontal}\n${vertical}`;
}

function sortSummaryRows(summary) {
  return [...summary].sort((a, b) => a.requestedBodies - b.requestedBodies || engineRank(a.engine) - engineRank(b.engine));
}

function compareMetric(box3d, rapier, key, { higherIsBetter = true, suffix = '', decimals = 1 } = {}) {
  const boxValue = box3d?.[key];
  const rapierValue = rapier?.[key];
  if (!Number.isFinite(boxValue) || !Number.isFinite(rapierValue)) {
    return '';
  }

  const maxValue = Math.max(Math.abs(boxValue), Math.abs(rapierValue), 1);
  if (Math.abs(boxValue - rapierValue) <= maxValue * 0.01) {
    return `<span class="compare-chip tie"><span>Tie</span><small>${formatMetric(boxValue, suffix)}</small></span>`;
  }

  const boxWins = higherIsBetter ? boxValue > rapierValue : boxValue < rapierValue;
  const winner = boxWins ? 'Box3D' : 'Rapier';
  const winnerValue = boxWins ? boxValue : rapierValue;
  const loserValue = boxWins ? rapierValue : boxValue;
  const ratio = loserValue === 0 ? Infinity : Math.abs(winnerValue / loserValue);
  const betterRatio = higherIsBetter ? ratio : Math.abs(loserValue / winnerValue);
  const ratioText = Number.isFinite(betterRatio) ? `${betterRatio.toFixed(betterRatio >= 10 ? 0 : decimals)}x` : '∞x';
  const title = `Box3D: ${formatMetric(boxValue, suffix)} | Rapier: ${formatMetric(rapierValue, suffix)}`;

  return `<span class="compare-chip ${boxWins ? 'box3d' : 'rapier'}" title="${escapeHtml(title)}"><span>${winner}</span><strong>${ratioText}</strong></span>`;
}

function compareDelta(box3d, rapier, key, suffix = '') {
  const boxValue = box3d?.[key];
  const rapierValue = rapier?.[key];
  if (!Number.isFinite(boxValue) || !Number.isFinite(rapierValue)) {
    return '';
  }

  const delta = boxValue - rapierValue;
  if (Math.abs(delta) <= Math.max(Math.abs(boxValue), Math.abs(rapierValue), 1) * 0.01) {
    return `<span class="compare-chip tie"><span>Same</span><small>${formatMetric(boxValue, suffix)}</small></span>`;
  }

  return `<span class="compare-chip neutral"><span>Δ Box3D</span><strong>${delta > 0 ? '+' : ''}${formatMetric(delta, suffix)}</strong></span>`;
}

function makeCompareRow(level, pairIndex, box3d, rapier) {
  if (!box3d || !rapier) {
    return '';
  }

  return `
        <tr class="compare-row pair-${pairIndex % 2 === 0 ? 'even' : 'odd'} pair-end" data-row-type="compare" data-level="${level}">
          <td><span class="engine-chip compare">Compare</span></td>
          <td>ratio</td>
          <td>${level.toLocaleString()}</td>
          <td>${compareMetric(box3d, rapier, 'avgSimFps')}</td>
          <td>${compareMetric(box3d, rapier, 'p95PhysicsStepMs', { higherIsBetter: false, suffix: ' ms', decimals: 1 })}</td>
          <td>${compareMetric(box3d, rapier, 'avgSyncMs', { higherIsBetter: false, suffix: ' ms', decimals: 1 })}</td>
          <td>${compareMetric(box3d, rapier, 'avgSimCapacityFps')}</td>
          <td>${compareMetric(box3d, rapier, 'p50SimCapacityFps')}</td>
          <td>${compareMetric(box3d, rapier, 'avgRenderFps')}</td>
          <td>${compareMetric(box3d, rapier, 'p50RenderFps')}</td>
          <td>${compareMetric(box3d, rapier, 'resetWallMs', { higherIsBetter: false, suffix: ' ms', decimals: 1 })}</td>
          <td>${compareMetric(box3d, rapier, 'firstStepWallMs', { higherIsBetter: false, suffix: ' ms', decimals: 1 })}</td>
          <td>${compareDelta(box3d, rapier, 'estimatedSnapshotMB', ' MB')}</td>
          <td>${compareDelta(box3d, rapier, 'observedSnapshotMB', ' MB')}</td>
          <td class="issue-cell"></td>
        </tr>
      `;
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
  const chartId = `metric-${level}-${metricKey}`.replace(/[^a-z0-9_-]/gi, '-');
  const xMax = Math.max(1, ...levelSamples.map((sample) => sample.tMs));
  const yMax = niceCeil(Math.max(1, ...levelSamples.map((sample) => sample[metricKey] ?? 0)) * 1.12);
  const yTicks = makeTicks(yMax, 5);
  const xTicks = Array.from({ length: 5 }, (_, index) => (xMax * index) / 4);
  const showFloor = metricKey === 'simCapacityFps' && yMax >= MIN_FPS_FLOOR;
  const floorY = chartHeight - (MIN_FPS_FLOOR / yMax) * chartHeight;
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
      <div class="chart-heading">
        <h3>${level.toLocaleString()} Bodies - ${label}</h3>
	        <div class="mini-legend">
	          <span><span class="swatch" style="--color:#58a6ff"></span>Box3D</span>
	          <span><span class="swatch" style="--color:#f59e0b"></span>Rapier</span>
	          ${showFloor ? '<span><span class="floor-swatch"></span>20 FPS floor</span>' : ''}
	        </div>
	        <div class="zoom-controls" aria-label="Chart zoom controls">
	          <button type="button" data-zoom="in">Zoom in</button>
	          <button type="button" data-zoom="out">Zoom out</button>
	          <button type="button" data-zoom="reset">Reset</button>
	        </div>
	      </div>
	      <svg class="zoomable-chart" viewBox="0 0 ${chartWidth + 72} ${chartHeight + 54}" role="img" aria-label="${label} over time for ${level} bodies">
	        <g transform="translate(52 18)">
          <defs>
            <clipPath id="${chartId}-clip">
              <rect x="0" y="0" width="${chartWidth}" height="${chartHeight}" />
            </clipPath>
          </defs>
          <rect width="${chartWidth}" height="${chartHeight}" rx="6" fill="#111827" />
          ${makeGridLines({
            width: chartWidth,
            height: chartHeight,
            xTicks,
            yTicks,
            xMax,
            yMax,
            ySuffix: ' FPS',
            xFormatter: (value) => `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}s`,
          })}
          ${
            showFloor
              ? `<line class="floor-line" x1="0" y1="${floorY.toFixed(1)}" x2="${chartWidth}" y2="${floorY.toFixed(1)}" />
                <text class="floor-label" x="${chartWidth - 8}" y="${Math.max(12, floorY - 6).toFixed(1)}" text-anchor="end">20 FPS floor</text>`
              : ''
          }
          <line x1="0" y1="${chartHeight}" x2="${chartWidth}" y2="${chartHeight}" stroke="#334155" />
          <line x1="0" y1="0" x2="0" y2="${chartHeight}" stroke="#334155" />
          <text class="axis-label" x="${chartWidth / 2}" y="${chartHeight + 34}" text-anchor="middle">time in sample window</text>
          <text class="axis-label" x="-${chartHeight / 2}" y="-38" transform="rotate(-90)" text-anchor="middle">${label}</text>
          <g class="plot-window" clip-path="url(#${chartId}-clip)">
            <g class="plot-zoom-layer" data-plot-width="${chartWidth}" data-plot-height="${chartHeight}">
              ${paths}
            </g>
          </g>
        </g>
      </svg>
    </div>
  `;
}

function makeOverviewChart({ summary, metricKey, label, yLabel, scale = 'linear', chartHeight = 260 }) {
  const colors = {
    box3d: '#58a6ff',
    rapier: '#f59e0b',
  };
  const chartWidth = 860;
  const chartId = `overview-${metricKey}`.replace(/[^a-z0-9_-]/gi, '-');
  const points = sortSummaryRows(summary).filter((row) => Number.isFinite(row[metricKey]));
  const xMax = Math.max(1, ...points.map((point) => point.requestedBodies));
  const rawYMax = Math.max(1, ...points.map((point) => point[metricKey] ?? 0));
  const yMax = scale === 'log' ? niceCeil(rawYMax) : niceCeil(rawYMax * 1.12);
  const yTransform = (value) => {
    if (scale === 'log') {
      return Math.log10(Math.max(1, value)) / Math.log10(Math.max(10, yMax));
    }
    return Math.max(0, value) / yMax;
  };
  const yTicks =
    scale === 'log'
      ? [...new Set([1, 10, 20, 100, 1000, 10000, 100000, yMax].filter((tick) => tick <= yMax))].sort((a, b) => a - b)
      : makeTicks(yMax, 5);
  const xTicks = Array.from({ length: 5 }, (_, index) => (xMax * index) / 4);
  const grid = yTicks
    .map((tick) => {
      const y = chartHeight - yTransform(tick) * chartHeight;
      return `
        <line class="grid-line" x1="0" y1="${y.toFixed(1)}" x2="${chartWidth}" y2="${y.toFixed(1)}" />
        <text class="tick-label" x="-10" y="${(y + 4).toFixed(1)}" text-anchor="end">${escapeHtml(formatAxisValue(tick))}</text>
      `;
    })
    .join('\n');
  const xGrid = xTicks
    .map((tick) => {
      const x = (tick / xMax) * chartWidth;
      return `
        <line class="grid-line vertical" x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${chartHeight}" />
        <text class="tick-label" x="${x.toFixed(1)}" y="${chartHeight + 20}" text-anchor="middle">${escapeHtml(formatAxisValue(tick))}</text>
      `;
    })
    .join('\n');
  const floorY = chartHeight - yTransform(MIN_FPS_FLOOR) * chartHeight;
  const showFloor = metricKey.includes('Fps') && MIN_FPS_FLOOR <= yMax;

  const paths = ENGINES.flatMap((engine) => {
    const enginePoints = points.filter((point) => point.engine === engine).sort((a, b) => a.requestedBodies - b.requestedBodies);
    if (enginePoints.length === 0) {
      return [];
    }
    const color = colors[engine] ?? '#94a3b8';
    const path = enginePoints
      .map((point, index) => {
        const x = (point.requestedBodies / xMax) * chartWidth;
        const y = chartHeight - yTransform(point[metricKey]) * chartHeight;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
    const dots = enginePoints
      .map((point) => {
        const x = (point.requestedBodies / xMax) * chartWidth;
        const y = chartHeight - yTransform(point[metricKey]) * chartHeight;
        const title = `${engineLabel(engine)}\n${point.requestedBodies.toLocaleString()} requested bodies\n${Math.round(point.bodies).toLocaleString()} bodies\n${label}: ${formatMetric(point[metricKey])}\nP95 step: ${formatMetric(point.p95PhysicsStepMs, ' ms')}\nAvg sync: ${formatMetric(point.avgSyncMs, ' ms')}`;
        return `<circle class="sample-point overview-point" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.8" fill="${color}" tabindex="0"><title>${escapeHtml(title)}</title></circle>`;
      })
      .join('\n');
    const last = enginePoints.at(-1);
    const lastX = last ? (last.requestedBodies / xMax) * chartWidth : 0;
    const lastY = last ? chartHeight - yTransform(last[metricKey]) * chartHeight : 0;
    return `
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2.8">
        <title>${escapeHtml(`${engineLabel(engine)} ${label}`)}</title>
      </path>
      ${dots}
      ${last ? `<text class="line-label" x="${Math.min(chartWidth - 78, lastX + 8).toFixed(1)}" y="${Math.max(12, Math.min(chartHeight - 6, lastY - 6)).toFixed(1)}" fill="${color}">${engineLabel(engine)}</text>` : ''}
    `;
  }).join('\n');

  return `
    <div class="chart overview-chart">
      <div class="chart-heading">
        <h3>${label} by Body Count</h3>
	        <div class="mini-legend">
	          <span><span class="swatch" style="--color:#58a6ff"></span>Box3D</span>
	          <span><span class="swatch" style="--color:#f59e0b"></span>Rapier</span>
	          ${showFloor ? '<span><span class="floor-swatch"></span>20 FPS floor</span>' : ''}
	          ${scale === 'log' ? '<span class="scale-note">log scale</span>' : ''}
	        </div>
	        <div class="zoom-controls" aria-label="Chart zoom controls">
	          <button type="button" data-zoom="in">Zoom in</button>
	          <button type="button" data-zoom="out">Zoom out</button>
	          <button type="button" data-zoom="reset">Reset</button>
	        </div>
	      </div>
	      <svg class="zoomable-chart" viewBox="0 0 ${chartWidth + 82} ${chartHeight + 56}" role="img" aria-label="${label} by body count">
        <g transform="translate(62 18)">
          <defs>
            <clipPath id="${chartId}-clip">
              <rect x="0" y="0" width="${chartWidth}" height="${chartHeight}" />
            </clipPath>
          </defs>
          <rect width="${chartWidth}" height="${chartHeight}" rx="6" fill="#111827" />
          ${grid}
          ${xGrid}
          ${
            showFloor
              ? `<line class="floor-line" x1="0" y1="${floorY.toFixed(1)}" x2="${chartWidth}" y2="${floorY.toFixed(1)}" />
                <text class="floor-label" x="${chartWidth - 8}" y="${Math.max(12, floorY - 6).toFixed(1)}" text-anchor="end">20 FPS floor</text>`
              : ''
          }
          <line x1="0" y1="${chartHeight}" x2="${chartWidth}" y2="${chartHeight}" stroke="#334155" />
          <line x1="0" y1="0" x2="0" y2="${chartHeight}" stroke="#334155" />
          <text class="axis-label" x="${chartWidth / 2}" y="${chartHeight + 38}" text-anchor="middle">requested bodies</text>
          <text class="axis-label" x="-${chartHeight / 2}" y="-48" transform="rotate(-90)" text-anchor="middle">${yLabel}</text>
          <g class="plot-window" clip-path="url(#${chartId}-clip)">
            <g class="plot-zoom-layer" data-plot-width="${chartWidth}" data-plot-height="${chartHeight}">
              ${paths}
            </g>
          </g>
        </g>
      </svg>
    </div>
  `;
}

function makeChartHtml(result) {
  const levels = [...new Set(result.summary.map((row) => row.requestedBodies))];
  const overview = `
    <section class="panel overview-panel">
      <h2>Overview</h2>
      ${makeOverviewChart({
        summary: result.summary,
        metricKey: 'avgSimCapacityFps',
        label: 'Average Sim Capacity FPS',
        yLabel: 'sim capacity FPS',
        scale: 'log',
      })}
      ${makeOverviewChart({
        summary: result.summary,
        metricKey: 'p95PhysicsStepMs',
        label: 'P95 Physics Step',
        yLabel: 'milliseconds',
      })}
    </section>
  `;

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

  const rows = levels
    .map((level, levelIndex) => {
      const levelRows = sortSummaryRows(result.summary).filter((row) => row.requestedBodies === level);
      const engineRows = levelRows
        .map((row, rowIndex) => {
          const status = row.ok ? (row.floorHit ? 'floor' : 'ok') : 'failed';
          const rowPosition = rowIndex === 0 ? 'pair-start' : 'pair-middle';
          return `
        <tr class="engine-row ${row.engine} pair-${levelIndex % 2 === 0 ? 'even' : 'odd'} ${rowPosition}" data-row-type="engine" data-engine="${row.engine}" data-status="${status}" data-level="${level}">
          <td><span class="engine-chip ${row.engine}">${engineLabel(row.engine)}</span></td>
          <td>${status}</td>
          <td>${Math.round(row.bodies).toLocaleString()}</td>
          <td>${row.avgSimFps.toFixed(1)}</td>
          <td>${row.p95PhysicsStepMs.toFixed(2)}</td>
          <td>${row.avgSyncMs.toFixed(2)}</td>
          <td>${row.avgSimCapacityFps.toFixed(1)}</td>
          <td>${row.p50SimCapacityFps.toFixed(1)}</td>
          <td>${row.avgRenderFps.toFixed(1)}</td>
          <td>${row.p50RenderFps.toFixed(1)}</td>
          <td>${Math.round(row.resetWallMs).toLocaleString()}</td>
          <td>${Math.round(row.firstStepWallMs).toLocaleString()}</td>
          <td>${row.estimatedSnapshotMB.toFixed(1)}</td>
          <td>${row.observedSnapshotMB.toFixed(1)}</td>
          <td class="issue-cell">${escapeHtml(row.error)}</td>
        </tr>
      `;
        })
        .join('\n');
      return `${engineRows}\n${makeCompareRow(
        level,
        levelIndex,
        levelRows.find((row) => row.engine === 'box3d'),
        levelRows.find((row) => row.engine === 'rapier')
      )}`;
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
      table { width: 100%; border-collapse: separate; border-spacing: 0 8px; margin: 22px 0 28px; font-size: 13px; }
      th, td { padding: 10px 12px; text-align: right; }
      th:first-child, td:first-child { text-align: left; }
      th { color: #bfcede; font-weight: 700; }
      tbody tr.engine-row td, tbody tr.compare-row td { background: #151f31; border-style: solid; border-color: rgba(148, 163, 184, 0.26); border-width: 0; }
      tbody tr.pair-even td { background: #172338; }
      tbody tr.pair-odd td { background: #121d2f; }
      tbody tr.compare-row td { background: #0f1a2b; border-top-width: 1px; border-top-color: rgba(148, 163, 184, 0.16); color: #cfdaea; }
      tbody tr.box3d td { box-shadow: inset 3px 0 0 #58a6ff; }
      tbody tr.rapier td { box-shadow: inset 3px 0 0 #f59e0b; }
      tbody tr.pair-start td { border-top-width: 2px; }
      tbody tr.pair-end td { border-bottom-width: 2px; }
      tbody tr.engine-row td:first-child { border-left-width: 2px; }
      tbody tr.engine-row td:last-child { border-right-width: 2px; }
      tbody tr.pair-start td:first-child { border-top-left-radius: 8px; }
      tbody tr.pair-start td:last-child { border-top-right-radius: 8px; }
      tbody tr.pair-end td:first-child { border-bottom-left-radius: 8px; }
      tbody tr.pair-end td:last-child { border-bottom-right-radius: 8px; }
      .engine-chip { display: inline-flex; align-items: center; min-width: 58px; font-weight: 800; }
      .engine-chip.box3d { color: #8ec5ff; }
      .engine-chip.rapier { color: #f9c46f; }
      .engine-chip.compare { color: #cbd5e1; }
      .compare-chip { display: inline-flex; align-items: baseline; justify-content: flex-end; gap: 6px; min-width: 92px; font-weight: 800; }
      .compare-chip small { color: #8ea0b8; font-weight: 600; }
      .compare-chip.box3d { color: #8ec5ff; }
      .compare-chip.rapier { color: #f9c46f; }
      .compare-chip.tie, .compare-chip.neutral { color: #cbd5e1; }
      .issue-cell { max-width: 290px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #f3b0a8; text-align: left; }
      .table-tools { display: grid; grid-template-columns: minmax(220px, 1.4fr) repeat(2, minmax(140px, 0.6fr)) auto auto; gap: 10px; align-items: end; margin: 8px 0 12px; padding: 14px; border: 1px solid #243041; border-radius: 8px; background: #121d2f; }
      .table-tools label { display: grid; gap: 5px; color: #aab8ca; font-size: 12px; font-weight: 700; }
      .table-tools input, .table-tools select { min-height: 34px; border: 1px solid #334155; border-radius: 6px; background: #0f172a; color: #e5edf6; padding: 0 10px; font: inherit; }
      .table-tools button { min-height: 34px; border: 1px solid #334155; border-radius: 6px; background: #172338; color: #e5edf6; padding: 0 12px; font-weight: 800; cursor: pointer; }
      .table-tools .checkbox-label { display: inline-flex; gap: 8px; align-items: center; min-height: 34px; }
      .table-tools .checkbox-label input { min-height: 0; }
      .filter-count { color: #8ea0b8; font-size: 12px; text-align: right; }
      .legend { display: flex; gap: 18px; flex-wrap: wrap; margin: 12px 0 20px; color: #cbd5e1; font-size: 13px; }
      .zoom-help { margin-top: -10px; margin-bottom: 20px; color: #8ea0b8; font-size: 13px; }
      .key { display: inline-flex; align-items: center; gap: 7px; }
      .swatch { width: 22px; height: 3px; border-radius: 999px; background: var(--color); }
      .dash { border-top: 3px dashed var(--color); background: transparent; height: 0; }
      .panel { margin: 0 0 22px; padding: 18px; border: 1px solid #243041; border-radius: 8px; background: #151f31; }
      .overview-panel { background: #121d2f; }
	      .chart + .chart { margin-top: 16px; }
	      .chart-heading { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; flex-wrap: wrap; margin-bottom: 6px; }
	      .mini-legend { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; color: #aab8ca; font-size: 12px; }
	      .mini-legend span { display: inline-flex; align-items: center; gap: 6px; }
	      .zoom-controls { display: inline-flex; gap: 6px; align-items: center; }
	      .zoom-controls button { min-height: 28px; border: 1px solid #334155; border-radius: 6px; background: #172338; color: #dbeafe; padding: 0 9px; font-size: 12px; font-weight: 800; cursor: pointer; }
	      .zoom-controls button:hover { background: #22324d; }
	      .floor-swatch { width: 22px; height: 0; border-top: 2px dashed #e2e8f0; }
	      .scale-note { color: #8ea0b8; }
	      svg { width: 100%; height: auto; display: block; }
		      .zoomable-chart { cursor: grab; touch-action: none; user-select: none; border-radius: 8px; }
		      .zoomable-chart.is-dragging { cursor: grabbing; }
		      .plot-window { pointer-events: all; }
		      text { fill: #8ea0b8; font-size: 12px; }
	      .axis-label { fill: #728199; font-size: 11px; }
	      .tick-label { fill: #98a7bb; font-size: 11px; }
	      .grid-line { stroke: rgba(148, 163, 184, 0.22); stroke-width: 1; }
      .grid-line.vertical { stroke: rgba(148, 163, 184, 0.14); }
      .floor-line { stroke: #e2e8f0; stroke-width: 1.5; stroke-dasharray: 6 5; opacity: 0.88; }
      .floor-label { fill: #e2e8f0; font-size: 11px; paint-order: stroke; stroke: #111827; stroke-width: 4px; stroke-linejoin: round; }
	      .line-label { font-size: 12px; font-weight: 800; paint-order: stroke; stroke: #111827; stroke-width: 4px; stroke-linejoin: round; }
	      .sample-point { cursor: crosshair; stroke: #0f172a; stroke-width: 1.5px; opacity: 0.86; }
	      .overview-point { opacity: 0.72; }
	      .sample-point:hover, .sample-point:focus { opacity: 1; stroke: #f8fafc; stroke-width: 2.5px; outline: none; }
	      .zoomable-chart path,
	      .zoomable-chart line,
	      .zoomable-chart rect,
	      .zoomable-chart circle {
	        vector-effect: non-scaling-stroke;
	      }
      @media (max-width: 900px) {
        .table-tools { grid-template-columns: 1fr; }
        .filter-count { text-align: left; }
      }
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
      <p class="zoom-help">Use chart buttons or mouse wheel over the plot to zoom the data. Drag to pan inside the plot bounds; axes and labels stay fixed. Double-click or Reset to restore.</p>
      ${overview}
      <div class="table-tools" aria-label="Benchmark table filters">
        <label>
          Body count filter
          <input id="body-filter" type="search" placeholder="100, 5k-40k, >=80k" />
        </label>
        <label>
          Engine
          <select id="engine-filter">
            <option value="all">Box3D + Rapier</option>
            <option value="box3d">Box3D only</option>
            <option value="rapier">Rapier only</option>
          </select>
        </label>
        <label>
          Status
          <select id="status-filter">
            <option value="all">All statuses</option>
            <option value="ok">OK</option>
            <option value="floor">Floor</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label class="checkbox-label">
          <input id="compare-filter" type="checkbox" checked />
          Compare rows
        </label>
        <button id="clear-filters" type="button">Clear</button>
        <span id="filter-count" class="filter-count"></span>
      </div>
      <table id="summary-table">
        <thead>
          <tr>
            <th>Engine</th><th>Status</th><th>Bodies</th><th>Scheduled Sim Hz</th><th>P95 Step ms</th><th>Avg Sync ms</th><th>Avg Sim Capacity FPS</th><th>P50 Sim Capacity FPS</th><th>Avg Render FPS</th><th>P50 Render FPS</th><th>Reset ms</th><th>First Step ms</th><th>Est Snapshot MB</th><th>Seen Snapshot MB</th><th>Issue</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${panels}
    </main>
    <script>
      (() => {
        const bodyFilter = document.querySelector('#body-filter');
        const engineFilter = document.querySelector('#engine-filter');
        const statusFilter = document.querySelector('#status-filter');
        const compareFilter = document.querySelector('#compare-filter');
        const clearFilters = document.querySelector('#clear-filters');
        const filterCount = document.querySelector('#filter-count');
        const rows = [...document.querySelectorAll('#summary-table tbody tr')];

        function parseCount(value) {
          const clean = String(value ?? '').trim().toLowerCase().replace(/,/g, '');
          if (!clean) {
            return NaN;
          }
          const multiplier = clean.endsWith('m') ? 1000000 : clean.endsWith('k') ? 1000 : 1;
          return Number(clean.replace(/[km]$/, '')) * multiplier;
        }

        function matchesBodyFilter(level, filterText) {
          const text = filterText.trim();
          if (!text) {
            return true;
          }

          return text
            .split(/[\\s,]+/)
            .filter(Boolean)
            .some((rawToken) => {
              const token = rawToken.toLowerCase();
              if (token.startsWith('>=')) {
                return level >= parseCount(token.slice(2));
              }
              if (token.startsWith('<=')) {
                return level <= parseCount(token.slice(2));
              }
              if (token.startsWith('>')) {
                return level > parseCount(token.slice(1));
              }
              if (token.startsWith('<')) {
                return level < parseCount(token.slice(1));
              }
              const range = token.match(/^(.+?)-(.+)$/);
              if (range) {
                const start = parseCount(range[1]);
                const end = parseCount(range[2]);
                return Number.isFinite(start) && Number.isFinite(end) && level >= Math.min(start, end) && level <= Math.max(start, end);
              }
              return level === parseCount(token);
            });
        }

        function applyFilters() {
          const selectedEngine = engineFilter.value;
          const selectedStatus = statusFilter.value;
          const showCompare = compareFilter.checked && selectedEngine === 'all';
          let visibleEngineRows = 0;
          let visibleCompareRows = 0;

          for (const row of rows) {
            const level = Number(row.dataset.level);
            const rowType = row.dataset.rowType;
            const bodyMatch = matchesBodyFilter(level, bodyFilter.value);
            let visible = bodyMatch;

            if (rowType === 'engine') {
              visible &&= selectedEngine === 'all' || row.dataset.engine === selectedEngine;
              visible &&= selectedStatus === 'all' || row.dataset.status === selectedStatus;
              if (visible) {
                visibleEngineRows += 1;
              }
            } else {
              visible &&= showCompare && selectedStatus === 'all';
              if (visible) {
                visibleCompareRows += 1;
              }
            }

            row.hidden = !visible;
          }

          filterCount.textContent = visibleEngineRows + ' engine rows' + (showCompare ? ', ' + visibleCompareRows + ' comparisons' : '');
        }

        for (const control of [bodyFilter, engineFilter, statusFilter, compareFilter]) {
          control.addEventListener('input', applyFilters);
          control.addEventListener('change', applyFilters);
        }
	        clearFilters.addEventListener('click', () => {
	          bodyFilter.value = '';
	          engineFilter.value = 'all';
	          statusFilter.value = 'all';
	          compareFilter.checked = true;
	          applyFilters();
	        });
	        applyFilters();

	        function initZoomableChart(svg) {
	          const layer = svg.querySelector('.plot-zoom-layer');
	          if (!layer) {
	            return;
	          }
	          const plotFrame = layer.closest('.plot-window') || layer.parentNode;
	          const plotWidth = Math.max(1, Number(layer.dataset.plotWidth || 1));
	          const plotHeight = Math.max(1, Number(layer.dataset.plotHeight || 1));
	          const minScale = 1;
	          const maxScale = 16;
	          let transform = { k: 1, x: 0, y: 0 };
	          let drag = null;
	          const textItems = [...layer.querySelectorAll('text')].map((element) => ({
	            element,
	            fontSize: parseFloat(getComputedStyle(element).fontSize) || 12,
	            strokeWidth: parseFloat(getComputedStyle(element).strokeWidth) || 0,
	          }));
	          const pointItems = [...layer.querySelectorAll('.sample-point')].map((element) => ({
	            element,
	            radius: Number(element.getAttribute('r') || 4),
	          }));

	          function clampTransform(next) {
	            const k = Math.max(minScale, Math.min(maxScale, Number.isFinite(next.k) ? next.k : minScale));
	            const minX = plotWidth - plotWidth * k;
	            const minY = plotHeight - plotHeight * k;
	            return {
	              k,
	              x: Math.min(0, Math.max(minX, Number.isFinite(next.x) ? next.x : 0)),
	              y: Math.min(0, Math.max(minY, Number.isFinite(next.y) ? next.y : 0)),
	            };
	          }

	          function applyTransform(next) {
	            transform = clampTransform(next);
	            layer.setAttribute('transform', 'translate(' + transform.x.toFixed(3) + ' ' + transform.y.toFixed(3) + ') scale(' + transform.k.toFixed(4) + ')');
	            const inverse = 1 / transform.k;
	            for (const item of textItems) {
	              item.element.style.fontSize = Math.max(8, item.fontSize * inverse).toFixed(2) + 'px';
	              if (item.strokeWidth > 0) {
	                item.element.style.strokeWidth = Math.max(1, item.strokeWidth * inverse).toFixed(2) + 'px';
	              }
	            }
	            for (const item of pointItems) {
	              item.element.setAttribute('r', Math.max(1.8, item.radius * inverse).toFixed(2));
	            }
	          }

	          function pointForEvent(event) {
	            const matrix = plotFrame.getScreenCTM();
	            if (!matrix) {
	              return { x: plotWidth / 2, y: plotHeight / 2 };
	            }
	            const point = svg.createSVGPoint();
	            point.x = event.clientX;
	            point.y = event.clientY;
	            return point.matrixTransform(matrix.inverse());
	          }

	          function zoomAt(factor, center) {
	            const nextScale = Math.max(minScale, Math.min(maxScale, transform.k * factor));
	            const ratio = nextScale / transform.k;
	            applyTransform({
	              k: nextScale,
	              x: center.x - (center.x - transform.x) * ratio,
	              y: center.y - (center.y - transform.y) * ratio,
	            });
	          }

	          function reset() {
	            applyTransform({ k: 1, x: 0, y: 0 });
	          }

	          svg.addEventListener('wheel', (event) => {
	            event.preventDefault();
	            zoomAt(event.deltaY > 0 ? 1 / 1.18 : 1.18, pointForEvent(event));
	          }, { passive: false });

	          svg.addEventListener('pointerdown', (event) => {
	            if (event.button !== 0) {
	              return;
	            }
	            drag = {
	              pointerId: event.pointerId,
	              startPoint: pointForEvent(event),
	              transform: { ...transform },
	            };
	            svg.classList.add('is-dragging');
	            svg.setPointerCapture(event.pointerId);
	          });

	          svg.addEventListener('pointermove', (event) => {
	            if (!drag || drag.pointerId !== event.pointerId) {
	              return;
	            }
	            const point = pointForEvent(event);
	            applyTransform({
	              ...drag.transform,
	              x: drag.transform.x + point.x - drag.startPoint.x,
	              y: drag.transform.y + point.y - drag.startPoint.y,
	            });
	          });

	          svg.addEventListener('pointerup', (event) => {
	            if (!drag || drag.pointerId !== event.pointerId) {
	              return;
	            }
	            drag = null;
	            svg.classList.remove('is-dragging');
	            svg.releasePointerCapture(event.pointerId);
	          });

	          svg.addEventListener('dblclick', reset);

	          const chart = svg.closest('.chart');
	          const center = () => ({
	            x: (plotWidth / 2 - transform.x) / transform.k,
	            y: (plotHeight / 2 - transform.y) / transform.k,
	          });
	          chart?.querySelector('[data-zoom="in"]')?.addEventListener('click', () => zoomAt(1.35, center()));
	          chart?.querySelector('[data-zoom="out"]')?.addEventListener('click', () => zoomAt(1 / 1.35, center()));
	          chart?.querySelector('[data-zoom="reset"]')?.addEventListener('click', reset);
	          reset();
	        }

	        for (const svg of document.querySelectorAll('.zoomable-chart')) {
	          initZoomableChart(svg);
	        }
	      })();
    </script>
  </body>
</html>`;
}

function writeChartHtml(result, filePath) {
  fs.writeFileSync(filePath, makeChartHtml(result).replace(/[ \t]+\n/g, '\n'));
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (process.env.WB3_BENCH_RENDER_ONLY === '1') {
    const latestPath = path.join(OUTPUT_DIR, 'latest.json');
    const result = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
    writeChartHtml(result, path.join(OUTPUT_DIR, 'latest.html'));
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
          `${engine} ${level} bodies: render ${result.summary.avgRenderFps.toFixed(1)} fps, sim capacity ${result.summary.avgSimCapacityFps.toFixed(1)} fps, reset ${Math.round(result.summary.resetWallMs)}ms, first step ${Math.round(result.summary.firstStepWallMs)}ms`
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
    firstStepTimeoutMs: FIRST_STEP_TIMEOUT_MS,
    requireFirstStep: REQUIRE_FIRST_STEP,
    levelTimeoutMs: LEVEL_TIMEOUT_MS,
    minFpsFloor: MIN_FPS_FLOOR,
    stopOnFloor: STOP_ON_FLOOR,
    consoleErrors,
    summary,
    samples,
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'latest.json'), `${JSON.stringify(result, null, 2)}\n`);
  writeCsv(samples, path.join(OUTPUT_DIR, 'latest.csv'));
  writeChartHtml(result, path.join(OUTPUT_DIR, 'latest.html'));
  console.log(JSON.stringify({ outputDir: OUTPUT_DIR, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

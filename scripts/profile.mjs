/* Lag profile (item 7d): 4x CPU throttling via CDP during place, drag and
 * reveal on the deterministic board harness. Reports long tasks (>50ms),
 * p95 frame time and worst frame per interaction. Run before AND after fixes. */
import { spawn, execSync } from 'node:child_process';
import { chromium } from 'playwright';
import net from 'node:net';
import path from 'node:path';

const APP_PORT = 4177;
const BASE = process.env.SMOKE_URL || `http://localhost:${APP_PORT}/`;

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => reject(new Error(`Port ${port} is not free: ${err.message}`)));
    server.once('listening', () => server.close(() => resolve()));
    server.listen(port);
  });
}

async function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for HTTP 200 on ${url}`);
}

function killProcessTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32')
      execSync(`taskkill /pid ${proc.pid} /t /f`, { stdio: 'ignore' });
    else proc.kill('SIGTERM');
  } catch {}
}

async function measure(page, label, fn) {
  await page.evaluate(() => {
    window.__prof = { deltas: [], longs: [] };
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__prof.longs.push(e.duration);
    });
    try {
      obs.observe({ entryTypes: ['longtask'] });
    } catch {}
    window.__profObs = obs;
    let last = performance.now();
    const tick = (now) => {
      window.__prof.deltas.push(now - last);
      last = now;
      window.__profRaf = requestAnimationFrame(tick);
    };
    window.__profRaf = requestAnimationFrame(tick);
  });
  await fn();
  const stats = await page.evaluate(() => {
    cancelAnimationFrame(window.__profRaf);
    window.__profObs?.disconnect();
    const d = [...window.__prof.deltas].sort((a, b) => a - b);
    const p95 = d.length > 0 ? d[Math.floor(d.length * 0.95)] : 0;
    const worst = d.length > 0 ? d[d.length - 1] : 0;
    const over50 = d.filter((x) => x > 50).length;
    const longs = window.__prof.longs;
    return {
      frames: d.length,
      p95: Math.round(p95 * 10) / 10,
      worst: Math.round(worst * 10) / 10,
      framesOver50ms: over50,
      longtasks: longs.length,
      worstLongtask: longs.length > 0 ? Math.round(Math.max(...longs) * 10) / 10 : 0,
    };
  });
  console.log(
    `${label}: frames=${stats.frames} p95=${stats.p95}ms worst=${stats.worst}ms ` +
      `frames>50ms=${stats.framesOver50ms} longtasks=${stats.longtasks} worstLT=${stats.worstLongtask}ms`
  );
  return stats;
}

let previewProc = null;
let browser = null;
try {
  if (!process.env.SMOKE_URL) {
    await assertPortFree(APP_PORT);
    const viteBin = path.resolve('node_modules/vite/bin/vite.js');
    previewProc = spawn(
      process.execPath,
      [viteBin, 'preview', '--port', String(APP_PORT), '--strictPort'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    await waitForHttp(BASE, 30000);
  }
  browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  console.log('CPU throttling: 4x');

  // Place: tap-select 3 cards into zones on the full board.
  await page.goto(`${BASE}?harness=board&scene=full`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hand-fan', { timeout: 8000 });
  await page.evaluate(() => document.fonts.ready);
  await measure(page, 'place x3 (4x CPU)', async () => {
    for (const zone of ['cool', 'party', 'energy']) {
      await page.locator('.fan-card').first().click();
      await page.locator(`[data-zone="${zone}"]`).click();
      await page.waitForTimeout(400);
    }
  });

  // Drag: pointer drag across zones (exercises per-move layout work).
  await measure(page, 'drag (4x CPU)', async () => {
    const card = page.locator('.fan-card').first();
    const box = await card.boundingBox();
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let i = 1; i <= 30; i += 1) {
      await page.mouse.move(startX + i * 8, startY - i * 2);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
  });

  // Reveal: staggered flip/pop animations on 18 cards.
  await page.goto(`${BASE}?harness=board&scene=resolution`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.resolution-panel', { timeout: 8000 });
  await page.evaluate(() => document.fonts.ready);
  await measure(page, 'reveal seq (4x CPU)', async () => {
    await page.waitForTimeout(4500);
  });
} finally {
  try {
    await browser?.close();
  } catch {}
  if (previewProc) killProcessTree(previewProc);
}
console.log('PROFILE DONE');

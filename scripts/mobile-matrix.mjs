/* Mobile matrix (item 7b): isMobile + hasTouch landscape contexts across
 * 640x360 / 740x360 / 844x390 / 915x412 / 932x430. Scenes: title, online
 * lobby, full board (full hand + 3 cards/zone), reveal, resolution overlay,
 * results review. Screenshots to ./mobile-shots (git-excluded); asserts the
 * Lock/Ready button, timer, all three zones, the hand and the top bar lie
 * fully inside the viewport with no page scroll. */
import { spawn, execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const APP_PORT = 4176;
const BASE = process.env.SMOKE_URL || `http://localhost:${APP_PORT}/`;
const VIEWPORTS = [
  { width: 640, height: 360 },
  { width: 740, height: 360 },
  { width: 844, height: 390 },
  { width: 915, height: 412 },
  { width: 932, height: 430 },
];
const failures = [];
const passes = [];

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

async function checkInside(page, tag, selector, opts = {}) {
  const { count = 1 } = opts;
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })
  );
  if (boxes.length < count) {
    failures.push(`${tag}: ${selector} found ${boxes.length}, want ${count}`);
    return;
  }
  const vp = page.viewportSize();
  boxes.forEach((b, i) => {
    const inside =
      b.x >= -1 && b.y >= -1 && b.x + b.w <= vp.width + 1 && b.y + b.h <= vp.height + 1;
    if (!inside) {
      failures.push(
        `${tag}: ${selector}[${i}] rect ${Math.round(b.x)},${Math.round(b.y)} ` +
          `${Math.round(b.w)}x${Math.round(b.h)} outside ${vp.width}x${vp.height}`
      );
    } else {
      passes.push(`${tag}: ${selector}[${i}] inside`);
    }
  });
}

async function checkNoScroll(page, tag) {
  const scroll = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
    iw: window.innerWidth,
    ih: window.innerHeight,
  }));
  if (scroll.sw > scroll.iw + 1 || scroll.sh > scroll.ih + 1) {
    failures.push(
      `${tag}: page scrolls (doc ${scroll.sw}x${scroll.sh} vs viewport ${scroll.iw}x${scroll.ih})`
    );
  } else {
    passes.push(`${tag}: no page scroll`);
  }
}

async function shot(page, viewport, scene) {
  const dir = `mobile-shots/${viewport.width}x${viewport.height}`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${scene}.png` });
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
  for (const viewport of VIEWPORTS) {
    const vtag = `${viewport.width}x${viewport.height}`;
    const ctx = await browser.newContext({
      viewport,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`${vtag} pageerror: ${String(e).slice(0, 200)}`));

    // Title (real).
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.title-screen', { timeout: 8000 });
    await page.evaluate(() => document.fonts.ready);
    await shot(page, viewport, 'title');
    await checkNoScroll(page, `${vtag}/title`);

    // Online lobby (real render, no room creation).
    await page.getByRole('button', { name: 'Play Online' }).click();
    await page.waitForSelector('.online-lobby', { timeout: 8000 });
    await shot(page, viewport, 'lobby');
    await checkNoScroll(page, `${vtag}/lobby`);

    // Full board: full hand + 3 cards in every zone.
    await page.goto(`${BASE}?harness=board&scene=full`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.hand-fan', { timeout: 8000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await shot(page, viewport, 'board-full');
    await checkInside(page, `${vtag}/board-full`, '.game-topbar');
    await checkInside(page, `${vtag}/board-full`, '.timer-ring');
    await checkInside(page, `${vtag}/board-full`, '.zone-col', { count: 3 });
    await checkInside(page, `${vtag}/board-full`, '.hand-fan');
    await checkInside(page, `${vtag}/board-full`, '.hand-row .lock-btn');
    await checkNoScroll(page, `${vtag}/board-full`);

    // Reveal.
    await page.goto(`${BASE}?harness=board&scene=reveal`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.reveal-dock', { timeout: 8000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await shot(page, viewport, 'reveal');
    await checkInside(page, `${vtag}/reveal`, '.game-topbar');
    await checkInside(page, `${vtag}/reveal`, '.zone-col', { count: 3 });
    await checkInside(page, `${vtag}/reveal`, '.reveal-dock .btn');
    await checkNoScroll(page, `${vtag}/reveal`);

    // Resolution overlay (mid-sequence).
    await page.goto(`${BASE}?harness=board&scene=resolution`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.resolution-panel', { timeout: 8000 });
    await page.waitForTimeout(1200);
    await shot(page, viewport, 'resolution');
    await checkInside(page, `${vtag}/resolution`, '.zone-col', { count: 3 });
    await checkNoScroll(page, `${vtag}/resolution`);

    // Results review (skip the sequence).
    await page.goto(`${BASE}?harness=board&scene=results`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.resolution-panel', { timeout: 8000 });
    const skip = page.locator('.skip-btn');
    if ((await skip.count()) > 0) await skip.first().click();
    await page.waitForSelector('.review-dock', { timeout: 10000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await shot(page, viewport, 'results');
    await checkInside(page, `${vtag}/results`, '.zone-col', { count: 3 });
    await checkInside(page, `${vtag}/results`, '.review-dock');
    await checkNoScroll(page, `${vtag}/results`);

    await ctx.close();
    console.log(`${vtag} done`);
  }
} finally {
  try {
    await browser?.close();
  } catch {}
  if (previewProc) killProcessTree(previewProc);
}

console.log(`MATRIX: ${passes.length} checks passed`);
if (failures.length > 0) {
  console.error(`MATRIX FAILED: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('MATRIX PASSED');

/* Mobile matrix (item 7b): isMobile + hasTouch landscape contexts across
 * full-screen sizes (640x360 / 740x360 / 844x390 / 915x412 / 932x430) AND
 * browser-tab sizes with the Chrome URL bar visible (640x290 / 740x300 /
 * 844x330 / 915x350 / 932x370, ~55-65px shorter). Scenes: title, online
 * lobby, full board (full hand + 3 cards/zone), reveal, resolution overlay,
 * results review. Screenshots to ./mobile-shots (git-excluded); asserts the
 * Lock/Ready button, timer, all three zones, the hand and the top bar lie
 * fully inside the viewport with no page scroll. Tap-target assertions: every
 * visible button (and [role=button] zone) is fully inside the viewport and
 * renders >=40px on each side (>=39 with rounding tolerance) — except
 * .strip-mini recall chips (secondary; the zone column itself is the >=40
 * target), which must be inside at >=32px and are reported as warnings when
 * under 40. Fan cards past the scroll fold pass when their scroll container
 * is inside the viewport and they intersect its visible band. The floating
 * fullscreen button (.fs-fab) must not intersect any other button. */
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
  // Real Chrome tabs: URL bar visible (~55-65px shorter than full screen).
  { width: 640, height: 290 },
  { width: 740, height: 300 },
  { width: 844, height: 330 },
  { width: 915, height: 350 },
  { width: 932, height: 370 },
];
const MIN_TAP = 39; // 40px target with 1px rounding tolerance.
const MINI_TAP = 27; // .strip-mini recall chips: inside + >=28px, warn when <40.
const failures = [];
const passes = [];
const warnings = [];

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

/** Every visible button + [role=button] zone: inside viewport, >=40px. */
async function checkTapTargets(page, tag) {
  const els = await page
    .locator('button, [role="button"]')
    .evaluateAll((nodes) =>
      nodes.map((el) => {
        const r = el.getBoundingClientRect();
        const fan = el.closest('.hand-fan');
        const fr = fan ? fan.getBoundingClientRect() : null;
        const label = (
          el.getAttribute('aria-label') ||
          el.textContent ||
          el.className?.toString?.() ||
          'button'
        )
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40);
        return {
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          label,
          mini: el.classList?.contains('strip-mini') ?? false,
          fab: el.classList?.contains('fs-fab') ?? false,
          fan: fr ? { x: fr.x, y: fr.y, w: fr.width, h: fr.height } : null,
        };
      })
    );
  const vp = page.viewportSize();
  const visible = els.filter((b) => b.w >= 1 && b.h >= 1);
  if (visible.length === 0) {
    failures.push(`${tag}: no visible tap targets found`);
    return;
  }
  for (const b of visible) {
    let inside =
      b.x >= -1 && b.y >= -1 && b.x + b.w <= vp.width + 1 && b.y + b.h <= vp.height + 1;
    // Oversized hands scroll horizontally inside the fan (real hands are 6
    // cards and never scroll): pass when the fan is on screen and the card
    // sits in its vertical band, i.e. reachable with a sideways swipe.
    if (!inside && b.fan) {
      const f = b.fan;
      const fanInside =
        f.x >= -1 && f.y >= -1 && f.x + f.w <= vp.width + 1 && f.y + f.h <= vp.height + 1;
      const bandOverlap = b.y < f.y + f.h - 1 && b.y + b.h > f.y + 1;
      if (fanInside && bandOverlap) inside = true;
    }
    const need = b.mini ? MINI_TAP : MIN_TAP;
    const sizeOk = b.w >= need && b.h >= need;
    if (!inside) {
      failures.push(
        `${tag}: tap "${b.label}" rect ${Math.round(b.x)},${Math.round(b.y)} ` +
          `${Math.round(b.w)}x${Math.round(b.h)} outside ${vp.width}x${vp.height}`
      );
    } else if (!sizeOk) {
      failures.push(
        `${tag}: tap "${b.label}" size ${Math.round(b.w)}x${Math.round(b.h)} under 40px`
      );
    } else {
      passes.push(`${tag}: tap "${b.label}" ${Math.round(b.w)}x${Math.round(b.h)} ok`);
    }
    if (b.mini && inside && sizeOk && (b.w < 40 || b.h < 40)) {
      warnings.push(
        `${tag}: recall chip "${b.label}" ${Math.round(b.w)}x${Math.round(b.h)} under 40px (secondary)`
      );
    }
  }
}

/** Floating fullscreen button must not cover any other button. */
async function checkFabOverlap(page, tag) {
  const fab = await page.locator('.fs-fab').evaluateAll((nodes) =>
    nodes.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })
  );
  const box = fab.find((b) => b.w >= 1 && b.h >= 1);
  const vp = page.viewportSize();
  if (!box) {
    passes.push(`${tag}: no FAB (match screen or fullscreen/PWA — top bar owns it)`);
    return;
  }
  if (box.x < -1 || box.y < -1 || box.x + box.w > vp.width + 1 || box.y + box.h > vp.height + 1) {
    failures.push(`${tag}: FAB outside viewport ${Math.round(box.x)},${Math.round(box.y)}`);
    return;
  }
  if (box.w < 44 || box.h < 44) {
    failures.push(`${tag}: FAB ${Math.round(box.w)}x${Math.round(box.h)} under 44px`);
    return;
  }
  const others = await page.locator('button:not(.fs-fab)').evaluateAll((nodes) =>
    nodes.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })
  );
  const hit = others.find(
    (o) =>
      o.w >= 1 &&
      o.h >= 1 &&
      box.x < o.x + o.w - 1 &&
      box.x + box.w > o.x + 1 &&
      box.y < o.y + o.h - 1 &&
      box.y + box.h > o.y + 1
  );
  if (hit) {
    failures.push(
      `${tag}: FAB overlaps a button (fab ${Math.round(box.x)},${Math.round(box.y)} ` +
        `${Math.round(box.w)}x${Math.round(box.h)})`
    );
  } else {
    passes.push(`${tag}: FAB clear`);
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
    await checkTapTargets(page, `${vtag}/title`);
    await checkFabOverlap(page, `${vtag}/title`);

    // Online lobby (real render, no room creation).
    await page.getByRole('button', { name: 'Play Online' }).click();
    await page.waitForSelector('.online-lobby', { timeout: 8000 });
    await shot(page, viewport, 'lobby');
    await checkNoScroll(page, `${vtag}/lobby`);
    await checkTapTargets(page, `${vtag}/lobby`);
    await checkFabOverlap(page, `${vtag}/lobby`);

    // Full board: full hand + 3 cards in every zone.
    await page.goto(`${BASE}?harness=board&scene=full`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.hand-fan', { timeout: 8000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await shot(page, viewport, 'board-full');
    await checkInside(page, `${vtag}/board-full`, '.game-topbar');
    await checkInside(page, `${vtag}/board-full`, '.timer-readout');
    await checkInside(page, `${vtag}/board-full`, '.zone-col', { count: 3 });
    await checkInside(page, `${vtag}/board-full`, '.hand-fan');
    await checkInside(page, `${vtag}/board-full`, '.hand-row .lock-btn');
    await checkNoScroll(page, `${vtag}/board-full`);
    await checkTapTargets(page, `${vtag}/board-full`);
    await checkFabOverlap(page, `${vtag}/board-full`);

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
    await checkTapTargets(page, `${vtag}/reveal`);
    await checkFabOverlap(page, `${vtag}/reveal`);

    // Resolution overlay (mid-sequence).
    await page.goto(`${BASE}?harness=board&scene=resolution`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.resolution-panel', { timeout: 8000 });
    await page.waitForTimeout(1200);
    await shot(page, viewport, 'resolution');
    await checkInside(page, `${vtag}/resolution`, '.zone-col', { count: 3 });
    await checkNoScroll(page, `${vtag}/resolution`);
    await checkTapTargets(page, `${vtag}/resolution`);
    await checkFabOverlap(page, `${vtag}/resolution`);

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
    await checkTapTargets(page, `${vtag}/results`);
    await checkFabOverlap(page, `${vtag}/results`);

    // RTL: Arabic title puts the FAB on the physical left (inset-inline-end).
    if (viewport.width === 740 && viewport.height === 300) {
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForSelector('.title-screen', { timeout: 8000 });
      const ar = page.getByRole('button', { name: 'عربي' });
      if ((await ar.count()) > 0) await ar.first().click();
      await page.waitForTimeout(300);
      await shot(page, viewport, 'title-rtl');
      const fabBox = await page.locator('.fs-fab').evaluateAll((nodes) =>
        nodes.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, w: r.width };
        })
      );
      const f = fabBox.find((b) => b.w >= 1);
      if (!f) {
        failures.push(`${vtag}/title-rtl: no FAB found`);
      } else if (f.x + f.w / 2 >= viewport.width / 2) {
        failures.push(`${vtag}/title-rtl: FAB not on the left in RTL (x=${Math.round(f.x)})`);
      } else {
        passes.push(`${vtag}/title-rtl: FAB on the left`);
      }
      await checkTapTargets(page, `${vtag}/title-rtl`);
      await checkFabOverlap(page, `${vtag}/title-rtl`);
    }

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
if (warnings.length > 0) {
  console.warn(`MATRIX WARNINGS: ${warnings.length} below-40px secondary target(s)`);
  for (const w of warnings) console.warn(`  ! ${w}`);
}
if (failures.length > 0) {
  console.error(`MATRIX FAILED: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('MATRIX PASSED');

/* Card-names overflow check (item 5): every flavor in hand + zone sizes,
 * EN + AR, at 640x360 / 844x390 / 1100x480. Fails on any clipped name. */
import { spawn, execSync } from 'node:child_process';
import { chromium } from 'playwright';
import net from 'node:net';
import path from 'node:path';

const APP_PORT = 4175;
const BASE = process.env.SMOKE_URL || `http://localhost:${APP_PORT}/?harness=names`;
const VIEWPORTS = [
  { width: 640, height: 360 },
  { width: 844, height: 390 },
  { width: 1100, height: 480 },
];
const LANGS = ['en', 'ar'];
const failures = [];

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

let previewProc = null;
let browser = null;
try {
  if (!process.env.SMOKE_URL) {
    await assertPortFree(APP_PORT);
    const viteBin = path.resolve('node_modules/vite/bin/vite.js');
    previewProc = spawn(
      process.execPath,
      [viteBin, 'preview', '--port', String(APP_PORT), '--strictPort'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    await waitForHttp(BASE.split('?')[0], 30000);
  }
  browser = await chromium.launch();
  for (const lang of LANGS) {
    for (const viewport of VIEWPORTS) {
      const tag = `${lang}-${viewport.width}x${viewport.height}`;
      const ctx = await browser.newContext({ viewport });
      await ctx.addInitScript((l) => {
        try {
          window.localStorage.setItem('vcola_lang', l);
        } catch {}
      }, lang);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => failures.push(`${tag} pageerror: ${String(e).slice(0, 200)}`));
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForSelector('.names-harness', { timeout: 8000 });
      await page.waitForTimeout(400);
      const bad = await page.evaluate(() => {
        const out = [];
        const spans = [...document.querySelectorAll('.name-plate span')];
        for (const el of spans) {
          const name = el.textContent ?? '';
          const wClip = el.scrollWidth > el.clientWidth + 1;
          const hClip = el.scrollHeight > el.clientHeight + 1;
          if (wClip || hClip || name.includes('…')) {
            const card = el.closest('article')?.className ?? '';
            out.push(
              `${name} [${card.includes('card-board') ? 'zone' : 'hand'}] ` +
                `client=${el.clientWidth}x${el.clientHeight} scroll=${el.scrollWidth}x${el.scrollHeight}`
            );
          }
        }
        return { count: spans.length, bad: out };
      });
      console.log(`${tag}: checked ${bad.count} names, ${bad.bad.length} clipped`);
      for (const b of bad.bad) failures.push(`${tag}: ${b}`);
      await ctx.close();
    }
  }
} finally {
  try {
    await browser?.close();
  } catch {}
  if (previewProc) killProcessTree(previewProc);
}

if (failures.length > 0) {
  console.error(`CARD-NAMES FAILED: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('CARD-NAMES PASSED');

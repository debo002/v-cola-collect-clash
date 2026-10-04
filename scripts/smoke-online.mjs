/* Online smoke with full diagnostics. Run with HEADED=1 to show browsers.
 * On failure: saves screenshot, HTML, console, WS frames to ./smoke-online-fail/ */
import { spawn, execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const APP_PORT = 4173;
const ROOM_PORT = 8787;
const APP = process.env.SMOKE_URL || `http://localhost:${APP_PORT}/`;
const HEADED = process.env.HEADED === '1';
const ACTION_TIMEOUT = 8000;
const failures = [];
const stepLogs = [];

function logStep(ctx, step, detail = '') {
  const msg = `${ctx}: ${step}${detail ? ' - ' + detail : ''}`;
  stepLogs.push(msg);
  console.log(`[STEP] ${msg}`);
}

async function saveFail(ctx, step, page, frames) {
  const dir = `smoke-online-fail/${ctx}-${step.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}`;
  mkdirSync(dir, { recursive: true });
  try {
    if (page) {
      await page.screenshot({ path: `${dir}/screenshot.png`, fullPage: true }).catch(() => {});
      const content = await page.content().catch(() => '');
      if (content) writeFileSync(`${dir}/page.html`, content);
    }
    const consoleLog = stepLogs.join('\n');
    writeFileSync(`${dir}/console.log`, consoleLog);
    writeFileSync(`${dir}/frames.json`, JSON.stringify(frames ?? [], null, 2));
    console.log(`Saved failure artifacts to ${dir}`);
  } catch (e) {
    console.error('Failed to save artifacts:', e);
  }
}

const framesA = [];
const framesB = [];

function getFrames(ctx) {
  return ctx === 'ctx1' ? framesA : framesB;
}

function watch(page, tag, frames) {
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const msg = `${m.type()}: ${m.text()}`;
      console.error(`[${tag} console] ${msg}`);
      failures.push(`[${tag} console] ${msg}`);
    }
  });
  page.on('pageerror', (e) => {
    const msg = String(e);
    console.error(`[${tag} pageerror] ${msg}`);
    failures.push(`[${tag} pageerror] ${msg}`);
  });
  page.on('websocket', (ws) => {
    ws.on('framereceived', (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event.payload));
      } catch {
        return;
      }
      if (msg.type !== 'view') return;
      frames.push(msg);
      for (const board of msg.view.boards ?? []) {
        if (board.kind !== 'current') continue;
        for (const [id, zone] of Object.entries(board.zones ?? {})) {
          if (!('foeCount' in zone) || 'foe' in zone) {
            failures.push(`${tag} redaction: zone ${id} leaks foe cards`);
          }
        }
      }
    });
  });
}

async function lockText(page) {
  return page.locator('.lock-btn').innerText({ timeout: 5000 });
}

async function clickWithLog(page, selector, ctx, step) {
  logStep(ctx, `click ${selector}`, step);
  try {
    await page.locator(selector).click({ timeout: ACTION_TIMEOUT });
  } catch (err) {
    await saveFail(ctx, step, page, getFrames(ctx));
    throw err;
  }
}

async function waitWithLog(page, selector, ctx, step, opts = {}) {
  logStep(ctx, `wait ${selector}`, step);
  try {
    await page.waitForSelector(selector, { timeout: ACTION_TIMEOUT, ...opts });
  } catch (err) {
    await saveFail(ctx, step, page, getFrames(ctx));
    throw err;
  }
}

async function fillWithLog(page, selector, value, ctx, step) {
  logStep(ctx, `fill ${selector}`, step);
  try {
    await page.locator(selector).fill(value, { timeout: ACTION_TIMEOUT });
  } catch (err) {
    await saveFail(ctx, step, page, getFrames(ctx));
    throw err;
  }
}

async function gotoOnline(page, ctx) {
  logStep(ctx, `goto ${APP}`);
  await page.goto(APP, { waitUntil: 'networkidle' });
  await waitWithLog(page, '.title-screen', ctx, 'wait title');
  await clickWithLog(page, 'button:has-text("Play Online")', ctx, 'click play online');
  await waitWithLog(page, '.online-lobby', ctx, 'wait online lobby');
}

async function playTurn(page, ctx, tag, cards, zone = 'cool') {
  logStep(ctx, `turn ${tag} place ${cards}`);
  await waitWithLog(page, '.hand-fan', ctx, 'wait hand');
  for (let k = 0; k < cards; k++) {
    await clickWithLog(page, '.fan-card:first-child', ctx, `tap card ${k}`);
    await clickWithLog(page, `[data-zone="${zone}"]`, ctx, `tap zone ${zone}`);
    await page.waitForFunction(
      (expected) => document.querySelector('.lock-btn')?.textContent?.includes(expected),
      `(${k + 1}/2)`,
      { timeout: ACTION_TIMEOUT }
    );
  }
  await clickWithLog(page, '.lock-btn', ctx, 'lock');
}

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      reject(new Error(`Port ${port} is not free: ${err.message}`));
    });
    server.once('listening', () => {
      server.close(() => resolve());
    });
    server.listen(port);
  });
}

async function waitForHttp(url, method = 'GET', timeoutMs = 60000, expectedStatus = [200, 204]) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method });
      if (expectedStatus.includes(res.status)) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timeout waiting for ${method} ${url}`);
}

function killProcessTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${proc.pid} /t /f`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch {}
}

let devProc = null;
let previewProc = null;
let browser = null;

try {
  // Check ports are free first
  await assertPortFree(APP_PORT);
  await assertPortFree(ROOM_PORT);

  // Spawn Vite preview
  const viteBin = path.resolve('node_modules/vite/bin/vite.js');
  console.log('[STEP] Starting vite preview...');
  previewProc = spawn(
    process.execPath,
    [viteBin, 'preview', '--port', String(APP_PORT), '--strictPort'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  await waitForHttp(APP, 'GET', 30000, [200]);
  console.log('[STEP] vite preview ready');

  // Spawn Wrangler dev
  console.log('[STEP] Starting wrangler dev...');
  devProc = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['wrangler', 'dev', '--port', String(ROOM_PORT)],
    {
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  devProc.stdout?.on('data', (d) => {
    const s = d.toString();
    if (s.includes('Ready') || s.includes('error') || s.includes('Error')) {
      console.log(`[wrangler] ${s.trim()}`);
    }
  });
  devProc.stderr?.on('data', (d) => {
    console.error(`[wrangler err] ${d.toString().trim()}`);
  });
  const roomApiUrl = `http://127.0.0.1:${ROOM_PORT}/api/rooms`;
  await waitForHttp(roomApiUrl, 'OPTIONS', 90000, [204, 200]);
  console.log('[STEP] wrangler dev ready & HTTP responsive');

  const viewport = { width: 720, height: 480 };
  console.log(
    `[STEP] Launching browser (headed=${HEADED}), viewport ${viewport.width}x${viewport.height}`
  );
  browser = await chromium.launch({ headless: !HEADED });
  const ctxA = await browser.newContext({ viewport });
  const ctxB = await browser.newContext({ viewport });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  watch(pageA, 'A', framesA);
  watch(pageB, 'B', framesB);

  // ctx1: Play Online -> Create
  console.log('--- ctx1: Play Online -> Create ---');
  await gotoOnline(pageA, 'ctx1');
  await fillWithLog(pageA, '.online-lobby > label input', 'Alice', 'ctx1', 'fill name');
  await clickWithLog(pageA, 'button:has-text("Create room")', 'ctx1', 'click create');
  await waitWithLog(pageA, '.online-waiting', 'ctx1', 'wait waiting');
  const code = (await pageA.locator('.online-room-code').innerText({ timeout: 5000 })).trim();
  console.log(`room code: ${code}`);
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error(`bad code "${code}"`);

  // ctx2: Play Online -> Join
  console.log('--- ctx2: Play Online -> Join ---');
  await gotoOnline(pageB, 'ctx2');
  await fillWithLog(pageB, '.online-lobby > label input', 'Bob', 'ctx2', 'fill name');
  await fillWithLog(pageB, '.online-join input', code, 'ctx2', 'fill code');
  await clickWithLog(pageB, 'button:has-text("Join room")', 'ctx2', 'click join');
  await waitWithLog(pageB, '.hand-fan', 'ctx2', 'wait hand B');
  await waitWithLog(pageA, '.hand-fan', 'ctx1', 'wait hand A');
  console.log('both seated');

  for (let r = 0; r < 3; r++) {
    await playTurn(pageA, 'ctx1', `A r${r + 1}`, 2);
    await playTurn(pageB, 'ctx2', `B r${r + 1}`, 1);
    logStep('ctx1', `wait reveal/result r${r + 1}`);
    await waitWithLog(pageA, '.reveal-dock, .resolution-panel', 'ctx1', 'wait reveal A');
    await waitWithLog(pageB, '.reveal-dock, .resolution-panel', 'ctx2', 'wait reveal B');
    if (r === 1) {
      logStep('ctx2', 'mid-match reload');
      await pageB.reload({ waitUntil: 'networkidle' });
      await waitWithLog(pageB, '.title-screen', 'ctx2', 'wait title after reload');
      await clickWithLog(pageB, 'button:has-text("Rejoin your match")', 'ctx2', 'click rejoin');
      await waitWithLog(pageB, '.hand-fan, .reveal-dock', 'ctx2', 'wait hand/reveal B');
      console.log('B reloaded and resumed');
    }
    if (r < 2) {
      logStep('ctx1', 'next round');
      await clickWithLog(pageA, '.reveal-dock .btn', 'ctx1', 'next round A');
      await clickWithLog(pageB, '.reveal-dock .btn', 'ctx2', 'next round B');
      await waitWithLog(pageA, '.hand-fan', 'ctx1', 'wait hand A');
      await waitWithLog(pageB, '.hand-fan', 'ctx2', 'wait hand B');
      console.log(`advanced to round ${r + 2}`);
    }
  }

  await waitWithLog(pageA, '.resolution-panel', 'ctx1', 'wait resolution');
  await waitWithLog(pageA, '.review-dock', 'ctx1', 'wait review A', { timeout: 25000 });
  await waitWithLog(pageB, '.review-dock', 'ctx2', 'wait review B', { timeout: 25000 });
  console.log('both at review');

  await clickWithLog(pageA, '.review-actions .btn-primary', 'ctx1', 'rematch A');
  await waitWithLog(pageA, '.toast-notice', 'ctx1', 'wait toast A');
  console.log('A waiting for rematch');
  await clickWithLog(pageB, '.review-actions .btn-primary', 'ctx2', 'rematch B');
  await waitWithLog(pageA, '.hand-fan', 'ctx1', 'wait hand A rematch');
  await waitWithLog(pageB, '.hand-fan', 'ctx2', 'wait hand B rematch');
  console.log('rematch restarted for both');
  console.log(`frames captured: A=${framesA.length} B=${framesB.length}`);
  if (framesA.length === 0 || framesB.length === 0) throw new Error('no view frames captured');
} catch (e) {
  const msg = `RUN ERROR: ${String(e).split('\n')[0]}`;
  console.error(`FAIL ${msg}`);
  failures.push(msg);
  try {
    const dir = `smoke-online-fail/error-${Date.now()}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/error.txt`, String(e.stack || e));
    writeFileSync(`${dir}/steps.log`, stepLogs.join('\n'));
  } catch {}
} finally {
  try {
    await browser?.close();
  } catch {}
  if (devProc) killProcessTree(devProc);
  if (previewProc) killProcessTree(previewProc);
}

if (failures.length > 0) {
  console.error(`SMOKE-ONLINE FAILED: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('SMOKE-ONLINE PASSED');

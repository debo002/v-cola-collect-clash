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
          // Hidden-info rule: current boards carry NOTHING about the
          // opponent — no cards, no backs, no counts. Only `mine` may exist.
          if ('foeCount' in zone || 'foe' in zone) {
            failures.push(`${tag} hidden-info leak: zone ${id} exposes opponent data`);
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
      `(${k + 1}/`,
      { timeout: ACTION_TIMEOUT }
    );
  }
  await clickWithLog(page, '.lock-btn', ctx, 'lock');
}

/** Current-round data of the victim's latest frame, for leak comparison. */
function victimCurrentJson(frames) {
  const placing = [...frames].reverse().find((f) => f.view.phase === 'placing');
  if (!placing) return null;
  const current = (placing.view.boards ?? []).filter((b) => b.kind === 'current');
  return JSON.stringify({
    boards: current,
    locks: placing.view.locks,
    opponentHandCount: placing.view.opponentHandCount,
    drawsRemaining: placing.view.drawsRemaining,
    drawPileCount: placing.view.drawPileCount ?? null,
    deadlineMs: placing.view.deadlineMs,
  });
}

async function settle(page, ms = 800) {
  await page.waitForTimeout(ms);
}

/**
 * Hidden-info probe: the actor places (and recalls) cards while the victim
 * watches. The victim's received frames must carry NO change in
 * current-round data (the server only sends a view frame when that seat's
 * serialized view changed).
 */
async function probeHiddenInfo(actorPage, actorCtx, victimFrames, victimTag, placements) {
  const before = victimFrames.length;
  const beforeJson = victimCurrentJson(victimFrames);
  for (const [card, zone] of placements) {
    void card;
    await clickWithLog(actorPage, '.fan-card:first-child', actorCtx, 'probe tap card');
    await clickWithLog(actorPage, `[data-zone="${zone}"]`, actorCtx, `probe tap zone ${zone}`);
  }
  await settle(actorPage);
  if (victimFrames.length !== before) {
    throw new Error(
      `${victimTag} received ${victimFrames.length - before} frame(s) while opponent placed cards`
    );
  }
  // Recall everything the probe placed, then verify silence again.
  for (let k = 0; k < placements.length; k++) {
    logStep(actorCtx, 'click .recallable(first)', `probe recall ${k}`);
    try {
      await actorPage.locator('.recallable').first().click({ timeout: ACTION_TIMEOUT });
    } catch (err) {
      await saveFail(actorCtx, `probe recall ${k}`, actorPage, victimFrames);
      throw err;
    }
  }
  await actorPage.waitForFunction(
    () => !document.querySelector('.lock-btn')?.textContent?.includes('/'),
    null,
    { timeout: ACTION_TIMEOUT }
  );
  await settle(actorPage);
  if (victimFrames.length !== before) {
    throw new Error(`${victimTag} received frames while opponent recalled cards`);
  }
  const afterJson = victimCurrentJson(victimFrames);
  if (beforeJson !== afterJson) {
    throw new Error(`${victimTag} current-round data changed while opponent acted`);
  }
  console.log(
    `[STEP] hidden-info probe passed (${placements.length} place + recall, no victim delta)`
  );
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
  await clickWithLog(pageA, 'button:has-text("Create Quick Room")', 'ctx1', 'click create quick');
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
  await waitWithLog(pageB, '.settings-review', 'ctx2', 'wait settings preview B');
  await clickWithLog(pageB, 'button:has-text("Accept")', 'ctx2', 'click accept B');
  await waitWithLog(pageB, '.hand-fan', 'ctx2', 'wait hand B');
  await waitWithLog(pageA, '.hand-fan', 'ctx1', 'wait hand A');
  console.log('both seated');

  // Hidden-info probe (quick): A places 1 card, then recalls it. B's
  // received frames must carry no change in current-round data.
  await probeHiddenInfo(pageA, 'ctx1', framesB, 'B', [['x', 'cool']]);

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

  // Hidden-info assertion: B's flavor IDs must not appear in the CURRENT
  // boards of A's placing-phase frames. (Revealed past rounds legitimately
  // name B's cards; scanning whole frames would false-positive there.)
  // Collect all flavors A could legitimately see in its own hand across all frames.
  const aKnownFlavors = new Set();
  for (const frame of framesA) {
    for (const card of frame.view.hand ?? []) aKnownFlavors.add(card.flavor);
    for (const board of frame.view.boards ?? []) {
      if (board.kind !== 'current') continue;
      for (const zone of Object.values(board.zones ?? {})) {
        for (const card of zone.mine ?? []) aKnownFlavors.add(card.flavor);
      }
    }
  }
  // Collect all flavors that appeared in B's hand but never in A's known set.
  const bOnlyFlavors = new Set();
  for (const frame of framesB) {
    for (const card of frame.view.hand ?? []) {
      if (!aKnownFlavors.has(card.flavor)) bOnlyFlavors.add(card.flavor);
    }
  }
  // Scan only the current boards of A's placing-phase frames.
  for (const frame of framesA) {
    if (frame.view.phase !== 'placing') continue;
    const current = (frame.view.boards ?? []).filter((b) => b.kind === 'current');
    const text = JSON.stringify(current);
    for (const flavor of bOnlyFlavors) {
      if (text.includes(`"flavor":"${flavor}"`)) {
        failures.push(`Hidden-info: A's current board leaks B-only flavor "${flavor}"`);
      }
    }
  }
  console.log(
    `[STEP] Hidden-info assertion: ${bOnlyFlavors.size} B-only flavor(s) checked across ${framesA.filter((f) => f.view.phase === 'placing').length} placing frame(s)`
  );

  // ── RUN 2: Custom Game Run (draw-per-round, 2 draws per round) ──────────────
  console.log('--- Custom Game run (draw-per-round, 2 draws per round) ---');
  const ctxA_c = await browser.newContext({ viewport });
  const ctxB_c = await browser.newContext({ viewport });
  const pageA_c = await ctxA_c.newPage();
  const pageB_c = await ctxB_c.newPage();
  const framesA_c = [];
  const framesB_c = [];
  watch(pageA_c, 'A-custom', framesA_c);
  watch(pageB_c, 'B-custom', framesB_c);

  // Host creates custom
  await gotoOnline(pageA_c, 'ctx1-custom');
  await fillWithLog(pageA_c, '.online-lobby > label input', 'Alice', 'ctx1-custom', 'fill name');
  await clickWithLog(
    pageA_c,
    'button:has-text("Custom Settings…")',
    'ctx1-custom',
    'click custom settings'
  );
  await waitWithLog(pageA_c, '.custom-setup', 'ctx1-custom', 'wait custom setup');
  await clickWithLog(
    pageA_c,
    'button:has-text("Draw per round")',
    'ctx1-custom',
    'select draw per round'
  );
  // 3 draws/round so round 1 can probe 3 placements in other zones.
  await clickWithLog(
    pageA_c,
    'button[aria-label="Draw each round +"]',
    'ctx1-custom',
    'raise draws to 3'
  );
  await clickWithLog(
    pageA_c,
    'button:has-text("Start Custom Game")',
    'ctx1-custom',
    'click start custom'
  );
  await waitWithLog(pageA_c, '.online-waiting', 'ctx1-custom', 'wait waiting');
  const customCode = (
    await pageA_c.locator('.online-room-code').innerText({ timeout: 5000 })
  ).trim();
  console.log(`custom room code: ${customCode}`);
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(customCode)) throw new Error(`bad custom code "${customCode}"`);

  // Host waiting text check: "Waiting for an opponent to join"
  const hostWaiting = (
    await pageA_c.locator('.online-waiting p[role="status"]').first().innerText()
  ).trim();
  console.log(`host waiting text: "${hostWaiting}"`);
  if (!hostWaiting.includes('Waiting for an opponent to join')) {
    throw new Error(
      `expected host waiting text "Waiting for an opponent to join", got "${hostWaiting}"`
    );
  }

  // Joiner enters code
  await gotoOnline(pageB_c, 'ctx2-custom');
  await fillWithLog(pageB_c, '.online-lobby > label input', 'Bob', 'ctx2-custom', 'fill name');
  await fillWithLog(pageB_c, '.online-join input', customCode, 'ctx2-custom', 'fill code');
  await clickWithLog(pageB_c, 'button:has-text("Join room")', 'ctx2-custom', 'click join');

  // Joiner sees settings screen BEFORE any match frames exist
  await waitWithLog(pageB_c, '.settings-review', 'ctx2-custom', 'wait settings screen');
  if (framesB_c.length !== 0) {
    throw new Error(`Bob received ${framesB_c.length} WS frames before accepting settings!`);
  }
  console.log(
    '[STEP] Joiner sees settings screen BEFORE any match frames exist (0 frames verified)'
  );

  // Joiner accepts
  await clickWithLog(pageB_c, 'button:has-text("Accept")', 'ctx2-custom', 'click accept settings');
  await waitWithLog(pageB_c, '.hand-fan', 'ctx2-custom', 'wait hand B');
  await waitWithLog(pageA_c, '.hand-fan', 'ctx1-custom', 'wait hand A');
  console.log('both seated in custom match');

  // Draw helper (stops early when the pile is empty):
  async function performDraw(page, ctxTag, count = 2) {
    for (let d = 0; d < count; d++) {
      logStep(ctxTag, `draw ${d + 1}/${count}`);
      const btn = page.locator('.draw-pile');
      await btn.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT });
      if (await btn.isDisabled()) {
        logStep(ctxTag, 'draw pile empty, stop');
        break;
      }
      await btn.click({ timeout: ACTION_TIMEOUT });
      await page.waitForTimeout(800);
    }
  }

  // 3 rounds of custom match
  for (let r = 0; r < 3; r++) {
    // Both draw up to 3 cards
    await performDraw(pageA_c, 'ctx1-custom', 3);
    await performDraw(pageB_c, 'ctx2-custom', 3);

    // Hidden-info probe (custom, round 1): A places 3 cards in other zones,
    // then recalls them. B's frames must carry no change.
    if (r === 0) {
      await probeHiddenInfo(pageA_c, 'ctx1-custom', framesB_c, 'B-custom', [
        ['x', 'party'],
        ['x', 'energy'],
        ['x', 'cool'],
      ]);
    }

    // Both place cards and lock
    await playTurn(pageA_c, 'ctx1-custom', `A-c r${r + 1}`, 2);
    await playTurn(pageB_c, 'ctx2-custom', `B-c r${r + 1}`, 1);

    logStep('ctx1-custom', `wait reveal/result r${r + 1}`);
    await waitWithLog(pageA_c, '.reveal-dock, .resolution-panel', 'ctx1-custom', 'wait reveal A');
    await waitWithLog(pageB_c, '.reveal-dock, .resolution-panel', 'ctx2-custom', 'wait reveal B');

    // Mid-match reload at round 2
    if (r === 1) {
      logStep('ctx2-custom', 'mid-match reload B');
      await pageB_c.reload({ waitUntil: 'networkidle' });
      await waitWithLog(pageB_c, '.title-screen', 'ctx2-custom', 'wait title after reload');
      await clickWithLog(
        pageB_c,
        'button:has-text("Rejoin your match")',
        'ctx2-custom',
        'click rejoin'
      );
      await waitWithLog(pageB_c, '.hand-fan, .reveal-dock', 'ctx2-custom', 'wait hand/reveal B');
      console.log('B reloaded and resumed in custom match');
    }

    if (r < 2) {
      logStep('ctx1-custom', 'next round');
      await clickWithLog(pageA_c, '.reveal-dock .btn', 'ctx1-custom', 'next round A');
      await clickWithLog(pageB_c, '.reveal-dock .btn', 'ctx2-custom', 'next round B');
      await waitWithLog(pageA_c, '.hand-fan', 'ctx1-custom', 'wait hand A');
      await waitWithLog(pageB_c, '.hand-fan', 'ctx2-custom', 'wait hand B');
      console.log(`custom advanced to round ${r + 2}`);
    }
  }

  await waitWithLog(pageA_c, '.resolution-panel', 'ctx1-custom', 'wait resolution');
  await waitWithLog(pageA_c, '.review-dock', 'ctx1-custom', 'wait review A', { timeout: 25000 });
  await waitWithLog(pageB_c, '.review-dock', 'ctx2-custom', 'wait review B', { timeout: 25000 });
  console.log('both at review in custom match');

  // Both Rematch
  await clickWithLog(pageA_c, '.review-actions .btn-primary', 'ctx1-custom', 'rematch A');
  await waitWithLog(pageA_c, '.toast-notice', 'ctx1-custom', 'wait toast A');
  console.log('A waiting for rematch in custom match');
  await clickWithLog(pageB_c, '.review-actions .btn-primary', 'ctx2-custom', 'rematch B');
  await waitWithLog(pageA_c, '.hand-fan', 'ctx1-custom', 'wait hand A rematch');
  await waitWithLog(pageB_c, '.hand-fan', 'ctx2-custom', 'wait hand B rematch');
  console.log('rematch restarted for both in custom match');
  console.log(`custom frames captured: A=${framesA_c.length} B=${framesB_c.length}`);
  if (framesA_c.length === 0 || framesB_c.length === 0)
    throw new Error('no custom view frames captured');
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

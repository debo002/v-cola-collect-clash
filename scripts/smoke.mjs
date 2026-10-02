/* Full-match smoke: menu -> pass -> 3 rounds -> resolution -> result -> rematch/menu.
 * Run: `npm run smoke` with `npm run preview -- --port 4173` serving.
 * Fails on console errors, page overflow, or stuck states. Exits non-zero.
 */
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_URL || 'http://localhost:4173/';
const VIEWPORTS = [
  { w: 720, h: 480 },
  { w: 1100, h: 480 },
];

let failures = 0;
function fail(label, detail) {
  failures++;
  console.error(`FAIL ${label}: ${detail}`);
}
function pass(label) {
  console.log(`ok ${label}`);
}

async function checkOverflow(page, label) {
  const o = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    sh: document.documentElement.scrollHeight,
    ih: window.innerHeight,
  }));
  if (o.sw > o.iw + 1 || o.sh > o.ih + 1) {
    fail(label, `overflow doc=${o.sw}x${o.sh} win=${o.iw}x${o.ih}`);
  }
}

async function step(page, label, fn) {
  try {
    await fn();
  } catch (e) {
    fail(label, `stuck: ${String(e).split('\n')[0]}`);
    throw e;
  }
  try {
    await checkOverflow(page, label);
  } catch (e) {
    fail(label, `check failed: ${String(e).split('\n')[0]}`);
    throw e;
  }
}

async function playMatch(page, tag, { skipResolution }) {
  const lockText = () => page.locator('.lock-btn').innerText();
  const zones = ['cool', 'cool', 'cool'];
  let helpChecked = false;

  await step(page, `${tag} title`, async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.title-screen', { timeout: 10000 });
    await page.locator('.menu-guide-btn').click();
    await page.waitForSelector('.help-sheet', { timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('.help-sheet', { state: 'hidden', timeout: 3000 });
  });

  if (tag.startsWith('ar')) {
    await step(page, `${tag} arabic`, async () => {
      await page.getByRole('button', { name: 'عربي' }).click();
      await page.waitForFunction(() => document.documentElement.dir === 'rtl', null, {
        timeout: 3000,
      });
    });
  }

  await step(page, `${tag} start`, async () => {
    await page.locator('.title-actions .btn-primary').click();
    await page.waitForSelector('.lookaway', { timeout: 5000 });
  });

  for (let r = 0; r < 3; r++) {
    for (const turn of ['A', 'B']) {
      await step(page, `${tag} r${r + 1}${turn} pass`, async () => {
        await page.waitForSelector('.lookaway', { timeout: 5000 });
        await page.locator('.lookaway .btn').click();
        await page.waitForSelector('.hand-fan', { timeout: 5000 });
      });

      if (turn === 'A' && r === 0 && !helpChecked) {
        await step(page, `${tag} help sheet`, async () => {
          const handCount = await page.locator('.fan-card').count();
          await page.locator('.legend-btn').click();
          await page.waitForSelector('.help-sheet', { timeout: 3000 });
          if ((await page.locator('.guide-zone').count()) !== 3)
            throw new Error('zone guide is incomplete');
          await page.locator('.guide-tabs button').nth(1).click();
          if ((await page.locator('.guide-combo').count()) !== 5)
            throw new Error('combo guide is incomplete');
          await page.locator('.guide-tabs button').nth(2).click();
          if ((await page.locator('.guide-card-tile').count()) !== 11)
            throw new Error('card guide is incomplete');
          await page.locator('.guide-card-tile').nth(8).click();
          if (!(await page.locator('.guide-card-detail img').count()))
            throw new Error('card detail art is missing');
          await page.locator('.guide-tabs button').nth(3).click();
          if (!(await page.locator('.guide-board-card img').count()))
            throw new Error('board example art is missing');
          await page.locator('.guide-tabs button').nth(0).click();
          await page.keyboard.press('Escape');
          await page.waitForSelector('.help-sheet', { state: 'hidden', timeout: 3000 });
          await page.locator('.fan-card').first().hover();
          await page.mouse.down();
          await page.waitForTimeout(300);
          if (await page.locator('.card-preview').count())
            throw new Error('preview opened before a long hold');
          await page.waitForTimeout(450);
          await page.waitForSelector('.card-preview', { timeout: 2000 });
          if (!(await page.locator('.card-preview .preview-member img').count()))
            throw new Error('held-card group art is missing');
          await page.mouse.up();
          await page.locator('.fan-card').nth(1).hover();
          await page.mouse.down();
          await page.waitForTimeout(750);
          if ((await page.locator('.card-preview').count()) !== 1)
            throw new Error('more than one card tooltip is visible');
          await page.mouse.up();
          await page.keyboard.press('Escape');
          await page.waitForSelector('.card-preview', { state: 'hidden', timeout: 2000 });
          await page.locator('.zone-col').first().hover();
          await page.locator('.legend-btn').click();
          await page.locator('.help-backdrop').click({ position: { x: 8, y: 8 } });
          await page.waitForSelector('.help-sheet', { state: 'hidden', timeout: 3000 });
          if ((await page.locator('.fan-card').count()) !== handCount)
            throw new Error('help changed hand state');
          helpChecked = true;
        });
      }

      if (turn === 'A' && r === 0) {
        // Drag (pointer events) at scale < 1, then tap-to-place, then recall.
        await step(page, `${tag} drag-place`, async () => {
          await page.locator('.fan-card').nth(0).dragTo(page.locator('[data-zone="cool"]'));
          await page.waitForFunction(
            () => document.querySelector('.lock-btn')?.textContent?.includes('(1/2)'),
            null,
            { timeout: 3000 }
          );
          await page.waitForTimeout(500);
          const cardBox = await page
            .locator('[data-zone="cool"] .game-card.card-board')
            .first()
            .boundingBox();
          if (!cardBox || cardBox.width < 45 || cardBox.height < 70) {
            throw new Error(`placed card too small: ${JSON.stringify(cardBox)}`);
          }
        });
        await step(page, `${tag} tap-place`, async () => {
          await page.locator('.fan-card').nth(0).click();
          await page.locator('[data-zone="cool"]').click();
          const t = await lockText();
          if (!t.includes('(2/2)')) throw new Error(`lock shows "${t}"`);
        });
        await step(page, `${tag} recall`, async () => {
          await page.locator('.strip-mini.recallable').first().click();
          const t = await lockText();
          if (!t.includes('(1/2)')) throw new Error(`lock shows "${t}"`);
          await page.locator('.fan-card').nth(0).click();
          await page.locator('[data-zone="cool"]').click();
          const t2 = await lockText();
          if (!t2.includes('(2/2)')) throw new Error(`lock shows "${t2}"`);
        });
      } else {
        const n = turn === 'A' ? 2 : 1;
        const zone = turn === 'A' ? zones[r] : r === 1 ? 'energy' : 'party';
        await step(page, `${tag} r${r + 1}${turn} place${n}`, async () => {
          for (let k = 0; k < n; k++) {
            await page.locator('.fan-card').nth(0).click();
            await page.locator(`[data-zone="${zone}"]`).click();
          }
          const t = await lockText();
          if (!t.includes(`(${n}/2)`)) throw new Error(`lock shows "${t}"`);
        });
      }

      await step(page, `${tag} r${r + 1}${turn} lock`, async () => {
        await page.locator('.lock-btn').click();
        await page.waitForSelector('.lookaway, .reveal-dock, .resolution-panel', {
          timeout: 5000,
        });
      });
    }

    if (r < 2) {
      await step(page, `${tag} reveal${r + 1}`, async () => {
        await page.waitForSelector('.reveal-dock', { timeout: 5000 });
        await page.locator('.reveal-dock .btn').click();
        await page.waitForSelector('.lookaway', { timeout: 5000 });
      });
    }
  }

  await step(page, `${tag} resolution`, async () => {
    await page.waitForSelector('.resolution-panel', { timeout: 8000 });
    const cols = await page.locator('.resolution-panel .zone-col').count();
    if (cols !== 3) throw new Error(`expected 3 zone columns, saw ${cols}`);
    const opponentCard = page.locator('.resolution-panel .foe-strip .game-card').first();
    await opponentCard.hover();
    await page.mouse.down();
    await page.waitForSelector('.card-preview', { timeout: 3000 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await page.waitForSelector('.card-preview', { state: 'hidden', timeout: 2000 });
    if (skipResolution) {
      if (await page.locator('.skip-btn').count()) await page.locator('.skip-btn').click();
    } else {
      // Tap once mid-sequence to prove tap-to-speed never breaks completion.
      await page.waitForTimeout(2500);
      await page.locator('.resolution-panel .zones-row').click();
    }
    await page.waitForSelector('.review-dock', { timeout: 25000 });
    if (skipResolution) {
      await page.locator('.resolution-panel .zone-col').first().click();
      await page.waitForSelector('.review-dock', { state: 'hidden', timeout: 1000 });
      await page.waitForSelector('.review-dock', { timeout: 3000 });
    }
    if (!skipResolution) {
      await page.locator('.resolution-panel .zone-col').first().click();
      await page.waitForSelector('.skip-btn', { timeout: 3000 });
      await page.locator('.skip-btn').click();
      await page.waitForSelector('.review-dock', { timeout: 3000 });
    }
  });

  await step(page, `${tag} rematch`, async () => {
    await page.locator('.review-actions .btn-primary').click();
    await page.waitForSelector('.lookaway', { timeout: 5000 });
  });

  await step(page, `${tag} menu`, async () => {
    await page.locator('.game-topbar .icon-btn').first().click();
    await page.waitForSelector('.title-screen', { timeout: 5000 });
  });

  pass(`${tag} full match`);
}

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
      if (m.type() === 'warning') console.log(`warn ${vp.w}x${vp.h}: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    try {
      await playMatch(page, `en-${vp.w}x${vp.h}`, { skipResolution: false });
    } catch {
      // Already recorded via fail(); continue to collect console state.
    }
    if (errors.length > 0) fail(`en-${vp.w}x${vp.h} console`, errors.join(' | '));
    await ctx.close();
  }

  // Arabic full match with reduced motion at the minimum landscape stage width.
  {
    const ctx = await browser.newContext({
      viewport: { width: 720, height: 480 },
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    try {
      await playMatch(page, 'ar-720x480-reduced', { skipResolution: true });
    } catch {
      // Recorded already.
    }
    if (errors.length > 0) fail('ar-720x480-reduced console', errors.join(' | '));
    await ctx.close();
  }

  // Portrait gate.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    try {
      await step(page, 'portrait gate', async () => {
        await page.goto(BASE, { waitUntil: 'networkidle' });
        await page.waitForSelector('.rotate-gate', { timeout: 10000 });
      });
      pass('portrait gate');
    } catch {
      // Recorded already.
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`SMOKE FAILED: ${failures} failure(s)`);
  process.exit(1);
}
console.log('SMOKE PASSED');

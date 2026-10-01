/* Landscape visual checks: menu, pass, placing (incl. 6-in-one-zone),
 * round reveal, each resolution step, match over, deck, portrait gate.
 * Run: `node scripts/shots.mjs` with `npm run preview -- --port 4173` serving.
 * Output: $SHOTS_DIR or ./screenshots (gitignored via screenshots*).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.SHOTS_URL || 'http://localhost:4173/';
const OUT = process.env.SHOTS_DIR || path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: '667x375', w: 667, h: 375 },
  { name: '844x390', w: 844, h: 390 },
  { name: '932x430', w: 932, h: 430 },
  { name: '1280x720', w: 1280, h: 720 },
  { name: '1920x1080', w: 1920, h: 1080 },
];

async function snap(page, file) {
  await page.screenshot({ path: path.join(OUT, file) });
  console.log('shot:', file);
}

async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    sh: document.documentElement.scrollHeight,
    ih: window.innerHeight,
  }));
  const ok = o.sw <= o.iw + 1 && o.sh <= o.ih + 1;
  console.log(`${label}: doc=${o.sw}x${o.sh} win=${o.iw}x${o.ih} ${ok ? 'OK' : 'OVERFLOW'}`);
}

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.title-screen', { timeout: 10000 });
    await snap(page, `menu-${vp.name}.png`);
    await noOverflow(page, `menu-${vp.name}`);

    // Deck: empty collection, then starter pack.
    await page.locator('.title-actions .btn-secondary').click();
    await page.waitForSelector('.deck-container', { timeout: 5000 });
    await snap(page, `deck-empty-${vp.name}.png`);
    const starter = page.getByRole('button', { name: /Starter Pack|حزمة البداية/ });
    if ((await starter.count()) > 0) {
      await starter.click();
      await page.waitForTimeout(300);
      await snap(page, `deck-stocked-${vp.name}.png`);
    }
    await page.getByRole('button', { name: /Main Menu|القائمة الرئيسية/ }).click();
    await page.waitForSelector('.title-screen', { timeout: 5000 });

    // Full match: A stacks 2/round into COOL (6 by round 3), B singles elsewhere.
    await page.locator('.title-actions .btn-primary').click();
    await page.waitForSelector('.lookaway', { timeout: 5000 });
    await snap(page, `pass-${vp.name}.png`);

    const bZones = ['party', 'energy', 'party'];
    for (let r = 0; r < 3; r++) {
      for (const turn of ['A', 'B']) {
        await page.waitForSelector('.lookaway', { timeout: 8000 });
        await page.locator('.lookaway .btn').click();
        await page.waitForSelector('.hand-fan', { timeout: 5000 });
        const n = turn === 'A' ? 2 : 1;
        const zone = turn === 'A' ? 'cool' : bZones[r];
        for (let k = 0; k < n; k++) {
          await page.locator('.fan-card').nth(0).click();
          await page.locator(`[data-zone="${zone}"]`).click();
        }
        await page.locator('.lock-btn').click();
        await page.waitForSelector('.lookaway, .round-revealed-card, .resolution-panel', {
          timeout: 8000,
        });
      }
      if (r === 0) {
        // Back in for a placing screenshot next round is complex; capture
        // the round-1 reveal instead.
        await page.waitForSelector('.round-revealed-card', { timeout: 8000 });
        await snap(page, `reveal-r1-${vp.name}.png`);
        await noOverflow(page, `reveal-r1-${vp.name}`);
        await page.locator('.round-revealed-card .btn').click();
      } else if (r === 1) {
        await page.waitForSelector('.round-revealed-card', { timeout: 8000 });
        await page.locator('.round-revealed-card .btn').click();
      }
    }

    // Round-3 placing already locked; capture 6-in-COOL during resolution's
    // COOL step plus every resolution step + match over.
    await page.waitForSelector('.resolution-panel', { timeout: 8000 });
    await page.waitForTimeout(900);
    await snap(page, `res-cool-${vp.name}.png`);
    await page.waitForTimeout(2600);
    await snap(page, `res-party-${vp.name}.png`);
    await page.waitForTimeout(2900);
    await snap(page, `res-energy-${vp.name}.png`);
    await page.waitForSelector('.match-over-card', { timeout: 15000 });
    await snap(page, `matchover-${vp.name}.png`);
    await noOverflow(page, `matchover-${vp.name}`);
    await ctx.close();
  }

  // Arabic pass at 844x390 + portrait rotate gate.
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.title-screen', { timeout: 10000 });
    await page.getByRole('button', { name: 'عربي' }).click();
    await page.waitForTimeout(300);
    await snap(page, 'menu-ar-844x390.png');
    await page.locator('.title-actions .btn-primary').click();
    await page.waitForSelector('.lookaway', { timeout: 5000 });
    await snap(page, 'pass-ar-844x390.png');
    await page.locator('.lookaway .btn').click();
    await page.waitForSelector('.hand-fan', { timeout: 5000 });
    await page.locator('.fan-card').nth(0).click();
    await page.locator('[data-zone="energy"]').click();
    await page.waitForTimeout(300);
    await snap(page, 'placing-ar-844x390.png');
    await noOverflow(page, 'placing-ar-844x390');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.rotate-gate', { timeout: 10000 });
    await snap(page, 'portrait-rotate-390x844.png');
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log('done ->', OUT);

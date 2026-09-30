/* Step-3 visual checks: menu, pass, placing (tap-placed) at 360/390/430 + AR.
 * Run: `node scripts/shots.mjs` with `npm run preview -- --port 4173` serving.
 * Output: $SHOTS_DIR or ./screenshots (gitignored via dist-style temp).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.SHOTS_URL || 'http://localhost:4173/';
const OUT = process.env.SHOTS_DIR || path.resolve('screenshots-step3');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: '390x844', w: 390, h: 844 },
  { name: '360x640', w: 360, h: 640 },
  { name: '430x932', w: 430, h: 932 },
];

async function snap(page, file) {
  await page.screenshot({ path: path.join(OUT, file) });
  console.log('shot:', file);
}

async function noHScroll(page, label) {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
    fan: (() => {
      const el = document.querySelector('.hand-fan');
      return el ? { scroll: el.scrollWidth, client: el.clientWidth } : null;
    })(),
  }));
  const ok = overflow.doc <= overflow.win + 1;
  console.log(
    `${label}: docScroll=${overflow.doc} win=${overflow.win} hScroll=${ok ? 'OK' : 'OVERFLOW'}` +
      (overflow.fan ? ` fanScroll=${overflow.fan.scroll} fanClient=${overflow.fan.client}` : '')
  );
  return ok;
}

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.arena-hero, .mode-menu', { timeout: 10000 });
    await snap(page, `menu-${vp.name}.png`);

    // Start quick match (works with empty collection: loaner hand)
    await page.getByRole('button', { name: /Play Quick Match/ }).click();
    await page.waitForSelector('.lookaway', { timeout: 5000 });
    await snap(page, `pass-${vp.name}.png`);

    await page.getByRole('button', { name: /Reveal My Hand/ }).click();
    await page.waitForSelector('.hand-fan', { timeout: 5000 });
    await snap(page, `placing-empty-${vp.name}.png`);
    await noHScroll(page, `placing-empty-${vp.name}`);

    // Tap first card, tap COOL lane, then second card + PARTY lane
    const cards = page.locator('.fan-card');
    await cards.nth(0).click();
    await page.locator('[data-zone="cool"]').click();
    await cards.nth(0).click();
    await page.locator('[data-zone="party"]').click();
    await page.waitForTimeout(400);
    await snap(page, `placing-2cards-${vp.name}.png`);
    await noHScroll(page, `placing-2cards-${vp.name}`);

    const lockLabel = await page.locator('.lock-btn').innerText();
    console.log(`${vp.name}: lockBtn="${lockLabel}"`);
    await ctx.close();
  }

  // Arabic pass at 390
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.mode-menu', { timeout: 10000 });
    await page.getByRole('button', { name: 'عربي' }).click();
    await page.waitForTimeout(300);
    await snap(page, 'menu-ar-390x844.png');
    await page.getByRole('button', { name: /العب الآن/ }).click();
    await page.waitForSelector('.lookaway', { timeout: 5000 });
    await snap(page, 'pass-ar-390x844.png');
    await page.getByRole('button', { name: /عرض كروتي/ }).click();
    await page.waitForSelector('.hand-fan', { timeout: 5000 });
    const cards = page.locator('.fan-card');
    await cards.nth(0).click();
    await page.locator('[data-zone="energy"]').click();
    await page.waitForTimeout(400);
    await snap(page, 'placing-ar-390x844.png');
    await noHScroll(page, 'placing-ar-390x844');
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log('done ->', OUT);

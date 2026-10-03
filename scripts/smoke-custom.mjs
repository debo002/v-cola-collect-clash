/* Custom draw-per-round full-match check: 3 rounds x A/B, draws, reveal, replay, rematch, menu. */
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_URL || 'http://localhost:4173/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 480 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.title-screen', { timeout: 10000 });
await page.getByRole('button', { name: 'Custom Game' }).click();
await page.waitForSelector('.custom-setup', { timeout: 5000 });
await page.getByRole('button', { name: 'Draw per round' }).click();
await page.getByRole('button', { name: 'Start Custom Game' }).click();
for (let r = 0; r < 3; r++) {
  for (const turn of ['A', 'B']) {
    await page.waitForSelector('.lookaway', { timeout: 8000 });
    await page.locator('.lookaway .btn').click();
    await page.waitForSelector('.hand-fan', { timeout: 8000 });
    const drawBtn = page.locator('.draw-pile');
    for (let attempt = 0; attempt < 6; attempt++) {
      await page.waitForTimeout(900);
      let enabled = false;
      try {
        enabled = await drawBtn.isEnabled({ timeout: 1000 });
      } catch {
        enabled = false;
      }
      if (!enabled) break;
      await drawBtn.click();
    }
    await page.waitForTimeout(900);
    const n = turn === 'A' ? 2 : 1;
    for (let k = 0; k < n; k++) {
      await page.locator('.fan-card').nth(0).click();
      await page.locator('[data-zone="cool"]').click();
      await page.waitForTimeout(300);
    }
    const lockText = await page.locator('.lock-btn').innerText();
    console.log(`r${r + 1}${turn} lock: ${lockText}`);
    await page.locator('.lock-btn').click();
    await page.waitForSelector('.lookaway, .reveal-dock, .resolution-panel', { timeout: 8000 });
  }
  if (r < 2) {
    await page.waitForSelector('.reveal-dock', { timeout: 8000 });
    await page.locator('.reveal-dock .btn').click();
  }
}
await page.waitForSelector('.resolution-panel', { timeout: 10000 });
await page.waitForSelector('.review-dock', { timeout: 25000 });
console.log('reached review-dock');
await page.locator('.resolution-panel .zone-col').first().click();
await page.waitForTimeout(1500);
await page.locator('.review-actions .btn-primary').click();
await page.waitForSelector('.lookaway', { timeout: 8000 });
console.log('rematch ok');
await page.locator('.game-topbar .icon-btn').first().click();
await page.waitForSelector('.title-screen', { timeout: 8000 });
console.log('back to menu ok');
if (errors.length) {
  console.error(`CUSTOM CONSOLE ERRORS: ${errors.join(' | ')}`);
  process.exit(1);
}
console.log('CUSTOM DRAW MATCH PASSED');
await browser.close();

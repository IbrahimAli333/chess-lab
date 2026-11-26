// Screenshots of the site at laptop and phone size, for pull requests and for checking the layout by eye.
//   node shots.mjs [--out=screenshots] [--prefix=after]
// Uses the stand-in chess.com games from fixtures.mjs so the pictures are the same everywhere,
// reviews one of them with the real engine, then walks through the tabs.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';
import { mockChessCom } from './fixtures.mjs';

const arg = (n, d) => { const a = process.argv.find(a => a.startsWith('--' + n + '=')); return a ? a.split('=').slice(1).join('=') : d; };
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), arg('out', 'screenshots'));
const PRE = arg('prefix', 'after');
fs.mkdirSync(OUT, { recursive: true });
const local = await serve();
const browser = await chromium.launch();
const open = async (viewport, mobile, saved) => {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { if (!localStorage.getItem('ccr-user')) localStorage.setItem('ccr-user', 'ibrahimaliKH'); } catch (e) {} });
  await mockChessCom(page);
  if (saved) await page.addInitScript(s => { try { localStorage.setItem('ccr-games', s); } catch (e) {} }, saved);
  await page.goto(local.url);
  await page.waitForFunction(() => /Your last \d+ games/.test(document.getElementById('ccMsg').textContent));
  await page.evaluate(() => document.fonts.ready);
  return page;
};
const snap = (page, name, fullPage = false) => page.screenshot({ path: path.join(OUT, PRE + '-' + name + '.jpg'), type: 'jpeg', quality: 82, fullPage });
const done = page => page.waitForFunction(() => document.getElementById('ptx').textContent === 'Review complete', null, { timeout: 300000 });

// laptop
const lap = await open({ width: 1280, height: 800 }, false);
await snap(lap, 'laptop-1-load');
await lap.click('#ccList .h:nth-child(3) [data-cc]');          // a short loss as Black, with a missed mate threat
await lap.waitForFunction(() => /Analyzing move [5-9] of/.test(document.getElementById('ptx').textContent), null, { timeout: 120000 });
await snap(lap, 'laptop-2-analyzing');
await done(lap);
const walk = async (page, tag) => {
  await page.click('#bFirst');
  for (let n = 0; n < 2; n++) if (await page.isEnabled('#bNextM')) await page.click('#bNextM');
  await page.waitForTimeout(400);
  await snap(page, tag + '-3-review');
  if (tag === 'phone') await snap(page, tag + '-3-review-full', true);
  await page.click('#st-mist'); await page.waitForTimeout(200); await snap(page, tag + '-4-mistakes');
  await page.click('.tabs a[data-tab=progress]'); await page.waitForFunction(() => document.querySelectorAll('#work .th').length > 0); await page.waitForTimeout(200);
  await snap(page, tag + '-5-progress');
  await page.click('.tabs a[data-tab=openings]'); await page.waitForTimeout(700); await snap(page, tag + '-6-openings');
};
await walk(lap, 'laptop');
const saved = await lap.evaluate(() => localStorage.getItem('ccr-games'));

// phone, with the same saved game
const ph = await open({ width: 360, height: 740 }, true, saved);
await snap(ph, 'phone-1-load');
await ph.click('.tabs a[data-tab=progress]'); await ph.click('#hist [data-open]');
await walk(ph, 'phone');

await browser.close(); local.server.close();
console.log('Wrote ' + fs.readdirSync(OUT).filter(f => f.startsWith(PRE + '-')).length + ' screenshots to ' + OUT);

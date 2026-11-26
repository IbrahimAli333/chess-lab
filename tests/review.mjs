// End to end browser test for Chess Lab.
//   node review.mjs                 test the local files
//   node review.mjs --url=https://shimmering-cactus-e3b6fc.netlify.app/
//   node review.mjs --expect=stockfish-19-lite.js   (engine file that must load)
//   node review.mjs --block=stockfish-19 --expect=stockfish.js   (simulate a browser that cannot load the new engine)
//   node review.mjs --headed
//   node review.mjs --mock          (never call chess.com, always use the stand-in games from fixtures.mjs)
// The chess.com API and Google Fonts are outside this repo. When this machine cannot reach
// them (a sandbox, CI), the chess.com list is answered from fixtures.mjs and the font check
// is skipped. Everything else runs the same either way.
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
import { mockChessCom } from './fixtures.mjs';

const arg = n => (process.argv.find(a => a.startsWith('--' + n + '=')) || '').split('=').slice(1).join('=');
const flag = n => process.argv.includes('--' + n);
let failed = 0;
const check = (ok, msg, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + msg + (extra ? '  [' + extra + ']' : '')); if (!ok) failed++; };

let local = null, url = arg('url');
if (!url) { local = await serve(); url = local.url; }
const browser = await chromium.launch({ headless: !flag('headed') });

// Can this machine reach the two outside services? Asked from a real page, so proxies and CORS count.
const probe = await browser.newPage();
await probe.goto(url, { waitUntil: 'domcontentloaded' });
const reach = await probe.evaluate(async () => {
  const ok = async u => { try { const c = new AbortController(); setTimeout(() => c.abort(), 10000); return (await fetch(u, { signal: c.signal })).ok; } catch (e) { return false; } };
  return { cc: await ok('https://api.chess.com/pub/player/hikaru'), fonts: await ok('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&display=swap') };
});
await probe.close();
const mockCC = flag('mock') || !reach.cc;
if (mockCC) console.log('NOTE  chess.com API ' + (flag('mock') ? 'not called (--mock)' : 'is not reachable from here') + ': the recent games list is answered from fixtures.mjs');
if (!reach.fonts) console.log('NOTE  Google Fonts is not reachable from here: the font check is skipped');

const page = await browser.newPage();
if (mockCC) await mockChessCom(page);
if (!reach.fonts) await page.route(u => /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname), r => r.fulfill({ status: 200, contentType: 'text/css', headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }));
const reqs = [], bad = [], errors = [];
if (arg('block')) await page.route(u => u.pathname.includes(arg('block')), r => r.abort());
page.on('request', r => reqs.push(r.url()));
page.on('requestfailed', r => bad.push(r.url() + ' ' + (r.failure() || {}).errorText));
page.on('response', r => { if (r.status() >= 400) bad.push(r.url() + ' ' + r.status()); });
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url, { waitUntil: 'load' });
const isolated = await page.evaluate(() => self.crossOriginIsolated);
console.log('URL ' + url + '   crossOriginIsolated=' + isolated);
const expectEngine = arg('expect') || (isolated ? 'stockfish-19-lite.js' : 'stockfish-19-lite-single.js');

// Google Fonts and the chess.com API must both work (also under COEP).
await page.waitForFunction(() => /Your last \d+ games|No recent games|Couldn't reach/.test(document.getElementById('ccMsg').textContent), null, { timeout: 30000 });
const ccMsg = await page.textContent('#ccMsg');
check(/Your last \d+ games/.test(ccMsg), (mockCC ? 'recent games list renders (mocked chess.com API)' : 'chess.com API loads recent games'), ccMsg);
await page.evaluate(() => document.fonts.ready);
if (reach.fonts) {
  const font = await page.evaluate(() => document.fonts.check('600 16px Manrope') && [...document.fonts].some(f => /Manrope/.test(f.family) && f.status === 'loaded'));
  check(font, 'Google Font (Manrope) loads');
}

// Full review of the built-in example game.
const t0 = Date.now();
await page.click('#exBtn');
await page.waitForFunction(() => document.getElementById('ptx').textContent === 'Review complete', null, { timeout: 240000 });
const secs = (Date.now() - t0) / 1000;
const engines = reqs.filter(u => /stockfish[^/]*\.(js|wasm)/.test(u)).map(u => u.split('/').pop().split('#')[0]);
console.log('Engine files requested: ' + [...new Set(engines)].join(', '));
check(engines.includes(expectEngine), expectEngine + ' was loaded');
if (expectEngine !== 'stockfish.js') check(!engines.includes('stockfish.js'), 'the stockfish.js fallback was not needed');
const engName = await page.textContent('#engName').catch(() => '');
console.log('Engine shown in footer: ' + engName);
check(secs < 90, 'full review finished in under 90 seconds', secs.toFixed(1) + 's for 56 plies');

// Every move has a rating badge and the counts add up.
const NAMES = ['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Miss', 'Blunder'];
const moves = await page.$$eval('#ml .mb', bs => bs.map(b => ({ san: b.lastChild.textContent, sym: (b.querySelector('.dot') || {}).textContent || '' })));
check(moves.length === 56 && moves.every(m => m.sym), 'all 56 moves have a rating badge', moves.filter(m => m.sym).length + ' rated');
const counts = await page.$$eval('#counts .r', rs => rs.slice(1).map(r => [r.children[0].lastChild.textContent, +r.children[1].textContent, +r.children[2].textContent]));
const total = counts.reduce((a, c) => a + c[1] + c[2], 0);
check(counts.length === 10 && counts.every((c, k) => c[0] === NAMES[k]) && total === 56, 'move ratings table lists all 10 ratings and sums to 56', counts.filter(c => c[1] + c[2]).map(c => c[0] + ' ' + (c[1] + c[2])).join(', '));
const acc = [await page.textContent('#accMe'), await page.textContent('#accOpp')];
check(acc.every(a => /^\d+\.\d$/.test(a)), 'accuracy shown for both players', acc.join(' / '));

// The review is saved under the unchanged localStorage key and shape.
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ccr-games') || '[]'));
const KEYS = ['id', 'white', 'black', 'welo', 'belo', 'result', 'me', 'opening', 'date', 'san', 'ev', 'w2', 'best', 'cls', 'loss', 'pv', 'coach', 'savedAt', 'fen0'];
check(saved.length === 1 && KEYS.every(k => k in saved[0]) && Object.keys(saved[0]).length === KEYS.length, 'game saved in localStorage ccr-games with the same fields');

// "Show the best line": 20 legal plies, checked with chess.js.
let lineOk = false, lineInfo = 'no move with a best line button found';
const explained = [];
for (let k = 1; k <= moves.length; k++) {
  await page.click('#ml .mb[data-i="' + k + '"]');
  const ex = await page.$eval('#note', n => (n.querySelector('.why') || {}).textContent || '');
  if (ex) explained.push(Math.ceil(k / 2) + (k % 2 ? '. ' : '... ') + moves[k - 1].san + ': ' + ex);
  if (lineOk || !(await page.$('#lineBtn'))) continue;
  await page.click('#lineBtn');
  await page.waitForFunction(() => document.getElementById('backBtn') && !/extending/.test(document.getElementById('note').textContent), null, { timeout: 60000 });
  const sans = await page.$$eval('#note .vm', bs => bs.map(b => b.textContent));
  const res = await page.evaluate(({ pgnMoves, k, sans }) => {
    const c = new Chess(); for (let j = 0; j < k - 1; j++) c.move(pgnMoves[j]);
    let n = 0; for (const s of sans) { if (!c.move(s)) return { n, bad: s }; n++; }
    return { n, over: c.game_over() };
  }, { pgnMoves: moves.map(m => m.san), k, sans });
  lineInfo = 'instead of move ' + k + ' (' + moves[k - 1].san + '): ' + sans.join(' ');
  lineOk = !res.bad && (res.n === 20 || res.over);
  check(lineOk, 'best line has ' + res.n + ' legal plies' + (res.over ? ' (ends in mate or draw)' : ''), lineInfo);
  await page.click('#backBtn');
}
if (!lineOk && lineInfo.startsWith('no move')) check(false, lineInfo);
check(explained.length > 0 && explained.every(e => / [A-Z].*\.$/.test(e)), 'mistakes come with a one-sentence explanation', explained.length + ' explained');
if (explained.length) console.log('Explanations:\n  ' + explained.join('\n  '));

const text = await page.evaluate(() => document.body.innerText);
check(!/\u2014/.test(text), 'no em dashes in the page text');
if (!arg('block')) {
  check(bad.length === 0, 'no failed network requests', bad.join(' | '));
  check(errors.length === 0, 'no console errors', errors.join(' | '));
}

await browser.close();
if (local) local.server.close();
console.log(failed ? '\n' + failed + ' check(s) failed' : '\nAll checks passed');
process.exit(failed ? 1 : 0);

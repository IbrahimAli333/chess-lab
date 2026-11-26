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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
// Netlify deploy previews inject their own review toolbar from app.netlify.com. It is not on the
// live site and the isolation headers block it, so it is left out of the failed request check.
const preview = u => /^https:\/\/app\.netlify\.com\//.test(u);
page.on('requestfailed', r => { if (!preview(r.url())) bad.push(r.url() + ' ' + (r.failure() || {}).errorText); });
page.on('response', r => { if (r.status() >= 400 && !preview(r.url())) bad.push(r.url() + ' ' + r.status()); });
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

// Top-level navigation: four tabs, one section visible at a time, the loader open on a first visit.
const shown = () => page.evaluate(() => ['review', 'puzzles', 'openings', 'progress'].filter(id => !document.getElementById(id).hidden).join(','));
const current = () => page.$$eval('.tabs a[aria-current=page]', as => as.map(a => a.dataset.tab).join(','));
check(await page.$$eval('.tabs a', as => as.map(a => a.dataset.tab).join(',')) === 'review,puzzles,openings,progress' && await shown() === 'review' && await current() === 'review', 'four tabs, Review open first');
check(await page.isVisible('#loader') && await page.isVisible('#ccList [data-cc]') && await page.isVisible('#pgn') && await page.isVisible('#goBtn'), 'loader with recent games and paste box is visible on a first visit');
await page.click('.tabs a[data-tab=openings]');
check(await shown() === 'openings' && await current() === 'openings' && await page.isVisible('#tboard') && (await page.$$('#lines .ln')).length > 5, 'Openings tab shows the trainer');
await page.click('.tabs a[data-tab=progress]');
check(await shown() === 'progress' && await page.isVisible('#stats') && await page.isVisible('#work'), 'Progress tab shows stats and what to work on');
await page.goBack();
check(await shown() === 'openings', 'the back button returns to the previous tab');
await page.click('#newBtn');
check(await shown() === 'review' && await page.isVisible('#loader'), 'Load a game button opens the loader from another tab');

// Full review of the built-in example game.
const t0 = Date.now();
await page.click('#exBtn');
await page.waitForFunction(() => /Analyzing move \d+ of 56/.test(document.getElementById('ptx').textContent), null, { timeout: 60000 });
const during = await page.evaluate(() => ({ loader: document.getElementById('loader').hidden, bar: document.getElementById('progWrap').offsetHeight > 0, top: parseFloat(document.getElementById('tfill').style.width) > 0, pct: document.getElementById('ppc').textContent }));
check(during.loader && during.bar && during.top && /^\d+%$/.test(during.pct), 'while the engine runs the loader closes and progress is shown', JSON.stringify(during));
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
check(explained.length > 0 && explained.every(e => / [A-Z].*\.$/.test(e)), 'every flagged move comes with an explanation', explained.length + ' explained');
if (explained.length) console.log('Explanations:\n  ' + explained.join('\n  '));

// ---- coaching and navigation, looking at the game from White's side (White made the mistakes here) ----
await page.click('#st-sum'); await page.click('#asW');
const label = () => page.textContent('#mvLab');
const nBad = await page.$$eval('#counts .r', rs => rs.slice(7).reduce((a, r) => a + +r.children[1].textContent, 0));
check(nBad > 0, 'White has flagged moves in the example game', nBad + ' flagged');
await page.click('#st-mist');
const themes = await page.$$eval('#themes .th', ts => ts.map(t => ({ name: t.querySelector('b').textContent, n: t.querySelectorAll('.tm').length, tip: t.querySelector('.tip').textContent })));
check(themes.length > 0 && themes.reduce((a, t) => a + t.n, 0) === nBad && themes.every(t => t.name && t.tip.endsWith('.')), 'summary groups every flagged move by theme', themes.map(t => t.name + ': ' + t.n).join(', '));
check(new RegExp('\\(' + nBad + '\\)').test(await page.textContent('#st-mist')), 'Mistakes tab shows the count');
const firstTm = await page.$eval('#themes .tm', b => ({ i: +b.dataset.i, text: b.textContent }));
await page.click('#themes .tm');
check(firstTm.text.includes((await label()).replace(/^\d+\.+ /, '')), 'a move in the theme summary jumps to that move', await label());
check((await page.$$('#keys .km')).length >= nBad, 'key moments are listed and clickable');
await page.click('#keys .km'); const kmLab = await label();
check(/^\d+\./.test(kmLab), 'a key moment jumps to its move', kmLab);

// the lesson card for a mistake of the player
await page.click('#bFirst'); await page.click('#bNextM');
const m1 = await label();
const card = await page.$eval('#note', n => ({ dts: [...n.querySelectorAll('.lesson dt')].map(d => d.textContent), dds: [...n.querySelectorAll('.lesson dd')].map(d => d.textContent), why: (n.querySelector('.why') || {}).textContent || '', line: !!n.querySelector('#lineBtn'), ev: (n.querySelector('.evl') || {}).textContent || '' }));
check(card.dts[0] === 'What went wrong' && card.dts.includes('What your opponent can do now') && card.dts.some(d => d.startsWith('Best was ')) && card.dts.includes('Habit to build') && card.dds.every(d => d.trim().length > 3) && card.line && /Eval for you: \S+ to \S+/.test(card.ev), 'lesson card shows what went wrong, the punishing line, the best move and a habit', m1 + ': ' + card.dts.join(' / '));
check(/^Mistake 1 of \d+$/.test(await page.textContent('#mCount')), 'next mistake button jumps to the first mistake', m1 + ', ' + await page.textContent('#mCount'));
check(await page.$eval('#arrow', a => a.querySelectorAll('line').length > 0 && a.querySelectorAll('polygon').length > 0), 'best-move arrow is drawn when the move was not best');
await page.click('#bFirst');
check(await page.$eval('#arrow', a => a.children.length === 0), 'no arrow at the start position');

// keyboard and graph
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press('n'); const kn = await label();
await page.keyboard.press('ArrowRight'); const kr = await label();
await page.keyboard.press('ArrowLeft'); const kl = await label();
await page.keyboard.press('End'); const ke = await label();
await page.keyboard.press('p'); const kp = await label();
await page.keyboard.press('Home'); const kh = await label();
check(kn === m1 && kr !== kn && kl === kn && ke.includes(moves[moves.length - 1].san) && kp !== ke && kh === 'Start', 'keyboard: N, P, arrows, Home and End move through the game', [kn, kr, kl, ke, kp, kh].join(' | '));
check(await page.isVisible('.keys') && /N.*P.*mistake/s.test(await page.textContent('.keys')), 'keyboard shortcuts are shown under the board');
await page.keyboard.press('n'); await page.keyboard.press('b');
await page.waitForSelector('#backBtn'); await page.keyboard.press('Escape');
check(!(await page.$('#backBtn')) && await label() === m1, 'B opens the best line and Esc returns to the game');
const gb = await page.$eval('#graph', g => { const r = g.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, dots: g.querySelectorAll('.gd').length, path: g.querySelectorAll('path').length }; });
await page.mouse.click(gb.x + gb.w * 0.5, gb.y + gb.h / 2);
check(gb.dots >= nBad && gb.path === 2 && await label() === '14... ' + moves[27].san, 'eval graph has a dot per flagged move and a click jumps to that part of the game', gb.dots + ' dots, click in the middle -> ' + await label());

// laptop layout: board and lesson are both fully on screen without scrolling
await page.setViewportSize({ width: 1366, height: 768 });
await page.click('#bFirst'); await page.click('#bNextM');
const fit = await page.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(), b = r('board'), n = r('note'), nv = r('bNext'), box = document.querySelector('.notebox'); return { scrollY, vh: innerHeight, board: b.top >= 0 && b.bottom <= innerHeight, nav: nv.bottom <= innerHeight, note: n.top >= 0 && n.bottom <= innerHeight, noScrollInNote: box.scrollHeight <= box.clientHeight + 1, noteBox: box.clientHeight, moves: Math.round(document.getElementById('sp-moves').getBoundingClientRect().height) }; });
check(fit.scrollY === 0 && fit.board && fit.nav && fit.note && fit.noScrollInNote, 'at 1366x768 the board, its buttons and the whole lesson are visible together without scrolling', JSON.stringify(fit));
await page.setViewportSize({ width: 1280, height: 720 });

// copy for Claude carries the checked lesson
await page.click('#st-sum');
await page.evaluate(() => { navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
await page.click('#coachBtn');
const copied = await page.evaluate(() => window.__copied || '');
check(/What went wrong: /.test(copied) && /Opponent can now play: \d+\./.test(copied) && /Engine line instead: \d+\./.test(copied) && /Habit: /.test(copied) && /His mistakes by theme: [A-Z]/.test(copied) && !/\u2014/.test(copied), 'copy for Claude text includes the lesson for each mistake and the themes');
await page.click('#asB'); await page.click('#st-moves');

// ---- saved games and backups made by the previous version still load ----
// An old backup: same {games, openings, saved} shape. One game is saved as White and has no stored
// engine lines (pv), like a save from before lines were kept.
const old = JSON.parse(JSON.stringify(saved[0]));
old.id = 'gold1'; old.me = 'w'; old.white = 'me_as_white'; old.black = 'old_opponent'; old.pv = []; old.savedAt = 1700000000000;
const backupFile = path.join(os.tmpdir(), 'chess-lab-backup-test.json');
fs.writeFileSync(backupFile, JSON.stringify({ games: [saved[0], old], openings: { 'scotch-nf6': { done: 2, clean: 1, last: 1700000000000 } }, saved: '2026-01-01T00:00:00.000Z' }));
await page.evaluate(() => { localStorage.removeItem('ccr-games'); localStorage.removeItem('ccr-open'); });
await page.reload(); await page.click('.tabs a[data-tab=progress]');
check(await page.$$eval('#hist .h', hs => hs.length) === 0, 'history is empty before the restore');
await page.setInputFiles('#bkFile', backupFile);
await page.waitForFunction(() => /Backup restored: 2 games/.test(document.getElementById('saveNote').textContent), null, { timeout: 10000 });
const after = await page.evaluate(() => ({ games: JSON.parse(localStorage.getItem('ccr-games')), open: JSON.parse(localStorage.getItem('ccr-open')) }));
check(after.games.length === 2 && KEYS.every(k => k in after.games[0]) && Object.keys(after.games[0]).length === KEYS.length && after.open['scotch-nf6'].clean === 1, 'an old backup restores into the same localStorage keys and fields');
check(await page.$$eval('#hist .h', hs => hs.length) === 2, 'restored games are listed under Saved games');
await page.waitForFunction(() => document.querySelectorAll('#work .th').length > 0 || /No inaccuracies/.test(document.getElementById('work').textContent), null, { timeout: 20000 });
const work = await page.$$eval('#work .th', ts => ts.map(t => ({ name: t.querySelector('b').textContent, count: t.querySelector('.thh span').textContent, tip: t.children[2].textContent, ex: t.querySelectorAll('[data-open]').length })));
check(work.length > 0 && work.every(w => /^\d+\. /.test(w.name) && /\d+ times? in \d+ of 2 games/.test(w.count) && w.tip.length > 20 && w.ex > 0), 'What to work on groups the mistakes of the saved games by theme', work.map(w => w.name + ' (' + w.count + ')').join('; '));
const ex = await page.$eval('#work [data-open]', b => ({ id: b.dataset.open, k: +b.dataset.k, text: b.textContent }));
await page.click('#work [data-open]');
check(await shown() === 'review' && ex.text.includes((await label()).replace(/^\d+\.+ /, '')) && await page.isHidden('#loader') && !!(await page.$('#note .why')), 'an example opens the saved game at that move with its lesson', ex.text + ' -> ' + await label());
check(ex.id !== 'gold1' || /vs old_opponent/.test(await page.textContent('#gTitle')), 'the game saved without engine lines opens too');
await page.click('.tabs a[data-tab=progress]'); await page.click('#hist [data-open="gold1"]'); await page.click('#bNextM');
const oldCard = await page.$eval('#note', n => ({ why: (n.querySelector('.why') || {}).textContent || '', best: /Best was /.test(n.textContent) }));
check(/\.$/.test(oldCard.why) && oldCard.best, 'a game saved without engine lines still gets an explanation and the best move', oldCard.why);

// ---- phone: nothing wider than a 360 px screen, controls big enough to tap ----
const phone = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
const pp = await phone.newPage();
if (mockCC) await mockChessCom(pp);
await pp.addInitScript(g => { try { localStorage.setItem('ccr-games', g); } catch (e) {} }, JSON.stringify(after.games));
await pp.goto(url, { waitUntil: 'load' });
await pp.waitForFunction(() => /Your last \d+ games|No recent games|Couldn't reach/.test(document.getElementById('ccMsg').textContent), null, { timeout: 30000 });
const measure = () => pp.evaluate(() => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const small = [...document.querySelectorAll('button,.tabs a,input[type=text],textarea,label.btn')].filter(vis).map(el => { const r = el.getBoundingClientRect(); return { id: el.id || el.className || el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.h < 44 || x.w < 44);
  return { wide: document.documentElement.scrollWidth - innerWidth, small };
});
const sizes = {};
sizes.loader = await measure();
await pp.click('.tabs a[data-tab=progress]'); await pp.waitForFunction(() => document.querySelectorAll('#work .th').length > 0, null, { timeout: 20000 }); sizes.progress = await measure();
await pp.click('#hist [data-open="gold1"]'); await pp.click('#bNextM'); sizes.review = await measure();
await pp.click('#st-mist'); sizes.mistakes = await measure();
await pp.click('#st-sum'); sizes.summary = await measure();
await pp.click('.tabs a[data-tab=openings]'); sizes.openings = await measure();
await pp.click('.tabs a[data-tab=puzzles]'); await pp.waitForTimeout(300); sizes.puzzles = await measure();
check(Object.values(sizes).every(s => s.wide <= 0), 'nothing overflows sideways at 360 px in any tab', Object.entries(sizes).map(([k, v]) => k + ' ' + v.wide).join(', '));
const tooSmall = Object.entries(sizes).flatMap(([k, v]) => v.small.map(x => k + ':' + x.id + ' ' + x.w + 'x' + x.h));
check(tooSmall.length === 0, 'every button, tab and field is at least 44 px in both directions on a phone', [...new Set(tooSmall)].join(', '));
await pp.click('.tabs a[data-tab=review]'); await pp.click('#st-moves');
const stack = await pp.evaluate(() => { const t = id => document.getElementById(id).getBoundingClientRect().top; return [t('board'), t('bNext'), t('note'), t('graph'), t('ml')]; });
check(stack.every((v, j) => j === 0 || v > stack[j - 1]), 'on a phone the review stacks: board, buttons, lesson, graph, moves');
await phone.close();

let text = '';
for (const t of ['review', 'openings', 'progress']) { await page.click('.tabs a[data-tab=' + t + ']'); text += await page.evaluate(() => document.body.innerText); }
check(!/\u2014/.test(text), 'no em dashes in the page text of any tab');
if (local) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = ['index.html', 'README.md', 'netlify.toml', 'tests/review.mjs', 'tests/tactics.cjs', 'tests/fixtures.mjs', 'tests/serve.mjs', 'tests/quality.mjs', 'tests/shots.mjs', 'tests/package.json'].filter(f => fs.existsSync(path.join(root, f)));
  const dashed = files.filter(f => /\u2014/.test(fs.readFileSync(path.join(root, f), 'utf8')));
  check(dashed.length === 0, 'no em dashes in the source files', dashed.join(', '));
}
if (!arg('block')) {
  check(bad.length === 0, 'no failed network requests', bad.join(' | '));
  check(errors.length === 0, 'no console errors', errors.join(' | '));
}

await browser.close();
if (local) local.server.close();
console.log(failed ? '\n' + failed + ' check(s) failed' : '\nAll checks passed');
process.exit(failed ? 1 : 0);

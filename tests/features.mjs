// Browser tests for the features in train.js: your clock, puzzles, your openings,
// backups of the new data, offline use, and (with --deep) the deep check.
//   node features.mjs            uses real games from tests/fixtures
//   node features.mjs --deep     also runs the deep check (downloads about 95 MB)
//   node features.mjs --headed
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';
import { mockChessCom } from './fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = n => fs.readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const flag = n => process.argv.includes('--' + n);
let failed = 0;
const check = (ok, msg, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + msg + (extra ? '  [' + extra + ']' : '')); if (!ok) failed++; };
const { Chess } = await import(path.join(HERE, '..', 'chess.js'));

const local = await serve();
const browser = await chromium.launch({ headless: !flag('headed') });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await mockChessCom(page);                       // these tests do not need the real chess.com list
await page.goto(local.url);

async function reviewPgn(pgn) {
  if (await page.$eval('#loader', e => e.hidden)) await page.click('#newBtn');
  await page.fill('#pgn', pgn);
  await page.click('#goBtn');
  await page.waitForFunction(() => document.getElementById('ptx').textContent === 'Review complete', null, { timeout: 240000 });
}
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ccr-games') || '[]'));
const LONG = FIX('long-game.pgn'), WHITE = FIX('white-game.pgn');

// ---- 1. Your clock ----
await reviewPgn(LONG);
const longDoc = (await saved())[0];
const clk = await page.evaluate(() => JSON.parse(localStorage.getItem('ccr-clk') || '{}'));
check(clk[longDoc.id] && clk[longDoc.id].c.length === longDoc.san.length && clk[longDoc.id].base === 600, 'clock times are kept per reviewed game under ccr-clk', clk[longDoc.id] ? clk[longDoc.id].c.length + ' clocks, base ' + clk[longDoc.id].base : 'none');
check(Object.keys(longDoc).sort().join() === 'belo,best,black,cls,coach,date,ev,fen0,id,loss,me,opening,pv,result,san,savedAt,w2,welo,white', 'the saved game has exactly the original fields');
await page.click('#st-sum');
const cb = await page.$eval('#clockBox', e => ({ hidden: e.hidden, text: e.innerText, bars: e.querySelectorAll('rect[data-i]').length, links: [...e.querySelectorAll('.facts [data-i]')].map(b => +b.dataset.i) }));
check(!cb.hidden && /Your clock/.test(cb.text) && cb.bars === Math.ceil(longDoc.san.length / 2), 'Summary shows Your clock with a bar for each of your moves', cb.bars + ' bars');
check(/mistakes/.test(cb.text) && cb.links.length > 0, 'clock facts name your mistakes and link to them', cb.text.split('\n').filter(l => /mistake|think/i.test(l)).slice(0, 2).join(' / '));
await page.click('#clockBox .facts [data-i="' + cb.links[0] + '"]');
const lab = await page.textContent('#mvLab');
check(lab.startsWith(Math.ceil(cb.links[0] / 2) + (cb.links[0] % 2 ? '. ' : '... ')), 'a move in the clock facts jumps to that move', lab);

// ---- 2. Your openings ----
await reviewPgn(WHITE);
await page.click('.tabs a[data-tab=openings]');
await page.waitForFunction(() => document.querySelectorAll('#myOpen .th').length >= 2, null, { timeout: 20000 });
const op = await page.$eval('#myOpen', e => ({ text: e.innerText, lines: [...e.querySelectorAll('[data-line]')].map(b => b.textContent) }));
check(/Black: Queen's Gambit Declined/.test(op.text) && /White: /.test(op.text) && /Opening accuracy \d+%/.test(op.text), 'Your openings groups the games by colour and opening with accuracy', op.text.split('\n').filter(l => /^(White|Black):/.test(l)).join(', '));
check(op.lines.some(t => /Queen's Gambit Declined/.test(t)), 'a game that reaches a trainer line by another move order is matched to it', op.lines.join(', '));
await page.click('#myOpen [data-line]');
await page.waitForTimeout(700);
check(op.lines[0].includes(await page.textContent('#tName')), 'Practice opens that line in the trainer', await page.textContent('#tName'));

// ---- 3. Puzzles ----
await page.click('.tabs a[data-tab=puzzles]');
await page.waitForFunction(() => document.querySelectorAll('#pzBoard .sq').length === 64, null, { timeout: 10000 });
const docs = await saved();
const expect = docs.reduce((a, d) => a + d.cls.filter((c, k) => ['mistake', 'miss', 'blunder'].includes(c) && (k % 2 === 1) === (d.me === 'w') && (d.loss[k] || 0) >= 0.1 && d.best[k - 1]).length, 0);
const badgeN = +(await page.textContent('#pzTabN'));
check(expect > 0 && badgeN === expect, 'every mistake, miss and blunder of yours becomes a puzzle, counted on the tab', badgeN + ' puzzles');
// which puzzle is on the board: find it from the note
async function current() {
  const note = await page.innerText('#pzNote'), side = (await page.textContent('#pzName')).startsWith('White') ? 'w' : 'b';
  const mv = +note.match(/move (\d+)\./)[1], k = side === 'w' ? mv * 2 - 1 : mv * 2;
  const opp = note.match(/game vs (\S+?),/)[1];
  const d = docs.find(x => (x.me === 'w' ? x.black : x.white) === opp);
  const c = new Chess(d.fen0 || undefined); for (let j = 0; j < k - 1; j++) c.move(d.san[j]);
  return { d, k, pid: d.id + ':' + k, fen: c.fen() };
}
const sq = s => page.click('#pzBoard [data-sq="' + s + '"]');
async function play(uci) { await sq(uci.slice(0, 2)); await sq(uci.slice(2, 4)); }
async function solve(p) {
  const pv = (p.d.pv[p.k - 1] || '').split(' ');
  const line = pv[0] === p.d.best[p.k - 1] ? pv : [p.d.best[p.k - 1]];
  for (let j = 0; j < line.length && !(await page.$('#pzOpen')); j += 2) {
    await play(line[j]);
    await page.waitForFunction(() => document.getElementById('pzOpen') || /Keep going/.test(document.getElementById('pzNote').innerText), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(650);
  }
}
let p = await current();
const c0 = new Chess(p.fen), gm = c0.move(p.d.san[p.k - 1]);
await play(gm.from + gm.to);
check(/is what you played in the game/.test(await page.innerText('#pzNote')), 'playing your game move is rejected with a reason');
await solve(p);
const done1 = await page.innerText('#pzNote');
check(!!(await page.$('#pzOpen')) && /Why .* was wrong/.test(done1), 'the solution solves it and the lesson explains your game move', done1.split('\n')[0]);
let S = await page.evaluate(() => JSON.parse(localStorage.getItem('ccr-puz') || '{}'));
check(S[p.pid] && S[p.pid].b === 0 && S[p.pid].due - Date.now() < 11 * 60e3, 'after a wrong try the puzzle comes back in 10 minutes');
await page.click('#pzNext');
await page.waitForTimeout(300);
p = await current();
await solve(p);
S = await page.evaluate(() => JSON.parse(localStorage.getItem('ccr-puz') || '{}'));
const days = S[p.pid] ? (S[p.pid].due - Date.now()) / 864e5 : 0;
check(S[p.pid] && S[p.pid].b === 1 && days > 0.9 && days < 1.1, 'solved cleanly it comes back after 1 day', days.toFixed(2) + ' days');
await page.click('#pzOpen');
check(!(await page.$eval('#review', e => e.hidden)) && (await page.textContent('#mvLab')).startsWith(String(Math.ceil(p.k / 2))), 'Open this move in the review jumps to it', await page.textContent('#mvLab'));

// ---- 4. Progress: clock across games, app panel ----
await page.click('.tabs a[data-tab=progress]');
await page.waitForTimeout(400);
const cs = await page.$eval('#clockStats', e => ({ hidden: e.hidden, text: e.innerText }));
check(!cs.hidden && /Games with clock data\s*2/.test(cs.text), 'Progress shows your clock across games', cs.text.replace(/\s+/g, ' ').slice(0, 120));
check(/Use it as an app/.test(await page.innerText('#appBox')), 'Progress has the Use it as an app panel');

// ---- 5. Backup carries the new data, old fields unchanged ----
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bkDown')]);
const bk = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
check(['games', 'openings', 'saved', 'clocks', 'puzzles'].every(k => k in bk) && bk.games.length === 2 && Object.keys(bk.clocks).length === 2 && Object.keys(bk.puzzles).length === 2, 'Download backup keeps games, openings and saved, and adds clocks and puzzles', Object.keys(bk).join(', '));
const p2 = await ctx.newPage();
await mockChessCom(p2);
await p2.goto(local.url);
await p2.evaluate(() => localStorage.clear());
await p2.reload();
await p2.click('.tabs a[data-tab=progress]');
const f = path.join(HERE, '.cache', 'backup-test.json');
fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(bk));
await p2.setInputFiles('#bkFile', f);
await p2.waitForFunction(() => /Backup restored/.test(document.getElementById('saveNote').textContent), null, { timeout: 10000 });
const r2 = await p2.evaluate(() => ({ g: JSON.parse(localStorage.getItem('ccr-games')).length, c: Object.keys(JSON.parse(localStorage.getItem('ccr-clk') || '{}')).length, p: Object.keys(JSON.parse(localStorage.getItem('ccr-puz') || '{}')).length }));
check(r2.g === 2 && r2.c === 2 && r2.p === 2, 'restoring that backup brings back games, clocks and puzzle progress', JSON.stringify(r2));
await p2.close();

// ---- 6. Deep check (optional: downloads about 95 MB) ----
if (flag('deep')) {
  await page.click('.tabs a[data-tab=review]');
  const d0 = docs.find(d => d.id === p.d.id);
  await page.click('#hist [data-open="' + d0.id + '"]').catch(async () => { await page.click('.tabs a[data-tab=progress]'); await page.click('#hist [data-open="' + d0.id + '"]'); });
  await page.click('#bNextM');
  await page.click('#deepBox [data-deep]');
  await page.waitForFunction(() => /depth \d+\n|could not/.test(document.getElementById('deepBox').innerText), null, { timeout: 240000 });
  const t = await page.innerText('#deepBox');
  check(/Deep check, full Stockfish 19, depth \d+/.test(t) && /(agrees|Close to the review|sees it differently|no real problem)/.test(t), 'Deep check runs the full Stockfish 19 and compares it with the review', t.split('\n').slice(-3)[0]);
}

// ---- 7. Offline: install the service worker, stop the server, review offline ----
const off = await serve();
const sockets = new Set();
off.server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
const octx = await browser.newContext();
const op2 = await octx.newPage();
await mockChessCom(op2);
await op2.goto(off.url);
await op2.evaluate(() => navigator.serviceWorker.ready);
await op2.waitForFunction(async () => (await (await caches.open('cl-core-v1')).keys()).length >= 13, null, { timeout: 60000 });
await op2.reload();
off.server.close(); for (const s of sockets) s.destroy();
await op2.reload();
const iso = await op2.evaluate(() => crossOriginIsolated);
await op2.click('#exBtn');
await op2.waitForFunction(() => document.getElementById('ptx').textContent === 'Review complete', null, { timeout: 240000 });
const rated = await op2.$$eval('#ml .mb .dot', d => d.filter(x => x.textContent).length);
check(iso && rated === 56, 'with the server gone, the page still loads cross-origin isolated and a full review runs', 'isolated ' + iso + ', ' + rated + ' moves rated with ' + await op2.textContent('#engName'));
await octx.close();

// ---- general ----
for (const t of ['review', 'puzzles', 'openings', 'progress']) {
  await page.click('.tabs a[data-tab=' + t + ']');
  if (/—/.test(await page.evaluate(() => document.body.innerText))) check(false, 'no em dashes on the ' + t + ' tab');
}
check(!['train.js', 'sw.js', 'manifest.webmanifest'].some(f => /—/.test(fs.readFileSync(path.join(HERE, '..', f), 'utf8'))), 'no em dashes in train.js, sw.js and the manifest');
check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));

await browser.close();
local.server.close();
console.log(failed ? '\n' + failed + ' check(s) failed' : '\nAll feature checks passed');
process.exit(failed ? 1 : 0);

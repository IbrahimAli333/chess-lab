// Engine quality check: review real games on the site in a real browser, then
// compare every position with a native Stockfish at depth 22.
//
//   brew install stockfish        (any native Stockfish on PATH works)
//   node quality.mjs --user=<chess.com username> [--games=4] [--single]
//                    [--lim="{depth:18,ms:800,min:250,total:70000}"]   (try other limits without editing the site)
//
// --single serves the site without the isolation headers, so the browser uses
// the single-threaded engine. Native results are cached in tests/.cache.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, netlifyHeaders } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.cache');
fs.mkdirSync(CACHE, { recursive: true });
const arg = (n, d) => { const a = process.argv.find(a => a.startsWith('--' + n + '=')); return a ? a.split('=').slice(1).join('=') : d; };
const flag = n => process.argv.includes('--' + n);
const USER = arg('user', 'ibrahimalikh').toLowerCase(), NG = +arg('games', 4), DEPTH = +arg('depth', 22), GO = arg('lim', '');
const wp = cp => 1 / (1 + Math.exp(-0.00368208 * cp));
const bucket = l => l < 0.02 ? 0 : l < 0.05 ? 1 : l < 0.10 ? 2 : l < 0.20 ? 3 : 4;
const BN = ['best/excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

// ---- native engine ----
class Native {
  constructor() {
    this.p = spawn('stockfish'); this.buf = ''; this.on = null;
    this.p.stdout.on('data', d => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); if (this.on) this.on(l); } });
    for (const c of ['uci', 'setoption name Threads value 8', 'setoption name Hash value 1024']) this.p.stdin.write(c + '\n');
  }
  // returns { cp (side to move POV, mate as +-(10000-n)), best }
  go(fen, extra = '') {
    return new Promise(res => {
      let cp = 0;
      this.on = l => {
        const s = l.match(/score (cp|mate) (-?\d+)/);
        if (s && !/bound/.test(l)) { cp = +s[2]; if (s[1] === 'mate') cp = cp > 0 ? 10000 - cp : -10000 - cp; }
        if (l.startsWith('bestmove')) { this.on = null; res({ cp, best: l.split(' ')[1] }); }
      };
      this.p.stdin.write('position fen ' + fen + '\ngo depth ' + DEPTH + extra + '\n');
    });
  }
  quit() { this.p.stdin.write('quit\n'); }
}
const cacheFile = path.join(CACHE, 'native-d' + DEPTH + '.json');
const ncache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
const native = new Native();
async function nat(fen, move) {
  const key = fen + (move ? ' | ' + move : '');
  if (!ncache[key]) { ncache[key] = await native.go(fen, move ? ' searchmoves ' + move : ''); fs.writeFileSync(cacheFile, JSON.stringify(ncache)); }
  return ncache[key];
}

// ---- site in a real browser ----
const local = await serve({ headers: flag('single') ? {} : netlifyHeaders() });
const browser = await chromium.launch();
const page = await browser.newPage();
if (GO) await page.route('**/index.html', async r => { const resp = await r.fetch(); r.fulfill({ response: resp, body: (await resp.text()).replace(/const LIM=\{[^}]*\};/, 'const LIM=' + GO + ';') }); });
await page.goto(local.url + 'index.html');

const gamesFile = path.join(CACHE, 'games-' + USER + '.json');
let games = fs.existsSync(gamesFile) ? JSON.parse(fs.readFileSync(gamesFile, 'utf8')) : null;
if (!games) {
  games = await page.evaluate(async ({ u, n }) => {
    const a = await (await fetch('https://api.chess.com/pub/player/' + encodeURIComponent(u) + '/games/archives')).json();
    let out = [];
    for (const url of (a.archives || []).slice(-3).reverse()) {
      const r = await (await fetch(url)).json();
      out = out.concat((r.games || []).filter(g => g.pgn && (!g.rules || g.rules === 'chess')).reverse());
    }
    // real games of different lengths: skip very short ones
    const plies = g => (g.pgn.split('\n\n')[1] || '').replace(/\{[^}]*\}/g, '').split(/\d+\.+/).length * 2;
    return out.filter(g => plies(g) >= 40).slice(0, n).map(g => g.pgn);
  }, { u: USER, n: NG });
  fs.writeFileSync(gamesFile, JSON.stringify(games));
}
console.log('crossOriginIsolated=' + await page.evaluate(() => crossOriginIsolated) + (GO ? '   limits override: ' + GO : ''));

const tot = { n: 0, agree: 0, sbLoss: [], evDiff: [], bigEv: 0, exact: 0, near: 0, moves: 0, serious: 0, seriousCaught: 0, alarms: 0, falseAlarms: 0, secs: [] };
for (let gi = 0; gi < games.length; gi++) {
  await page.evaluate(() => localStorage.removeItem('ccr-games'));
  await page.reload();
  await page.fill('#pgn', games[gi]);
  const t0 = Date.now();
  await page.click('#goBtn');
  await page.waitForFunction(() => document.getElementById('ptx').textContent === 'Review complete', null, { timeout: 300000 });
  const secs = (Date.now() - t0) / 1000;
  const eng = await page.textContent('#engName');
  const { doc, fens, ucis } = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem('ccr-games'))[0];
    const c = new Chess(doc.fen0); const fens = [c.fen()], ucis = [];
    for (const s of doc.san) { const m = c.move(s); ucis.push(m.from + m.to + (m.promotion || '')); fens.push(c.fen()); }
    return { doc, fens, ucis };
  });
  const T = doc.san.length; const g = { n: 0, agree: 0, sbLoss: [], evDiff: [], exact: 0, near: 0 };
  const nev = [];
  for (let k = 0; k <= T; k++) {
    if (doc.best[k] == null) { nev[k] = doc.ev[k]; continue; }           // game over position
    const stm = fens[k].split(' ')[1] === 'w' ? 1 : -1;
    const r = await nat(fens[k]);
    nev[k] = r.cp * stm; g.n++;
    const d = Math.abs(wp(nev[k]) - wp(doc.ev[k])); g.evDiff.push(d); if (d > 0.10) tot.bigEv++;
    if (doc.best[k] === r.best) { g.agree++; g.sbLoss.push(0); }
    else { const alt = await nat(fens[k], doc.best[k]); g.sbLoss.push(Math.max(0, wp(r.cp) - wp(alt.cp))); }
  }
  const worst = [];
  for (let k = 1; k <= T; k++) {
    const mw = k % 2 === 1, f = cp => mw ? wp(cp) : 1 - wp(cp);
    const nl = Math.max(0, f(nev[k - 1]) - f(nev[k])), sl = doc.loss[k] || 0;
    const nb = bucket(nl), sb = bucket(sl); tot.moves++;
    if (nb === sb) g.exact++; if (Math.abs(nb - sb) <= 1) g.near++;
    if (nb >= 3) { tot.serious++; if (sb >= 2) tot.seriousCaught++; }
    if (sb >= 3) { tot.alarms++; if (nb <= 1) tot.falseAlarms++; }
    if (Math.abs(nb - sb) >= 2) worst.push(Math.ceil(k / 2) + (k % 2 ? '. ' : '... ') + doc.san[k - 1] + ' site=' + (doc.cls[k] || '?') + ' (' + (sl * 100).toFixed(0) + '%) native=' + BN[nb] + ' (' + (nl * 100).toFixed(0) + '%)');
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  console.log(`\nGame ${gi + 1}: ${doc.white} vs ${doc.black}, ${T} plies, reviewed in ${secs.toFixed(1)}s with ${eng}`);
  console.log(`  best move same as native d${DEPTH}: ${g.agree}/${g.n} (${(100 * g.agree / g.n).toFixed(0)}%)   avg win% lost by site's best move: ${(100 * avg(g.sbLoss)).toFixed(2)}   site best moves that are really inaccuracies (>5%): ${g.sbLoss.filter(x => x > 0.05).length}`);
  console.log(`  eval: avg win% difference ${(100 * avg(g.evDiff)).toFixed(1)}, positions off by more than 10%: ${g.evDiff.filter(x => x > 0.10).length}`);
  console.log(`  move ratings: same bucket ${g.exact}/${T}, within one bucket ${g.near}/${T}`);
  if (worst.length) console.log('  off by 2+ buckets: ' + worst.join(' | '));
  tot.n += g.n; tot.agree += g.agree; tot.sbLoss.push(...g.sbLoss); tot.evDiff.push(...g.evDiff); tot.exact += g.exact; tot.near += g.near; tot.secs.push(secs);
}
const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
console.log(`\nTOTAL over ${games.length} games, ${tot.n} positions`);
console.log(`  best move agreement ${(100 * tot.agree / tot.n).toFixed(1)}%   avg win% lost by site's best move ${(100 * avg(tot.sbLoss)).toFixed(2)}   bad site best moves (>5% lost) ${tot.sbLoss.filter(x => x > 0.05).length}   (>10% lost) ${tot.sbLoss.filter(x => x > 0.10).length}`);
console.log(`  eval avg win% difference ${(100 * avg(tot.evDiff)).toFixed(1)}   positions off by >10%: ${tot.bigEv}`);
console.log(`  ratings: same bucket ${(100 * tot.exact / tot.moves).toFixed(0)}%, within one ${(100 * tot.near / tot.moves).toFixed(0)}%   real mistakes/blunders flagged by site ${tot.seriousCaught}/${tot.serious}   site mistakes/blunders that are false alarms ${tot.falseAlarms}/${tot.alarms}`);
console.log(`  review time: ${tot.secs.map(s => s.toFixed(0) + 's').join(', ')}`);
native.quit(); await browser.close(); local.server.close();

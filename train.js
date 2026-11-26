// Chess Lab training features. Loaded after the main script in index.html and
// uses it only through window.CL. Each feature keeps its own data under its own
// localStorage key, so the original keys (ccr-user, ccr-games, ccr-open) and the
// saved game format stay exactly as they were.
//
//   ccr-clk  clock times per game, read from the chess.com PGN   (time trouble)
//   ccr-puz  spaced repetition schedule for your puzzles          (puzzles)
//
// Backups made by Download backup carry these two as optional extra fields
// ("clocks" and "puzzles"). Older backups without them still restore.
(function () {
'use strict';
const CL = window.CL;
if (!CL) return;
const $ = id => document.getElementById(id);
const esc = CL.esc;
const rd = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
const isMine = (g, k) => (k % 2 === 1) === (g.me === 'w');
const mlab = (g, k) => Math.ceil(k / 2) + (k % 2 ? '. ' : '... ') + g.san[k - 1];
const BADC = CL.BAD;                       // inaccuracy, mistake, miss, blunder
const on = (ev, fn) => document.addEventListener(ev, fn);
const X = window.CLX = { backup: () => ({}), restore: () => {} };
const backupParts = [], restoreParts = [];
X.backup = () => Object.assign({}, ...backupParts.map(f => f()));
X.restore = j => restoreParts.forEach(f => { try { f(j); } catch (e) {} });

// Saved games rebuilt with positions (fromDoc replays every move), cached per game.
const GC = new Map();
function gameOf(d) {
  const key = d.id + '|' + d.savedAt + '|' + d.me + '|' + (CL.bookReady ? 1 : 0);
  let c = GC.get(d.id);
  if (!c || c.key !== key) { let g = null; try { g = CL.fromDoc(d); } catch (e) {} c = { key, g }; GC.set(d.id, c); }
  return c.g;
}
const savedGames = () => CL.hist.filter(d => d && d.id && d.san && d.cls && d.cls.length > 1)
  .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

// ---------------------------------------------------------------------------
// 1. Time trouble: where the clock went, and whether mistakes came when time was short
// ---------------------------------------------------------------------------
const CLK = 'ccr-clk';
const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const secs = s => s < 60 ? Math.round(s) + ' s' : mmss(s);

// Clock left after every ply, in seconds, from chess.com style {[%clk 0:09:58.8]} comments.
function parseClocks(text, plies) {
  const tc = (text.match(/\[TimeControl\s+"([^"]*)"\]/) || [])[1] || '';
  const m = tc.match(/^(\d+)(?:\+(\d+(?:\.\d+)?))?$/);
  if (!m) return null;                      // daily games ("1/86400") and unknown formats
  const body = text.replace(/\[[^\]\n]*"[^"]*"\]\s*/g, '');
  const c = [...body.matchAll(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/g)].map(x => +x[1] * 3600 + +x[2] * 60 + +x[3]);
  if (c.length !== plies) return null;
  const term = (text.match(/\[Termination\s+"([^"]*)"\]/) || [])[1] || '';
  return { base: +m[1], inc: +(m[2] || 0), c: c.map(x => Math.round(x * 10) / 10), term };
}
on('cl:pgn', e => {
  const { text, g } = e.detail || {};
  if (!g || !text) return;
  const k = parseClocks(text, g.san.length);
  if (!k) return;
  const all = rd(CLK, {});
  all[g.id] = k;
  // keep it small: only games that are saved, plus the one being reviewed
  const keep = new Set(CL.hist.map(d => d.id).concat(g.id));
  for (const id of Object.keys(all)) if (!keep.has(id)) delete all[id];
  wr(CLK, all);
});
backupParts.push(() => ({ clocks: rd(CLK, {}) }));
restoreParts.push(j => { if (j && j.clocks && typeof j.clocks === 'object') wr(CLK, Object.assign({}, j.clocks, rd(CLK, {}))); });

// Per move facts for one side: time spent, time left before the move.
function clockMoves(g, k0) {
  const out = [];
  for (let k = 1; k <= g.san.length; k++) {
    const prev = k > 2 ? k0.c[k - 3] : k0.base;
    const left = prev;                                   // on the clock when the move was started
    const spent = Math.max(0, prev - k0.c[k - 1] + (k > 2 ? k0.inc : 0));
    out.push({ k, left, spent, after: k0.c[k - 1], mine: isMine(g, k), cls: g.cls[k] });
  }
  return out;
}
const lowTime = k0 => Math.max(60, k0.base * 0.1);      // "time trouble": under a minute, or under 10% for long games
const RUSH = 3;                                          // seconds: a move played faster than this

function clockReport(g, k0) {
  const mv = clockMoves(g, k0), me = mv.filter(m => m.mine), lt = lowTime(k0);
  const bad = me.filter(m => BADC.includes(m.cls));
  const inTrouble = bad.filter(m => m.left < lt);
  const rushed = bad.filter(m => m.spent < RUSH && m.left >= lt);
  const first10 = me.filter(m => m.k <= 20).reduce((a, m) => a + m.spent, 0);
  const longest = me.slice().sort((a, b) => b.spent - a.spent).slice(0, 2).filter(m => m.spent >= 20);
  const endMe = me.length ? me[me.length - 1].after : k0.base;
  const opp = mv.filter(m => !m.mine), endOpp = opp.length ? opp[opp.length - 1].after : k0.base;
  const flagged = /on time/i.test(k0.term);
  return { mv, me, bad, inTrouble, rushed, first10, longest, endMe, endOpp, lt, flagged };
}

function clockChart(g, R, k0) {
  const T = g.san.length, W = 100, H = 100, max = Math.max(10, ...R.me.map(m => m.spent));
  let h = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">';
  const bw = Math.max(0.6, W / (T + 1) * 1.6);
  for (const m of R.me) {
    const x = (m.k / (T + 1)) * W, bh = Math.max(2, m.spent / max * 78);
    const col = m.cls ? CL.C[m.cls][1] : '#9A978F';
    h += '<rect class="cb" data-i="' + m.k + '" x="' + (x - bw / 2).toFixed(2) + '" y="' + (H - bh).toFixed(2) + '" width="' + bw.toFixed(2) + '" height="' + bh.toFixed(2) + '" style="fill:' + col + '"><title>' + esc(mlab(g, m.k) + ': ' + secs(m.spent)) + '</title></rect>';
  }
  // your clock as a line, top = full time
  const pts = R.me.map(m => ((m.k / (T + 1)) * W).toFixed(2) + ' ' + (H - Math.max(0, m.after) / k0.base * 90).toFixed(1));
  if (pts.length > 1) h += '<path d="M' + pts.join(' L') + '" style="fill:none;stroke:var(--ink);stroke-width:1.5;opacity:.6" vector-effect="non-scaling-stroke"/>';
  const ly = H - R.lt / k0.base * 90;
  h += '<line x1="0" x2="100" y1="' + ly.toFixed(1) + '" y2="' + ly.toFixed(1) + '" style="stroke:#C4473A;stroke-width:1;opacity:.6" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>';
  return '<div class="clk" role="img" aria-label="Time you spent on each move, coloured by its rating, with your clock as a line.">' + h + '</svg></div><p class="tip" style="margin:-4px 0 10px">Bars: time you spent on each move, in its rating colour (tap one to see it). Line: your clock. Red dashes: ' + secs(R.lt) + ' left.</p>';
}

const mvBtn = (g, m) => '<button type="button" class="tm" data-i="' + m.k + '">' + (m.cls ? CL.badge(m.cls) : '') + esc(mlab(g, m.k)) + '</button>';

function renderClockBox() {
  const box = $('clockBox'), g = CL.G;
  if (!box) return;
  const k0 = g && g.id ? rd(CLK, {})[g.id] : null;
  if (!g || !k0 || !g.done || k0.c.length !== g.san.length) { box.hidden = true; return; }
  const R = clockReport(g, k0), f = [];
  f.push('You used ' + mmss(R.first10) + ' of your ' + mmss(k0.base) + ' on your first 10 moves.');
  if (R.bad.length) {
    f.push(R.inTrouble.length
      ? R.inTrouble.length + ' of your ' + R.bad.length + ' mistakes came with under ' + secs(R.lt) + ' on your clock: ' + R.inTrouble.map(m => mvBtn(g, m) + ' (' + mmss(m.left) + ' left)').join(', ') + '.'
      : 'None of your ' + R.bad.length + ' mistakes came in time trouble.');
    if (R.rushed.length) f.push(R.rushed.length + (R.rushed.length > 1 ? ' mistakes were' : ' mistake was') + ' played in under ' + RUSH + ' seconds while you still had time: ' + R.rushed.map(m => mvBtn(g, m) + ' (' + secs(m.spent) + ')').join(', ') + '.');
  }
  for (const m of R.longest) f.push('Long think: ' + secs(m.spent) + ' on ' + mvBtn(g, m) + (m.cls ? ', ' + (BADC.includes(m.cls) ? 'and it was still ' + (m.cls === 'inaccuracy' ? 'an ' : 'a ') + m.cls : 'rated ' + CL.C[m.cls][0].toLowerCase()) : '') + '.');
  f.push(R.flagged ? 'The game ended on time.' : 'You finished with ' + mmss(R.endMe) + ' left, your opponent with ' + mmss(R.endOpp) + '.');
  let habit = '';
  if (R.rushed.length) habit = 'Before a fast move, take a few seconds for a blunder check: what does my move leave undefended, and what are their checks and captures?';
  else if (R.inTrouble.length) habit = 'Spend less time in the opening so you still have time in the middlegame. Aim to have at least a third of your time left at move 30.';
  else if (R.bad.length && R.endMe > k0.base * 0.4) habit = 'You finished with plenty of time. Spend it on the moves that change the position: captures, checks and pawn breaks.';
  box.innerHTML = '<h2>Your clock</h2>' + clockChart(g, R, k0) + '<ul class="facts">' + f.map(x => '<li>' + x + '</li>').join('') + '</ul>' + (habit ? '<p class="habit"><b>Habit:</b> ' + esc(habit) + '</p>' : '');
  box.hidden = false;
}
on('cl:panel', renderClockBox);
document.addEventListener('click', e => {
  const b = e.target.closest('#clockBox [data-i]');
  if (b) { CL.jump(+b.dataset.i); }
});

// Across games, for the Progress tab
function renderClockStats() {
  const box = $('clockStats');
  if (!box) return;
  const all = rd(CLK, {}), rows = [];
  for (const d of savedGames().slice(0, 30)) {
    const k0 = all[d.id];
    if (!k0 || k0.c.length !== d.san.length) continue;
    const g = gameOf(d);
    if (g) rows.push({ d, g, k0, R: clockReport(g, k0) });
  }
  if (rows.length < 1) { box.hidden = true; return; }
  const N = rows.length, bad = rows.reduce((a, r) => a + r.R.bad.length, 0), tt = rows.reduce((a, r) => a + r.R.inTrouble.length, 0);
  const rush = rows.reduce((a, r) => a + r.R.rushed.length, 0);
  const lostTime = rows.filter(r => { const t = r.k0.term.toLowerCase(), meName = String(r.d.me === 'w' ? r.d.white : r.d.black).toLowerCase(); return /won on time/.test(t) && !t.startsWith(meName + ' '); }).length;
  const at20 = rows.map(r => { const m = r.R.me.find(x => x.k >= 39); return m ? m.left / r.k0.base : null; }).filter(x => x != null);
  const avg20 = at20.length ? at20.reduce((a, b) => a + b, 0) / at20.length : null;
  const cards = [
    ['Games with clock data', N],
    ['Mistakes in time trouble', bad ? Math.round(tt / bad * 100) + '%' : '-'],
    ['Rushed mistakes per game', (rush / N).toFixed(1)],
    ['Clock left at move 20', avg20 == null ? '-' : Math.round(avg20 * 100) + '%'],
  ];
  let advice;
  if (bad && tt / bad >= 0.3) advice = 'Time trouble is costing you: ' + tt + ' of your ' + bad + ' mistakes came when your clock was low. Play the opening faster, it is the part you know best.';
  else if (rush / N >= 1) advice = 'Many of your mistakes are fast moves while you still had time. Take a few seconds before every move that changes the position.';
  else if (avg20 != null && avg20 > 0.75 && bad / N >= 2) advice = 'You keep a lot of time and still make mistakes. Use more of your clock on the critical moves.';
  else advice = 'Your time use looks healthy. Keep checking captures and checks before you move.';
  box.innerHTML = '<h2>Your clock across games</h2><div class="stats" style="margin-bottom:10px">' + cards.map(c => '<div class="card"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div></div>').join('') + '</div><p class="tip" style="margin:0">' + esc(advice) + (lostTime ? ' You lost ' + lostTime + ' of these games on time.' : '') + '</p>';
  box.hidden = false;
}
on('cl:games', renderClockStats);
renderClockStats();
renderClockBox();

})();

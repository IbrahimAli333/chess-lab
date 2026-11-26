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

// ---------------------------------------------------------------------------
// Shared: a board you can click on, and a quiet engine for checking moves
// ---------------------------------------------------------------------------
const uciMove = u => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' });
function boardHtml(fen, o) {
  const rows = fen.split(' ')[0].split('/').map(r => { const a = []; for (const c of r) { if (/\d/.test(c)) for (let k = 0; k < +c; k++) a.push(''); else a.push(c); } return a; });
  let h = '';
  for (let vr = 0; vr < 8; vr++) for (let vc = 0; vc < 8; vc++) {
    const r = o.bottom === 'w' ? vr : 7 - vr, c = o.bottom === 'w' ? vc : 7 - vc, sq = 'abcdefgh'[c] + (8 - r), light = (r + c) % 2 === 0, pc = rows[r][c];
    let cl = 'sq ' + (light ? 'lt' : 'dk');
    if (o.last && (sq === o.last.from || sq === o.last.to)) cl += ' hl';
    if (sq === o.sel) cl += ' sel';
    if (o.targets && o.targets.includes(sq)) cl += ' tgt';
    if (o.hint === sq) cl += ' hint';
    if (o.marks && o.marks[sq]) cl += ' ' + o.marks[sq];
    let inner = pc ? '<span class="pc pc-' + (pc === pc.toUpperCase() ? 'w' : 'b') + pc.toUpperCase() + '"></span>' : '';
    const cc = light ? '#56793A' : '#FFFFFF';
    if (vc === 0) inner += '<span class="co" style="top:4px;left:4px;color:' + cc + '">' + (8 - r) + '</span>';
    if (vr === 7) inner += '<span class="co" style="bottom:4px;right:4px;color:' + cc + '">' + 'abcdefgh'[c] + '</span>';
    h += '<div class="' + cl + '" data-sq="' + sq + '" role="gridcell" aria-label="' + sq + (pc ? ' ' + (pc === pc.toUpperCase() ? 'white ' : 'black ') + ({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' })[pc.toLowerCase()] : '') + '">' + inner + '</div>';
  }
  return h;
}
let checkW = null;
async function checker() {
  if (!checkW) { checkW = await CL.startEngine(); checkW.postMessage('setoption name MultiPV value 1'); }
  return checkW;
}
// Score of a position for the side to move, in centipawns (mate as +-(10000 - n)).
function scoreFen(w, fen, go) {
  return new Promise(res => {
    let cp = 0;
    w.onmessage = e => {
      const l = String(e.data), s = l.match(/score (cp|mate) (-?\d+)/);
      if (s && !/bound/.test(l)) { cp = +s[2]; if (s[1] === 'mate') cp = cp > 0 ? 10000 - cp : -10000 - cp; }
      if (l.startsWith('bestmove')) res(cp);
    };
    w.postMessage('position fen ' + fen);
    w.postMessage(go || 'go depth 14 movetime 700');
  });
}
// Win chance for the player who just moved, after the move: from the opponent's score.
async function winAfter(fen) {
  const t = new Chess(fen);
  if (t.in_checkmate()) return 1;
  if (t.game_over()) return 0.5;
  return 1 - CL.wpW(await scoreFen(await checker(), fen));
}

// ---------------------------------------------------------------------------
// 2. Puzzles from your own mistakes, with spaced repetition
// ---------------------------------------------------------------------------
const PUZ = 'ccr-puz', DAY = 864e5, STEPS = [1, 3, 7, 16, 35], RETRY = 10 * 60 * 1000;
const PZ_CLS = ['mistake', 'miss', 'blunder'];
const SEVN = { mistake: 1, miss: 2, blunder: 3 };
let PS = rd(PUZ, {});
backupParts.push(() => ({ puzzles: rd(PUZ, {}) }));
restoreParts.push(j => {
  if (!j || !j.puzzles || typeof j.puzzles !== 'object') return;
  const cur = rd(PUZ, {});
  for (const [id, s] of Object.entries(j.puzzles)) if (s && (!cur[id] || (s.last || 0) > (cur[id].last || 0))) cur[id] = s;
  wr(PUZ, cur); PS = cur;
});

function allPuzzles() {
  const out = [];
  for (const d of savedGames()) {
    for (let k = 1; k <= d.san.length; k++) {
      const c = d.cls[k];
      if (!PZ_CLS.includes(c) || (k % 2 === 1) !== (d.me === 'w')) continue;
      if ((d.loss[k] || 0) < 0.1 || !d.best[k - 1] || d.best[k - 1] === '(none)') continue;
      out.push({ pid: d.id + ':' + k, d, k, cls: c, opp: d.me === 'w' ? d.black : d.white });
    }
  }
  return out;
}
function pzQueue() {
  const all = allPuzzles(), now = Date.now();
  const due = all.filter(p => PS[p.pid] && PS[p.pid].due <= now).sort((a, b) => PS[a.pid].due - PS[b.pid].due);
  const fresh = all.filter(p => !PS[p.pid]).sort((a, b) => (b.d.savedAt || 0) - (a.d.savedAt || 0) || SEVN[b.cls] - SEVN[a.cls] || a.k - b.k);
  const later = all.filter(p => PS[p.pid] && PS[p.pid].due > now).sort((a, b) => PS[a.pid].due - PS[b.pid].due);
  return { all, due, fresh, later, ready: due.concat(fresh) };
}
function record(p, clean) {
  const s = PS[p.pid] || { b: 0, n: 0, ok: 0 };
  s.n++; s.last = Date.now();
  if (clean) { s.ok++; s.b = Math.min(s.b + 1, STEPS.length); s.due = Date.now() + STEPS[s.b - 1] * DAY; }
  else { s.b = 0; s.due = Date.now() + RETRY; }
  PS[p.pid] = s;
  wr(PUZ, PS);
}

// The moves to find: the engine's best move, and while the line stays forcing
// (your next move is a capture, check or promotion) up to two more of yours.
function solutionOf(g, k) {
  const pv = (g.pv[k - 1] || '').split(' ').filter(Boolean);
  const u = pv[0] === g.best[k - 1] ? pv : [g.best[k - 1]];
  const ch = new Chess(g.fens[k - 1]), sol = [];
  for (let j = 0; j < u.length; j += 2) {
    const m = ch.move(uciMove(u[j]));
    if (!m) break;
    sol.push(u[j]);
    if (ch.in_checkmate() || sol.length >= 5 || !u[j + 1] || !u[j + 2]) break;
    const t = new Chess(ch.fen()), r = t.move(uciMove(u[j + 1])), n = r && t.move(uciMove(u[j + 2]));
    if (!n || !(n.captured || n.promotion || /[+#]/.test(n.san))) break;
    ch.move(uciMove(u[j + 1])); sol.push(u[j + 1]);
  }
  return sol;
}

let P = null;
const pzSay = h => { $('pzNote').innerHTML = h; };
function pzDraw() {
  if (!P) return;
  const tg = P.sel && !P.done ? P.ch.moves({ square: P.sel, verbose: true }).map(m => m.to) : [];
  $('pzBoard').innerHTML = boardHtml(P.ch.fen(), { bottom: P.side, last: P.last, sel: P.sel, targets: tg, hint: P.hintSq, marks: P.marks });
  const mine = Math.ceil(P.sol.length / 2), done = Math.min(mine, Math.ceil(P.step / 2));
  $('pzStep').textContent = mine > 1 ? 'Move ' + Math.min(done + 1, mine) + ' of ' + mine : '';
}
function pzStart(p) {
  const g = gameOf(p.d);
  if (!g || !g.fens[p.k - 1]) return false;
  const sol = solutionOf(g, p.k);
  if (!sol.length) return false;
  P = { p, g, k: p.k, sol, ch: new Chess(g.fens[p.k - 1]), side: g.fens[p.k - 1].split(' ')[1], step: 0, wrong: 0, helped: false, recorded: false, done: false, busy: false,
        last: p.k > 1 ? g.vm[p.k - 2] : null, sel: null, hintSq: null, marks: null };
  const s = PS[p.pid];
  $('pzName').textContent = (P.side === 'w' ? 'White' : 'Black') + ' to move';
  pzDraw();
  pzSay('<b>Find a better move than ' + esc(g.san[p.k - 1]) + '.</b><div class="mut">From your game vs ' + esc(p.opp) + (p.d.date ? ', ' + esc(p.d.date) : '') + ', move ' + Math.ceil(p.k / 2) + '. In the game you played ' + esc(g.san[p.k - 1]) + ' here, ' + (p.cls === 'miss' ? 'a miss' : 'a ' + p.cls) + '.' + (s ? ' You have seen this one ' + s.n + (s.n > 1 ? ' times.' : ' time.') : '') + '</div>');
  $('pzShow').disabled = false; $('pzHint').disabled = false;
  pzSide();
  return true;
}
function pzNext(skip) {
  const q = pzQueue();
  const list = q.ready.filter(p => !skip || !P || p.pid !== P.p.pid);
  for (const p of list) if (pzStart(p)) return;
  P = null;
  $('pzBoard').innerHTML = boardHtml('8/8/8/8/8/8/8/8 w - - 0 1', { bottom: 'w' });
  $('pzName').textContent = q.all.length ? 'All done for now' : 'No puzzles yet';
  $('pzStep').textContent = '';
  $('pzShow').disabled = true; $('pzHint').disabled = true;
  const nx = q.later[0];
  pzSay(q.all.length ? '<b>Nothing due right now.</b> <span class="mut">Your next puzzle comes back ' + whenText(PS[nx.pid].due) + '. Review more games to get new ones.</span>'
    : '<b>No puzzles yet.</b> <span class="mut">Review a few of your games. Every mistake, miss or blunder of yours becomes a puzzle here.</span>');
  pzSide();
}
function whenText(t) {
  const d = t - Date.now();
  if (d <= 0) return 'now';
  if (d < 3600e3) return 'in ' + Math.max(1, Math.round(d / 60e3)) + ' min';
  if (d < DAY) return 'in ' + Math.round(d / 3600e3) + ' h';
  const n = Math.round(d / DAY);
  return n === 1 ? 'tomorrow' : 'in ' + n + ' days';
}
function pzSide() {
  const q = pzQueue(), vals = Object.values(PS);
  const mastered = q.all.filter(p => PS[p.pid] && PS[p.pid].b >= STEPS.length).length;
  $('pzStats').innerHTML = [['Ready now', q.ready.length], ['New', q.fresh.length], ['Solved cleanly', vals.reduce((a, s) => a + (s.ok || 0), 0)], ['Learned', mastered + ' of ' + q.all.length]]
    .map(c => '<div class="card"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div></div>').join('');
  const n = q.ready.length, tab = $('pzTabN');
  if (tab) { tab.hidden = !n; tab.textContent = n > 99 ? '99+' : n; }
  const rows = q.due.concat(q.fresh, q.later).slice(0, 10);
  $('pzList').innerHTML = rows.length ? rows.map(p => {
    const s = PS[p.pid], when = !s ? 'new' : s.due <= Date.now() ? 'due now' : whenText(s.due);
    return '<button type="button" class="pzi tm" data-pz="' + esc(p.pid) + '" style="width:100%;margin:0 0 6px"><b>' + CL.badge(p.cls) + ' ' + esc(Math.ceil(p.k / 2) + (p.k % 2 ? '. ' : '... ') + p.d.san[p.k - 1] + ' vs ' + p.opp) + '</b><span>' + esc(when) + '</span></button>';
  }).join('') + (q.all.length > rows.length ? '<p class="tip" style="margin:8px 0 0">' + (q.all.length - rows.length) + ' more.</p>' : '')
    : '<p class="mut" style="margin:0">Review a few of your games first. Your mistakes from them show up here.</p>';
}

function pzFinish(msg) {
  P.done = true; P.sel = null;
  const clean = P.wrong === 0 && !P.helped;
  if (!P.recorded) { record(P.p, clean); P.recorded = true; }
  const L = CL.coachMove(P.g, P.k), s = PS[P.p.pid];
  pzDraw();
  pzSay('<span class="lab"><b>' + CL.badge(clean ? 'best' : 'good') + ' ' + esc(msg) + '</b></span>' +
    (L && L.what ? '<div style="margin-top:6px"><b>Why ' + esc(P.g.san[P.k - 1]) + ' was wrong:</b> ' + esc(L.what) + '</div>' : '') +
    (L && L.habit ? '<div style="margin-top:6px"><b>Habit:</b> ' + esc(L.habit) + '</div>' : '') +
    '<div class="mut" style="margin-top:6px">' + (clean ? 'Solved cleanly. It comes back ' + whenText(s.due) + '.' : 'It comes back ' + whenText(s.due) + ' so you can try again.') + '</div>' +
    '<button type="button" id="pzOpen" style="margin-top:8px">Open this move in the review</button>');
  $('pzShow').disabled = true; $('pzHint').disabled = true;
  pzSide();
}
function pzFail() { if (!P.recorded) { record(P.p, false); P.recorded = true; pzSide(); } }

// play the opponent's reply from the solution, then wait for the next move
function pzReply() {
  const u = P.sol[P.step];
  P.busy = true;
  setTimeout(() => {
    if (!P || !u) return;
    const m = P.ch.move(uciMove(u));
    P.step++; P.last = m; P.marks = null; P.busy = false;
    pzDraw();
    pzSay('<b>Good. ' + esc(m.san) + ' is the reply.</b> <span class="mut">Keep going: there is more to win.</span>');
  }, 500);
}
async function pzTry(from, to) {
  const want = P.sol[P.step];
  const t = new Chess(P.ch.fen());
  const promo = want && want.slice(0, 4) === from + to && want[4] ? want[4] : 'q';
  const m = t.move({ from, to, promotion: promo });
  if (!m) return;
  const uci = m.from + m.to + (m.promotion || '');
  P.sel = null; P.hintSq = null;
  const good = () => {
    P.ch.move({ from, to, promotion: promo }); P.last = m; P.marks = { [m.to]: 'ok' }; P.step++;
    if (P.step >= P.sol.length || P.ch.game_over()) { pzFinish(t.in_checkmate() ? m.san + ' is checkmate!' : m.san + ' is right!'); return; }
    pzDraw(); pzReply();
  };
  if (uci === want || t.in_checkmate()) { good(); return; }
  if (P.step === 0 && uci === P.g.ucis[P.k - 1]) { P.wrong++; pzFail(); P.marks = { [m.to]: 'no' }; pzDraw(); pzSay('<b>' + esc(m.san) + ' is what you played in the game.</b> <span class="mut">Look for something better. Check what that move leaves undefended.</span>'); return; }
  // any other move: ask Stockfish whether it is about as good as the solution
  P.busy = true; P.marks = { [m.to]: 'sel' }; pzDraw();
  pzSay('<span class="mut">Checking ' + esc(m.san) + ' with Stockfish...</span>');
  let ok = false;
  try {
    const before = P.ch.fen(), b2 = new Chess(before); b2.move(uciMove(want));
    const mineW = await winAfter(t.fen()), bestW = await winAfter(b2.fen());
    ok = mineW >= bestW - 0.03 || (mineW >= 0.97 && bestW >= 0.97);
  } catch (e) { ok = false; }
  P.busy = false;
  if (!P || P.done) return;
  if (ok) {
    P.ch.move({ from, to, promotion: promo }); P.last = m; P.marks = { [m.to]: 'ok' };
    const best = new Chess(P.g.fens[P.k - 1]).move(uciMove(P.sol[0]));
    pzFinish(m.san + ' works too.' + (P.step === 0 && best ? ' The engine\'s first choice was ' + best.san + '.' : ''));
    return;
  }
  P.wrong++; pzFail(); P.marks = { [m.to]: 'no' }; pzDraw();
  pzSay('<b>Not ' + esc(m.san) + '.</b> <span class="mut">It gives back most of the advantage. Try again' + (P.wrong >= 2 ? ', or tap Hint.' : '.') + '</span>');
}
$('pzBoard').addEventListener('click', e => {
  const el = e.target.closest('[data-sq]');
  if (!el || !P || P.done || P.busy) return;
  const sq = el.dataset.sq, pc = P.ch.get(sq);
  if (pc && pc.color === P.ch.turn()) { P.sel = sq === P.sel ? null : sq; P.marks = null; pzDraw(); return; }
  if (!P.sel) return;
  if (!P.ch.moves({ square: P.sel, verbose: true }).some(m => m.to === sq)) { P.sel = null; pzDraw(); return; }
  pzTry(P.sel, sq);
});
$('pzHint').onclick = () => {
  if (!P || P.done) return;
  P.helped = true; pzFail();
  const u = P.sol[P.step], m = new Chess(P.ch.fen()).move(uciMove(u));
  P.hintSq = u.slice(0, 2); pzDraw();
  const L = P.step === 0 ? CL.coachMove(P.g, P.k) : null, th = L && CL.THEMES[L.theme] ? CL.THEMES[L.theme][0] : '';
  pzSay('<b>Hint:</b> move the ' + ({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' })[m.piece] + ' outlined in blue' + (m.captured ? '. It captures something.' : /\+/.test(m.san) ? '. It gives check.' : '.') + (th ? ' <span class="mut">Theme: ' + esc(th) + '.</span>' : ''));
};
$('pzShow').onclick = () => {
  if (!P || P.done) return;
  P.helped = true; pzFail();
  const sans = [];
  while (P.step < P.sol.length) { const m = P.ch.move(uciMove(P.sol[P.step])); if (!m) break; sans.push(m.san); P.last = m; P.step++; }
  P.marks = P.last ? { [P.last.to]: 'ok' } : null;
  const first = new Chess(P.g.fens[P.k - 1]).move(uciMove(P.sol[0]));
  pzFinish('The answer was ' + (first ? first.san : sans[0]) + (sans.length > 1 ? ' (' + sans.join(' ') + ')' : '') + '.');
};
$('pzNext').onclick = () => pzNext(true);
$('pzNote').addEventListener('click', e => {
  if (e.target.closest('#pzOpen') && P) { const g = gameOf(P.p.d); if (g) { CL.open(CL.fromDoc(P.p.d), P.k); } }
});
$('pzList').addEventListener('click', e => {
  const b = e.target.closest('[data-pz]');
  if (!b) return;
  const p = allPuzzles().find(x => x.pid === b.dataset.pz);
  if (p && pzStart(p)) $('pzBoard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
// start a puzzle the first time the tab is opened, keep the counts fresh
let pzSeen = false;
new MutationObserver(() => { if (!$('puzzles').hidden && !pzSeen) { pzSeen = true; pzNext(false); } }).observe($('puzzles'), { attributes: true, attributeFilter: ['hidden'] });
if (!$('puzzles').hidden) { pzSeen = true; pzNext(false); }
on('cl:games', () => { if (pzSeen && !P) pzNext(false); else pzSide(); });
pzSide();

// ---------------------------------------------------------------------------
// 3. Your openings in real games, linked to the trainer
// ---------------------------------------------------------------------------
const accOf = loss => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * (loss || 0) * 100) - 3.1669));
const resOf = d => d.result === '1/2-1/2' ? 'D' : d.result === '*' ? '?' : (d.result === '1-0') === (d.me === 'w') ? 'W' : 'L';
const OPEN_PLIES = 24;
const LF = new Map();
function lineFens(l) {
  if (!LF.has(l.id)) { const c = new Chess(), out = [c.fen().split(' ').slice(0, 2).join(' ')]; for (const m of l.mv.split(' ')) { if (!c.move(m)) break; out.push(c.fen().split(' ').slice(0, 2).join(' ')); } LF.set(l.id, out); }
  return LF.get(l.id);
}                    // "the opening" for these numbers: your first 12 moves
function openingFacts(d) {
  const g = gameOf(d);
  if (!g) return null;
  const T = g.san.length;
  let b = 0; while (b < T && g.book && g.book[b + 1]) b++;
  const accs = [], slips = [];
  for (let k = 1; k <= Math.min(T, OPEN_PLIES); k++) {
    if (!isMine(g, k) || !g.cls[k]) continue;
    accs.push(accOf(g.loss[k]));
    if (BADC.includes(g.cls[k]) && k <= 30) slips.push(k);
  }
  // the trainer line your game followed longest (at least two moves each). Compared by
  // position, so a different move order that reaches the same position still counts.
  let best = null;
  const pos = f => f.split(' ').slice(0, 2).join(' ');
  CL.LINES.forEach((l, li) => {
    if (l.side !== d.me) return;
    const lf = lineFens(l);
    let p = 0;
    for (let j = 1; j < lf.length && j <= T; j++) if (pos(g.fens[j]) === lf[j]) p = j;
    if (p < 4 || (best && p <= best.p)) return;
    const mv = l.mv.split(' ');
    best = { li, l, p, left: p < mv.length && p < T ? { ply: p + 1, played: g.san[p], line: mv[p], mine: isMine(g, p + 1) } : null };
  });
  return { d, g, book: b, leftByMe: b < T && isMine(g, b + 1), acc: accs.length ? accs.reduce((a, x) => a + x, 0) / accs.length : null, slips, line: best,
           fam: (d.me === 'w' ? 'White: ' : 'Black: ') + String(g.opening || d.opening || 'Unknown opening').split(':')[0].trim() };
}
function renderMyOpenings() {
  const box = $('myOpen');
  if (!box) return;
  const games = savedGames().slice(0, 60);
  if (!games.length) { box.innerHTML = '<h2>Your openings in real games</h2><p class="mut" style="margin:0">Review a few games and this shows how your openings go: your results, where you leave known theory, your first slips, and the trainer line to practice.</p>'; return; }
  const by = {};
  for (const d of games) {
    const f = openingFacts(d);
    if (!f) continue;
    const o = by[f.fam] = by[f.fam] || { fam: f.fam, n: 0, W: 0, D: 0, L: 0, acc: [], book: [], meLeft: 0, slips: [], lines: {} };
    o.n++; o[resOf(d)] = (o[resOf(d)] || 0) + 1;
    if (f.acc != null) o.acc.push(f.acc);
    o.book.push(f.book); if (f.leftByMe) o.meLeft++;
    for (const k of f.slips.slice(0, 1)) o.slips.push({ d, k, san: d.san[k - 1], cls: d.cls[k], opp: d.me === 'w' ? d.black : d.white });
    if (f.line) { const L = o.lines[f.line.li] = o.lines[f.line.li] || { l: f.line.l, li: f.line.li, n: 0, left: [], opp: [], p: 0 }; L.n++; L.p = Math.max(L.p, f.line.p); if (f.line.left) (f.line.left.mine ? L.left : L.opp).push(f.line.left); }
  }
  const groups = Object.values(by).sort((a, b) => b.n - a.n);
  const score = o => (o.W + o.D / 2) / o.n;
  const weak = groups.filter(o => o.n >= 2).sort((a, b) => score(a) - score(b))[0];
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  let h = '<h2>Your openings in real games</h2><p class="tip" style="margin:0 0 6px">From your last ' + games.length + ' reviewed game' + (games.length > 1 ? 's' : '') + '. Opening accuracy counts your first 12 moves.</p>';
  if (weak && score(weak) < 0.5) h += '<p style="margin:0 0 6px"><b>Work on:</b> ' + esc(weak.fam) + ', where you scored ' + Math.round(score(weak) * 100) + '% in ' + weak.n + ' games.</p>';
  h += groups.slice(0, 8).map(o => {
    const acc = o.acc.length ? o.acc.reduce((a, x) => a + x, 0) / o.acc.length : null, bm = med(o.book);
    const theory = bm > 0 ? 'Known theory ends around move ' + Math.ceil((bm + 1) / 2) + (o.n > 1 ? ', and ' + (o.meLeft * 2 > o.n ? 'you usually' : 'your opponent usually') + ' leaves it first.' : (o.meLeft ? ', and you left it first.' : ', and your opponent left it first.')) : 'Your games leave known theory right away.';
    const lines = Object.values(o.lines).sort((a, b) => b.n - a.n);
    let tr = '';
    if (lines.length) {
      tr = lines.slice(0, 2).map(L => { const lf = L.left[0];
        return '<div style="margin-top:6px"><button type="button" class="tm" data-line="' + L.li + '">Practice: ' + esc(L.l.name) + '</button>' +
        (lf ? ' <span class="tip">In your game you played ' + esc(Math.ceil(lf.ply / 2) + (lf.ply % 2 ? '. ' : '... ') + lf.played) + ' where the line plays ' + esc(lf.line) + '.</span>'
          : L.opp[0] ? ' <span class="tip">Your game follows it for ' + Math.ceil(L.p / 2) + ' moves, then your opponent played ' + esc(Math.ceil(L.opp[0].ply / 2) + (L.opp[0].ply % 2 ? '. ' : '... ') + L.opp[0].played) + '.</span>'
          : ' <span class="tip">' + (L.n > 1 ? L.n + ' of your games follow' : 'Your game follows') + ' this line.</span>') + '</div>'; }).join('');
    } else tr = '<div class="tip" style="margin-top:6px">No trainer line for this opening yet.</div>';
    return '<div class="th"><div class="thh"><b>' + esc(o.fam) + '</b><span>' + o.n + (o.n > 1 ? ' games' : ' game') + ': ' + [o.W && o.W + ' won', o.D && o.D + ' drawn', o.L && o.L + ' lost'].filter(Boolean).join(', ') + '</span></div>' +
      (acc != null ? '<div class="accbar" style="margin:8px 0"><div style="width:' + Math.round(acc) + '%"></div></div>' : '') +
      '<div class="tip">' + (acc != null ? 'Opening accuracy ' + Math.round(acc) + '%. ' : '') + esc(theory) + '</div>' +
      (o.slips.length ? '<div class="thm"><span class="tip" style="align-self:center">First slips:</span>' + o.slips.slice(0, 3).map(s => '<button type="button" class="tm" data-open="' + esc(s.d.id) + '" data-k="' + s.k + '">' + CL.badge(s.cls) + esc(Math.ceil(s.k / 2) + (s.k % 2 ? '. ' : '... ') + s.san + ' vs ' + s.opp) + '</button>').join('') + '</div>' : '') +
      tr + '</div>';
  }).join('');
  box.innerHTML = h;
}
$('myOpen').addEventListener('click', e => {
  const l = e.target.closest('[data-line]'), o = e.target.closest('[data-open]');
  if (l) { CL.tStart(CL.LINES[+l.dataset.line]); $('tboard').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  if (o) { const d = CL.hist.find(x => x.id === o.dataset.open); if (d) CL.open(CL.fromDoc(d), +o.dataset.k); }
});
on('cl:games', renderMyOpenings);
on('cl:book', () => { GC.clear(); renderMyOpenings(); });
renderMyOpenings();

// ---------------------------------------------------------------------------
// 4. Works offline and installs like an app (sw.js and manifest.webmanifest)
// ---------------------------------------------------------------------------
let installEvt = null;
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
async function offlineReady() {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller || !window.caches) return false;
  try { const c = await caches.open('cl-core-v1'); return !!(await c.match('index.html', { ignoreSearch: true })) && !!(await c.match('stockfish-19-lite-single.wasm')); } catch (e) { return false; }
}
async function renderAppBox() {
  const box = $('appBox');
  if (!box) return;
  const ready = await offlineReady();
  let how;
  if (standalone()) how = 'You are using the installed app.';
  else if (installEvt) how = '<button type="button" id="installBtn" class="go">Install Chess Lab</button>';
  else if (isIOS) how = 'On iPhone or iPad: open this page in Safari, tap Share, then Add to Home Screen.';
  else how = 'In Chrome or Edge: open the browser menu and choose Install, or Add to Home screen on Android.';
  box.innerHTML = '<h2>Use it as an app</h2><p class="sm" style="margin:0 0 8px">' + (ready
    ? '<b>Works offline.</b> The site and the engine are saved on this device, so you can review games, solve puzzles and drill openings without a connection. Loading new games from chess.com still needs one.'
    : 'Once this page has loaded fully online, it also works offline: reviews, puzzles and the opening trainer.') + '</p><div class="sm">' + how + '</div>';
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; renderAppBox(); });
window.addEventListener('appinstalled', () => { installEvt = null; renderAppBox(); });
document.addEventListener('click', async e => {
  if (!e.target.closest('#installBtn') || !installEvt) return;
  installEvt.prompt();
  try { await installEvt.userChoice; } catch (x) {}
  installEvt = null; renderAppBox();
});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => setTimeout(renderAppBox, 1500)).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => setTimeout(renderAppBox, 1500));
}
renderAppBox();

})();

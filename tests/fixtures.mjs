// Stand-in for the chess.com API, for places where the real one cannot be reached
// (sandboxes, CI) and for screenshots. Same shape as the two endpoints the site calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const USER = 'ibrahimaliKH';

// The example game that ships with the site, read from index.html.
export function examplePgn() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return JSON.parse('"' + html.match(/const EXAMPLE="((?:[^"\\]|\\.)*)";/)[1] + '"');
}

// Short well-known games, used only as extra rows in the mocked list.
const EXTRA = [
  ['test_opponent_a', 1180, 'w', '1-0', '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0'],
  ['test_opponent_b', 1102, 'b', '1-0', '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Nf6 5. Qd3 e5 6. dxe5 Qa5+ 7. Bd2 Qxe5 8. O-O-O Nxe4 9. Qd8+ Kxd8 10. Bg5+ Kc7 11. Bd8# 1-0'],
  ['test_opponent_c', 1215, 'w', '1-0', '1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5# 1-0'],
];

export function chessComGames() {
  const now = Math.floor(Date.now() / 1000);
  const ex = examplePgn();
  const games = [{ pgn: ex, rules: 'chess', time_class: 'rapid', end_time: now - 3600, white: { username: 'belenski94', rating: 1144, result: 'checkmated' }, black: { username: USER, rating: 1127, result: 'win' } }];
  EXTRA.forEach(([opp, elo, mine, res, moves], k) => {
    const me = { username: USER, rating: 1130 + k, result: (res === '1-0') === (mine === 'w') ? 'win' : 'checkmated' };
    const them = { username: opp, rating: elo, result: me.result === 'win' ? 'checkmated' : 'win' };
    const white = mine === 'w' ? me : them, black = mine === 'w' ? them : me;
    const pgn = '[Event "Live Chess"]\n[Site "Chess.com"]\n[Date "2026.11.2' + (4 - k) + '"]\n[White "' + white.username + '"]\n[Black "' + black.username + '"]\n[Result "' + res + '"]\n[WhiteElo "' + white.rating + '"]\n[BlackElo "' + black.rating + '"]\n\n' + moves;
    games.push({ pgn, rules: 'chess', time_class: 'rapid', end_time: now - 86400 * (k + 1), white, black });
  });
  return games.reverse();   // the API lists oldest first
}

// Answer both chess.com endpoints from the fixture.
export async function mockChessCom(page) {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  await page.route('https://api.chess.com/**', route => {
    const u = new URL(route.request().url());
    const body = u.pathname.endsWith('/archives')
      ? { archives: ['https://api.chess.com/pub/player/' + USER.toLowerCase() + '/games/2026/11'] }
      : { games: chessComGames() };
    route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  });
}

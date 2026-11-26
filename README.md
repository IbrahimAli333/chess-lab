# Ibrahim Ali's Chess Lab

A personal chess training site: game review with move ratings and coaching, an opening trainer, and progress tracking.
Everything runs in the browser. Stockfish analyzes on your own device, and your games are saved in your browser.

## What it does
- **Review** a chess.com game (pick it from your recent games or paste the PGN). Every move gets a rating, and every inaccuracy, mistake, miss and blunder gets a short lesson: what went wrong, the line your opponent can play now, the best move and why, and a habit to build. A blue arrow shows the best move on the board, the eval graph jumps to any point of the game, and the Mistake buttons (or N and P) step through your mistakes.
- **Your clock**: for chess.com games, the Summary tab shows the time you spent on every move, how many of your mistakes came with under a minute left, mistakes played in under 3 seconds, and your long thinks. Progress shows the same across games.
- **Deep check**: under any move, checks it again with the full-strength Stockfish 19 (the review itself uses the smaller lite network). The first time downloads about 95 MB from unpkg.com, after that it takes about 10 seconds.
- **Puzzles**: every mistake, miss and blunder of yours in a reviewed game becomes a puzzle. Solve it cleanly and it comes back after 1, 3, 7, 16 and 35 days; miss it and it comes back in 10 minutes. Any move Stockfish rates as good as the answer counts.
- **Openings**: your openings in real games (results, opening accuracy, where you leave known theory, your first slips, the trainer line your games reach), and the trainer itself in Learn or Practice mode.
- **Progress**: results, accuracy, "What to work on", which groups the mistakes from your last 20 reviewed games by theme with examples you can open, and your clock across games.
- **Offline and on your phone**: after one visit online it works offline, and it can be installed like an app (Progress, Use it as an app).

## Sharing it
Anyone with the link can use it. A first visit starts with an empty username box and a neutral title; each person's games and progress stay in their own browser. The site owner's setup (title, the Copy game for Claude text and two trainer line names) appears only when the username is the owner's, set in `OWNER` in `index.html`.

## Where things are
- `index.html`: the page, the review, the lessons (`coachMove()`), the trainer.
- `train.js`: clock analysis, puzzles, your openings, offline and install, deep check. It talks to the page only through `window.CL`.
- `sw.js` and `manifest.webmanifest`: offline support and install.

## Saved data
Everything stays in your browser. The original keys are unchanged: `ccr-user`, `ccr-games` (reviewed games), `ccr-open` (trainer progress). Two keys were added: `ccr-clk` (clock times of reviewed games) and `ccr-puz` (puzzle schedule). Download backup writes `games`, `openings` and `saved` exactly as before, plus `clocks` and `puzzles`; older backups without those still restore.

## How the lessons stay truthful
The lesson for a move is built by `coachMove()` in `index.html` from three things only: the positions (checked with chess.js), the engine line stored for the position before the move, and the engine line stored for the position after it. A named idea (fork, pin, removing the defender, trapped piece and so on) is only stated when it can be verified on the board, and a material claim only when the line really wins the material. When nothing specific can be verified, the lesson says so and shows the engine's move, what that move does, and its line.

## Hosting
Plain static files, no build step and no backend. Pushes to `main` deploy to Netlify; GitHub Actions runs the tests on every pull request. netlify.toml sends Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp so the browser allows the multi-threaded engine. Without those headers the site falls back to the single-threaded engine.

## Tests
`cd tests && npm install && npx playwright install chromium && npm test` runs three things:
- `tactics.cjs`: unit tests for the tactic detector and the lessons, with positive and negative positions for every idea.
- `features.mjs`: clock analysis, puzzles, your openings and offline use, in a real browser with real games from `tests/fixtures`. Add `--deep` to also run the deep check (downloads about 95 MB).
- `review.mjs`: a real browser against the local files (it reads the headers from netlify.toml). It reviews the example game with the real engine and checks ratings, the saved format, the best line, the lessons, the summaries, navigation, old backups and the phone layout. Add `--url=https://...` to test a deployed copy.

If the machine cannot reach api.chess.com, the recent games list is answered from `tests/fixtures.mjs` and the test says so. If it cannot reach Google Fonts, only the font check is skipped.

`node shots.mjs` writes laptop and phone screenshots to `tests/screenshots`.

`node quality.mjs --user=<chess.com username>` (needs a native `stockfish` on PATH) reviews real games in the browser and compares every position with native Stockfish at depth 22. With the current limits (depth 16, at most 0.8 s per position, 60 s per game) four real games gave: average eval difference of about 2 win-percent, every real mistake and blunder flagged, no false alarms, reviews in 16 to 45 seconds.

## Credits and licenses
- Stockfish 19 lite compiled to WebAssembly by Stockfish.js (multi-threaded stockfish-19-lite.js and single-threaded stockfish-19-lite-single.js with their .wasm files, from the npm package "stockfish" 19.0.1), GPLv3. See STOCKFISH-LICENSE.txt. Source: https://github.com/nmrugg/stockfish.js and https://github.com/official-stockfish/Stockfish. Lite network by Chris Bao (sscg13).
- Deep check uses the full Stockfish 19 from the same package: stockfish-19.js and stockfish-19-single.js are served here, and their .wasm files (about 95 MB each) are loaded from https://unpkg.com/stockfish@19.0.1/ only when you press Deep check. GPLv3.
- Stockfish 10 compiled to JavaScript (stockfish.js), GPLv3, kept as a fallback for browsers that cannot run the newer build. See STOCKFISH-LICENSE.txt. Source: https://github.com/official-stockfish/Stockfish and https://github.com/niklasf/stockfish.js
- chess.js 0.10.3, BSD 2-Clause. See CHESSJS-LICENSE.txt
- Piece artwork by Colin M.L. Burnett, CC BY-SA 3.0
- Opening names from lichess-org/chess-openings, CC0

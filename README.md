# Ibrahim Ali's Chess Lab

A personal chess training site: game review with move ratings and coaching, an opening trainer, and progress tracking.
Everything runs in the browser. Stockfish analyzes on your own device, and your games are saved in your browser.

## What it does
- **Review** a chess.com game (pick it from your recent games or paste the PGN). Every move gets a rating, and every inaccuracy, mistake, miss and blunder gets a short lesson: what went wrong, the line your opponent can play now, the best move and why, and a habit to build. A blue arrow shows the best move on the board, the eval graph jumps to any point of the game, and the Mistake buttons (or N and P) step through your mistakes.
- **Openings**: play your lines against the trainer in Learn or Practice mode.
- **Progress**: results, accuracy, and "What to work on", which groups the mistakes from your last 20 reviewed games by theme with examples you can open.

## How the lessons stay truthful
The lesson for a move is built by `coachMove()` in `index.html` from three things only: the positions (checked with chess.js), the engine line stored for the position before the move, and the engine line stored for the position after it. A named idea (fork, pin, removing the defender, trapped piece and so on) is only stated when it can be verified on the board, and a material claim only when the line really wins the material. When nothing specific can be verified, the lesson says so and shows the engine's move, what that move does, and its line.

## Hosting
Plain static files, no build step and no backend. netlify.toml sends Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp so the browser allows the multi-threaded engine. Without those headers the site falls back to the single-threaded engine.

## Tests
`cd tests && npm install && npx playwright install chromium && npm test` runs two things:
- `tactics.cjs`: unit tests for the tactic detector and the lessons, with positive and negative positions for every idea.
- `review.mjs`: a real browser against the local files (it reads the headers from netlify.toml). It reviews the example game with the real engine and checks ratings, the saved format, the best line, the lessons, the summaries, navigation, old backups and the phone layout. Add `--url=https://...` to test a deployed copy.

If the machine cannot reach api.chess.com, the recent games list is answered from `tests/fixtures.mjs` and the test says so. If it cannot reach Google Fonts, only the font check is skipped.

`node shots.mjs` writes laptop and phone screenshots to `tests/screenshots`.

`node quality.mjs --user=<chess.com username>` (needs a native `stockfish` on PATH) reviews real games in the browser and compares every position with native Stockfish at depth 22. With the current limits (depth 16, at most 0.8 s per position, 60 s per game) four real games gave: average eval difference of about 2 win-percent, every real mistake and blunder flagged, no false alarms, reviews in 16 to 45 seconds.

## Credits and licenses
- Stockfish 19 lite compiled to WebAssembly by Stockfish.js (multi-threaded stockfish-19-lite.js and single-threaded stockfish-19-lite-single.js with their .wasm files, from the npm package "stockfish" 19.0.1), GPLv3. See STOCKFISH-LICENSE.txt. Source: https://github.com/nmrugg/stockfish.js and https://github.com/official-stockfish/Stockfish. Lite network by Chris Bao (sscg13).
- Stockfish 10 compiled to JavaScript (stockfish.js), GPLv3, kept as a fallback for browsers that cannot run the newer build. See STOCKFISH-LICENSE.txt. Source: https://github.com/official-stockfish/Stockfish and https://github.com/niklasf/stockfish.js
- chess.js 0.10.3, BSD 2-Clause. See CHESSJS-LICENSE.txt
- Piece artwork by Colin M.L. Burnett, CC BY-SA 3.0
- Opening names from lichess-org/chess-openings, CC0

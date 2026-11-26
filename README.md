# Ibrahim Ali's Chess Lab

A personal chess training site: game review with move ratings, an opening trainer, and progress tracking.
Everything runs in the browser. Stockfish analyzes on your own device, and your games are saved in your browser.

## Hosting
Plain static files, no build step and no backend. netlify.toml sends Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp so the browser allows the multi-threaded engine. Without those headers the site falls back to the single-threaded engine.

## Tests
`cd tests && npm install && npx playwright install chromium && npm test` runs a real browser against the local files (it reads the headers from netlify.toml). Add `--url=https://...` to test a deployed copy.

`node quality.mjs --user=<chess.com username>` (needs a native `stockfish` on PATH) reviews real games in the browser and compares every position with native Stockfish at depth 22. With the current limits (depth 16, at most 0.8 s per position, 60 s per game) four real games gave: average eval difference of about 2 win-percent, every real mistake and blunder flagged, no false alarms, reviews in 16 to 45 seconds.

## Credits and licenses
- Stockfish 19 lite compiled to WebAssembly by Stockfish.js (multi-threaded stockfish-19-lite.js and single-threaded stockfish-19-lite-single.js with their .wasm files, from the npm package "stockfish" 19.0.1), GPLv3. See STOCKFISH-LICENSE.txt. Source: https://github.com/nmrugg/stockfish.js and https://github.com/official-stockfish/Stockfish. Lite network by Chris Bao (sscg13).
- Stockfish 10 compiled to JavaScript (stockfish.js), GPLv3, kept as a fallback for browsers that cannot run the newer build. See STOCKFISH-LICENSE.txt. Source: https://github.com/official-stockfish/Stockfish and https://github.com/niklasf/stockfish.js
- chess.js 0.10.3, BSD 2-Clause. See CHESSJS-LICENSE.txt
- Piece artwork by Colin M.L. Burnett, CC BY-SA 3.0
- Opening names from lichess-org/chess-openings, CC0

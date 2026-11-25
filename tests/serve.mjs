// Tiny static server for local testing. Reads the [[headers]] blocks from
// netlify.toml (if present) so local runs match what Netlify serves.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.css': 'text/css' };

export function netlifyHeaders() {
  const out = {};
  let toml = '';
  try { toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8'); } catch (e) { return out; }
  const block = toml.split('[[headers]]').slice(1).find(b => /for\s*=\s*"\/\*"/.test(b));
  if (!block) return out;
  const vals = block.split('[headers.values]')[1] || '';
  for (const m of vals.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"/gm)) out[m[1]] = m[2];
  return out;
}

export function serve({ port = 0, headers = netlifyHeaders() } = {}) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || file.includes('node_modules')) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', ...headers });
      res.end(buf);
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await serve({ port: +(process.argv[2] || 8080) });
  console.log('Serving ' + ROOT + ' at ' + url, netlifyHeaders());
}

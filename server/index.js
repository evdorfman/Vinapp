/**
 * Production server: serves the built app from dist/ and proxies Messages API
 * calls so the Anthropic key stays on the server.
 *
 *   npm run build && npm start
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANTHROPIC_PROXY_PATH, handleAnthropicRequest } from './anthropic-proxy.js';
import { loadEnvFile } from './load-env.js';

loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveFile(res, filePath) {
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  stream.pipe(res);
  stream.on('error', () => {
    res.writeHead(500);
    res.end('Internal error');
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === ANTHROPIC_PROXY_PATH) {
    await handleAnthropicRequest(req, res);
    return;
  }

  if (!fs.existsSync(DIST)) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('No build found. Run `npm run build` first.');
    return;
  }

  // Resolve inside dist/ only; fall back to index.html for client routes.
  const requested = path.join(DIST, path.normalize(decodeURIComponent(url.pathname)));
  const target =
    requested.startsWith(DIST) && fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested
      : path.join(DIST, 'index.html');

  serveFile(res, target);
});

server.listen(PORT, () => {
  console.log(`Vinapp running at http://localhost:${PORT}`);
});

/**
 * Connect-style middleware that proxies the browser's Messages API calls to
 * Anthropic, attaching credentials server-side. The API key never reaches the
 * client bundle.
 *
 * Mounted at ANTHROPIC_PROXY_PATH (see src/lib/api.js) by both the Vite dev
 * server (vite.config.js) and the production server (server/index.js).
 */

export const ANTHROPIC_PROXY_PATH = '/api/anthropic/v1/messages';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MAX_BODY_BYTES = 24 * 1024 * 1024; // room for a couple of base64 card photos

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function handleAnthropicRequest(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: { type: 'method_not_allowed', message: 'Use POST.' } });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, {
      error: {
        type: 'missing_api_key',
        message: 'ANTHROPIC_API_KEY is not set on the server. Copy .env.example to .env and add your key.',
      },
    });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    sendJson(res, err.status || 400, { error: { type: 'bad_request', message: err.message } });
    return;
  }

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Content-Length': Buffer.byteLength(text),
    });
    res.end(text);
  } catch (err) {
    sendJson(res, 502, { error: { type: 'upstream_error', message: err.message } });
  }
}

/** Vite plugin that mounts the proxy on the dev server. */
export function anthropicProxyPlugin() {
  return {
    name: 'anthropic-proxy',
    configureServer(server) {
      server.middlewares.use(ANTHROPIC_PROXY_PATH, handleAnthropicRequest);
    },
    configurePreviewServer(server) {
      server.middlewares.use(ANTHROPIC_PROXY_PATH, handleAnthropicRequest);
    },
  };
}

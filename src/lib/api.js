/**
 * The app's one way to ask Claude something.
 *
 * Two backends, picked at runtime:
 *
 *  - `sample`  — published as a Claude artifact. Calls go through the viewer's
 *                own Claude account via the `sample` capability. No web search
 *                (see `supportsWebSearch`), so price and checklist lookups fall
 *                back to the model's own knowledge.
 *  - `proxy`   — running from this repo (`npm run dev` / `npm start`). Calls go
 *                to a same-origin proxy that attaches the API key server-side,
 *                and the web search tool is available.
 *
 * Callers use `complete()` and branch on `capabilities()` where the difference
 * between backends is visible to the person using the app.
 */

export const ANTHROPIC_ENDPOINT = '/api/anthropic/v1/messages';
export const MODEL = 'claude-sonnet-4-6';
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search' };

/* ------------------------------------------------------------------ *
 * Backend: the artifact `sample` capability
 * ------------------------------------------------------------------ */

function dataUrlToBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(',');
  const mediaType = meta.substring(5, meta.indexOf(';'));
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mediaType });
}

/** Folds the system instruction into the first user turn — `sample` has no
 *  system prompt the page controls. */
function toSampleInput(system, messages) {
  const turns = messages.map((m) => ({ role: m.role, content: m.content }));
  if (system) {
    const first = turns.find((t) => t.role === 'user');
    if (first) first.content = `${system}\n\n${first.content}`;
  }
  return turns.length === 1 ? turns[0].content : turns;
}

function sampleBackend(sample, limits) {
  return {
    name: 'sample',
    supportsWebSearch: false,
    supportsImages: Boolean(limits && limits.images),

    async complete({ system, messages, images, tier }) {
      const options = {};
      if (images && images.length) options.images = images.map(dataUrlToBlob);
      if (tier) options.modelTier = tier;
      const { text } = await sample(toSampleInput(system, messages), options);
      return { text };
    },
  };
}

/* ------------------------------------------------------------------ *
 * Backend: the same-origin API proxy
 * ------------------------------------------------------------------ */

function textOf(content) {
  return (content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

async function postMessages(body) {
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Request failed');
  return data;
}

const proxyBackend = {
  name: 'proxy',
  supportsWebSearch: true,
  supportsImages: true,

  async complete({ system, messages, images, maxTokens, webSearch }) {
    const turns = messages.map((m) => ({ role: m.role, content: m.content }));
    if (images && images.length) {
      const first = turns.find((t) => t.role === 'user');
      first.content = [
        ...images.map((dataUrl) => ({
          type: 'image',
          source: {
            type: 'base64',
            media_type: dataUrl.substring(5, dataUrl.indexOf(';')),
            data: dataUrl.split(',')[1],
          },
        })),
        { type: 'text', text: first.content },
      ];
    }
    const body = { model: MODEL, max_tokens: maxTokens || 1000, messages: turns };
    if (system) body.system = system;
    if (webSearch) body.tools = [WEB_SEARCH_TOOL];
    const data = await postMessages(body);
    return { text: textOf(data.content) };
  },
};

/* ------------------------------------------------------------------ *
 * Backend selection
 * ------------------------------------------------------------------ */

/**
 * Is there a proxy behind us? The middleware answers a non-POST with 405, so
 * anything but a 404 means it is there. On a static host — GitHub Pages, a
 * plain file — nothing is, and the assistant features have to say so rather
 * than fail one by one.
 */
async function proxyReachable() {
  try {
    const response = await fetch(ANTHROPIC_ENDPOINT, { method: 'GET' });
    return response.status !== 404;
  } catch (e) {
    return false;
  }
}

/** No assistant reachable — the app still keeps inventory, and features that
 *  need Claude report it rather than failing obscurely. */
const unavailableBackend = {
  name: 'unavailable',
  supportsWebSearch: false,
  supportsImages: false,
  async complete() {
    throw new Error('The assistant is not available here.');
  },
};

let backendPromise = null;

function resolveBackend() {
  if (backendPromise) return backendPromise;
  backendPromise = (async () => {
    if (typeof window !== 'undefined' && window.claude && window.claude.use) {
      // Running inside an artifact frame: `sample` is the only way out, so
      // don't fall back to a proxy that isn't there.
      const sample = await window.claude.use('sample');
      if (!sample) return unavailableBackend;
      let limits = null;
      try {
        limits = await sample.limits();
      } catch (e) {
        limits = null;
      }
      return sampleBackend(sample, limits);
    }
    return (await proxyReachable()) ? proxyBackend : unavailableBackend;
  })();
  return backendPromise;
}

/** What the active backend can do — for UI that must not promise more than the
 *  backend delivers. Resolves once, then answers from cache. */
export async function capabilities() {
  const backend = await resolveBackend();
  return {
    name: backend.name,
    available: backend.name !== 'unavailable',
    supportsWebSearch: backend.supportsWebSearch,
    supportsImages: backend.supportsImages,
  };
}

/**
 * One question, one answer.
 *   system    — instruction text (folded into the prompt on `sample`)
 *   messages  — [{role, content}], content is a plain string
 *   images    — data URLs to send with the first user turn
 *   webSearch — ask for the web search tool; only honoured where supported
 */
export async function complete(request) {
  const backend = await resolveBackend();
  return backend.complete(request);
}

/** Parses a JSON object or array out of a model response, tolerating code
 *  fences and a `RESULT:` prefix. */
export function parseJson(text, expect = 'object') {
  const marker = text.match(expect === 'array' ? /RESULT:\s*(\[[\s\S]*\])/ : /RESULT:\s*(\{[\s\S]*\})/);
  if (marker) return JSON.parse(marker[1]);
  const clean = text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    const span = expect === 'array' ? clean.match(/\[[\s\S]*\]/) : clean.match(/\{[\s\S]*\}/);
    if (!span) throw e;
    return JSON.parse(span[0]);
  }
}

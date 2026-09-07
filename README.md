# Vinapp

Inventory and listing tracker for a collectibles resale business — trading cards,
comics, toys — from purchase through eBay listing to delivery.

## What it does

- **Inventory** — every item gets an `INV-####` number and moves through a
  lifecycle: in inventory → ready to list → listed → sold → shipped → delivered →
  complete. One tap advances a card and fills in the dates that go with the step.
- **Set binder** — groups cards by set, shows owned cards against the set
  checklist, and marks the gaps.
- **Photos** — front/back images, resized in the browser before they're stored.
- **Assistant features** (need an API key, see below):
  - scan a card photo to prefill its details
  - generate an eBay title and description
  - look up comparable sold prices, with price history charts
  - fetch a set checklist with rough market prices
  - a chat agent that can answer questions *and* act on inventory (advance
    status, adjust prices, generate listings)

## Two ways to run it

The app runs either as a **published Claude artifact** or as a **local dev
server**, and picks its backends at runtime. Nothing else in the app changes.

| | Artifact | Local (`npm run dev`) |
| --- | --- | --- |
| Storage | `db` capability — server-side, follows the viewer between devices | IndexedDB — per-browser, lost with site data |
| Assistant | `sample` capability — runs on the viewer's Claude account, no API key needed | API proxy using `ANTHROPIC_API_KEY` |
| Web search | not available — comp prices and set checklists are model estimates | available, so those two do real lookups |

`src/lib/storage.js` and `src/lib/api.js` each hold both backends and choose
between them by probing for `window.claude`.

### Published on GitHub Pages

Every push to `main` deploys to <https://evdorfman.github.io/Vinapp/> via
`.github/workflows/pages.yml`.

Pages is a static host, so there is no proxy behind the app there. It detects
that on load — the proxy answers a non-POST with 405, a static host 404s — and
switches the assistant off with an explanation rather than letting each feature
fail on its own. Inventory, photos, the set binder and the charts all work, and
data is kept in that browser.

### Publishing the artifact

```bash
npm run build:artifact    # -> artifact/vinapp.html
```

That inlines everything — React, recharts, the icons, the compiled Tailwind,
and the app — into one file with no `<!doctype>`/`<html>`/`<body>` wrapper,
which is what the artifact host expects. Publish that file with the `db` and
`sample` capabilities declared.

## Running it locally

```bash
npm install
cp .env.example .env      # add your ANTHROPIC_API_KEY
npm run dev               # http://localhost:5173
```

Production:

```bash
npm run build
npm start                 # serves dist/ and the API proxy on :3000
```

The app runs fine without an API key — inventory, photos, and the set binder all
work. Only the assistant features need one.

## How it's put together

```
index.html
src/
  main.jsx              entry point; installs the storage adapter
  App.jsx               the whole UI (single component tree)
  index.css             Tailwind
  lib/
    storage.js          key/value store (db capability | IndexedDB)
    api.js              assistant calls (sample capability | API proxy)
server/
  anthropic-proxy.js    middleware that adds the API key (dev + prod)
  index.js              production static server
  load-env.js           minimal .env reader
scripts/
  build-artifact.mjs    bundles dist/ into one self-contained HTML file
vite.config.js          React + Tailwind + the proxy plugin
```

### Storage

Same keys either way — `db` documents under `kv/`, or IndexedDB records in the
`vinapp` database:

| Key | Contents |
| --- | --- |
| `inventory` | the full card list, as JSON |
| `nextInvNumber` | the next `INV-####` to hand out |
| `img:<card id>:front` / `:back` | photo data URLs |
| `setChecklist:<set name>` | cached set checklist, refetched after 7 days |

Documents are capped at 256 KiB, so the `db` backend splits anything larger
(the photos, and the card list once it grows) across a `parts` subcollection.
On IndexedDB there is no server-side copy — clearing site data clears the
inventory.

### The API key

Only the local path needs one, and the browser never sees it: calls go to
`/api/anthropic/v1/messages` on the same origin, and `server/anthropic-proxy.js`
attaches `x-api-key` before forwarding to `api.anthropic.com`. The same
middleware is mounted by the Vite dev server and by the production server, so
both behave identically. As a published artifact there is no key at all — the
`sample` capability bills the viewer's own Claude account.

The model is set in one place, `src/lib/api.js`.

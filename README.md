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

## Running it

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
    storage.js          IndexedDB key/value store, exposed as window.storage
    api.js              proxy endpoint + model constant
server/
  anthropic-proxy.js    middleware that adds the API key (dev + prod)
  index.js              production static server
  load-env.js           minimal .env reader
vite.config.js          React + Tailwind + the proxy plugin
```

### Storage

Everything lives in the browser, in IndexedDB under the `vinapp` database:

| Key | Contents |
| --- | --- |
| `inventory` | the full card list, as JSON |
| `nextInvNumber` | the next `INV-####` to hand out |
| `img:<card id>:front` / `:back` | photo data URLs |
| `setChecklist:<set name>` | cached set checklist, refetched after 7 days |

There is no server-side database — clearing site data clears the inventory.

### The API key

The browser never sees it. Assistant calls go to `/api/anthropic/v1/messages` on
the same origin; `server/anthropic-proxy.js` attaches `x-api-key` and forwards
to `api.anthropic.com`. The same middleware is mounted by the Vite dev server
and by the production server, so both behave identically.

The model is set in one place, `src/lib/api.js`.

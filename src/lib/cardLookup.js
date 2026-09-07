/**
 * Card catalog lookup, backed by the free pokemontcg.io API.
 *
 * This is the non-AI path for identifying a card and pricing it. Where the
 * assistant guesses, this looks the card up: set, rarity and a real TCGplayer
 * market price, for nothing, with no API key.
 *
 * Two things shape the implementation:
 *
 *  - The API's multi-term queries (`q=set.id:base1 number:4`) return 500, so
 *    lookups go through the sets list plus a direct fetch by card id, which is
 *    `<setId>-<number>`.
 *  - A printed total is not unique. `4/102` matches Base Set *and*
 *    HS—Triumphant, so a lookup returns candidates and the caller picks.
 *
 * Pokemon only. Comics and sealed product aren't in this catalog.
 */

const API = 'https://api.pokemontcg.io/v2';
const SETS_CACHE_KEY = 'catalogSets';
const SETS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // sets change a few times a year

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) return null;
  const body = await response.json();
  return body.data ?? null;
}

/** The full set list, cached — one request, then reused. */
async function allSets() {
  try {
    const cached = await window.storage.get(SETS_CACHE_KEY, false);
    if (cached && cached.value) {
      const { fetchedAt, sets } = JSON.parse(cached.value);
      if (Date.now() - fetchedAt < SETS_TTL_MS) return sets;
    }
  } catch (e) {
    // fall through and refetch
  }

  const data = await getJson(`${API}/sets?pageSize=500`);
  if (!data) return [];
  const sets = data.map((s) => ({
    id: s.id,
    name: s.name,
    series: s.series,
    printedTotal: s.printedTotal,
    releaseDate: s.releaseDate,
  }));
  try {
    await window.storage.set(SETS_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), sets }), false);
  } catch (e) {
    // caching is an optimization, not a requirement
  }
  return sets;
}

/** Splits "4/102" into its parts; also accepts a bare number. */
export function parseNumber(text) {
  const match = String(text || '').trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (match) return { number: match[1], printedTotal: match[2] };
  const bare = String(text || '').trim().match(/^(\d+)$/);
  return bare ? { number: bare[1], printedTotal: null } : null;
}

/** The best market price on a catalog card, or null. */
export function marketPrice(catalogCard) {
  const prices = ((catalogCard || {}).tcgplayer || {}).prices || {};
  // Prefer the holofoil/normal variants people actually trade, then anything.
  for (const key of ['holofoil', 'normal', 'reverseHolofoil', '1stEditionHolofoil']) {
    const entry = prices[key];
    if (entry && (entry.market || entry.mid)) return entry.market ?? entry.mid;
  }
  for (const entry of Object.values(prices)) {
    if (entry && (entry.market || entry.mid)) return entry.market ?? entry.mid;
  }
  return null;
}

/** Maps a catalog card onto the app's card fields. */
export function catalogFields(catalogCard) {
  const set = catalogCard.set || {};
  const price = marketPrice(catalogCard);
  return {
    catalogId: catalogCard.id,
    name: catalogCard.name || '',
    cardType: 'Pokemon',
    setName: set.name || '',
    cardNumber: set.printedTotal ? `${catalogCard.number}/${set.printedTotal}` : String(catalogCard.number || ''),
    rarity: catalogCard.rarity || '',
    ...(price ? { comparablePrice: String(price) } : {}),
  };
}

/** One card by catalog id, e.g. `base1-4`. */
export async function fetchCatalogCard(id) {
  return getJson(`${API}/cards/${encodeURIComponent(id)}`);
}

/**
 * Candidate cards for a printed number. Newest set first, since recent product
 * is what usually passes through an active inventory.
 */
export async function findByNumber(number, printedTotal) {
  const sets = await allSets();
  const candidateSets = printedTotal
    ? sets.filter((s) => String(s.printedTotal) === String(printedTotal))
    : [];
  if (!candidateSets.length) return [];

  const found = await Promise.all(
    candidateSets.map((s) => fetchCatalogCard(`${s.id}-${number}`).catch(() => null)),
  );
  return found
    .filter(Boolean)
    .sort((a, b) => String((b.set || {}).releaseDate || '').localeCompare(String((a.set || {}).releaseDate || '')));
}

/**
 * Current market price for a card the app already holds. Uses its saved
 * `catalogId` when it has one, otherwise resolves the printed number — and
 * only when that is unambiguous, so a guess never lands in the price history.
 */
export async function priceForCard(card) {
  let catalogCard = null;

  if (card.catalogId) {
    catalogCard = await fetchCatalogCard(card.catalogId);
  } else {
    const parsed = parseNumber(card.cardNumber);
    if (!parsed || !parsed.printedTotal) return null;
    const candidates = await findByNumber(parsed.number, parsed.printedTotal);
    const named = card.setName
      ? candidates.filter((c) => (c.set || {}).name?.toLowerCase() === card.setName.toLowerCase())
      : candidates;
    const shortlist = named.length ? named : candidates;
    if (shortlist.length !== 1) return null; // ambiguous — let a human choose
    catalogCard = shortlist[0];
  }

  if (!catalogCard) return null;
  const price = marketPrice(catalogCard);
  if (price === null) return null;

  const set = catalogCard.set || {};
  return {
    average: price,
    note: `TCGplayer market price for ${catalogCard.name} (${set.name}), updated ${(catalogCard.tcgplayer || {}).updatedAt || 'recently'}.`,
    catalogId: catalogCard.id,
  };
}

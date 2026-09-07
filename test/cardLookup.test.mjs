/**
 * Tests for the card catalog's pure logic — parsing printed numbers, picking a
 * price out of the variant list, and mapping a catalog entry onto card fields.
 *
 * Network lookups aren't covered here: they hit a live third-party API, so
 * they'd fail for reasons that have nothing to do with this code.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, marketPrice, catalogFields } from '../src/lib/cardLookup.js';

test('parseNumber reads a printed card number', () => {
  assert.deepEqual(parseNumber('4/102'), { number: '4', printedTotal: '102' });
  assert.deepEqual(parseNumber(' 215 / 203 '), { number: '215', printedTotal: '203' });
});

test('parseNumber accepts a bare number without a total', () => {
  assert.deepEqual(parseNumber('7'), { number: '7', printedTotal: null });
});

test('parseNumber rejects what it cannot look up', () => {
  // Comic issue numbers reach this code too; they are not catalog numbers.
  assert.equal(parseNumber('#300'), null);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber(undefined), null);
});

test('marketPrice prefers the variants people actually trade', () => {
  assert.equal(
    marketPrice({ tcgplayer: { prices: { normal: { market: 5 }, holofoil: { market: 900 } } } }),
    900,
  );
});

test('marketPrice falls back to mid when there is no market price', () => {
  assert.equal(marketPrice({ tcgplayer: { prices: { holofoil: { mid: 12.5 } } } }), 12.5);
});

test('marketPrice returns null rather than guessing', () => {
  assert.equal(marketPrice({ tcgplayer: {} }), null);
  assert.equal(marketPrice({}), null);
});

test('catalogFields maps a catalog entry onto card fields', () => {
  assert.deepEqual(
    catalogFields({
      id: 'base1-4',
      name: 'Charizard',
      number: '4',
      rarity: 'Rare Holo',
      set: { name: 'Base', printedTotal: 102 },
      tcgplayer: { prices: { holofoil: { market: 897.19 } } },
    }),
    {
      catalogId: 'base1-4',
      name: 'Charizard',
      cardType: 'Pokemon',
      setName: 'Base',
      cardNumber: '4/102',
      rarity: 'Rare Holo',
      comparablePrice: '897.19',
    },
  );
});

test('catalogFields leaves the price alone when the catalog has none', () => {
  const fields = catalogFields({ id: 'x-1', name: 'X', number: '1', set: { name: 'S', printedTotal: 10 } });
  assert.equal('comparablePrice' in fields, false);
});

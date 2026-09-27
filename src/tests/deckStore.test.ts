import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDeck, loadDeck, saveDeck } from '../storage/deckStore';

describe('deck store', () => {
  beforeEach(async () => {
    await clearDeck();
  });

  it('loads empty when nothing was saved', async () => {
    expect(await loadDeck()).toEqual([]);
  });

  it('round-trips deck picks', async () => {
    await saveDeck(['v-cola', 'blueberry']);
    expect(await loadDeck()).toEqual(['v-cola', 'blueberry']);
  });

  it('drops unknown ids and caps at 6', async () => {
    await saveDeck([
      'v-cola',
      'mystery',
      'blueberry',
      'v-lemon',
      'pomegranate',
      'cream-soda',
      'pina-colada',
      'v-diet-cola',
    ]);
    expect(await loadDeck()).toEqual([
      'v-cola',
      'blueberry',
      'v-lemon',
      'pomegranate',
      'cream-soda',
      'pina-colada',
    ]);
  });

  it('clear wipes back to empty', async () => {
    await saveDeck(['v-cola']);
    await clearDeck();
    expect(await loadDeck()).toEqual([]);
  });
});

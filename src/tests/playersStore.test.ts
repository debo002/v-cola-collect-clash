import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPlayers,
  DEFAULT_PLAYERS,
  loadPlayers,
  sanitizePlayers,
  savePlayers,
} from '../storage/playersStore';

describe('players store', () => {
  beforeEach(async () => {
    await clearPlayers();
  });

  it('loads defaults when nothing was saved', async () => {
    expect(await loadPlayers()).toEqual(DEFAULT_PLAYERS);
  });

  it('round-trips custom names', async () => {
    await savePlayers({ p1: 'Mona', p2: 'Karim' });
    expect(await loadPlayers()).toEqual({ p1: 'Mona', p2: 'Karim' });
  });

  it('trims, caps length, and falls back on blanks', () => {
    expect(sanitizePlayers({ p1: '  A very long nickname  ', p2: '   ' })).toEqual({
      p1: 'A very long ',
      p2: 'Player 2',
    });
    expect(sanitizePlayers(null)).toEqual(DEFAULT_PLAYERS);
    expect(sanitizePlayers('junk')).toEqual(DEFAULT_PLAYERS);
  });

  it('clear wipes back to defaults', async () => {
    await savePlayers({ p1: 'Mona', p2: 'Karim' });
    await clearPlayers();
    expect(await loadPlayers()).toEqual(DEFAULT_PLAYERS);
  });
});

import { describe, expect, it } from 'vitest';
import { displayPlayerName } from './resolutionNames';

describe('displayPlayerName', () => {
  it('preserves a real player name after trimming whitespace', () => {
    expect(displayPlayerName('  Lemon  ', 'B')).toBe('Lemon');
  });

  it.each([undefined, '', '   ', '...', '……'])(
    'uses the seat label for placeholder name %s',
    (name) => {
      expect(displayPlayerName(name, 'B')).toBe('Player B');
    }
  );
});

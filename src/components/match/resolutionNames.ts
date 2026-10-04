import type { Player } from '../../game/match';

export function displayPlayerName(name: string | undefined, player: Player): string {
  const trimmed = name?.trim() ?? '';
  return trimmed !== '' && !/^(?:\.{3,}|…+)$/u.test(trimmed) ? trimmed : `Player ${player}`;
}

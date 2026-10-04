import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../game/config';
import type { PlayerView } from '../../game/controller';
import { buildZoneViewsFromView } from './boardUtils';

const opponentCard = {
  handIndex: 0,
  flavor: 'blueberry' as const,
  power: 2,
  loaner: true,
};

function makeView(phase: PlayerView['phase'], round: number): PlayerView {
  return {
    seat: 'A',
    phase,
    round,
    config: DEFAULT_GAME_CONFIG,
    hand: [],
    boards: [
      {
        kind: 'revealed',
        zones: { cool: { mine: [], foe: [opponentCard] } },
      },
    ],
    locks: { A: false, B: false },
    ready: { me: false, opponent: false },
    opponentHandCount: 1,
    deadlineMs: null,
    drawsRemaining: 0,
    results: null,
    winner: null,
    explanations: null,
  };
}

describe('buildZoneViewsFromView', () => {
  it('hides a current-round opponent placement even if the board is marked revealed', () => {
    const views = buildZoneViewsFromView(makeView('placing', 1), {
      foeVisible: false,
      recallable: true,
    });

    expect(views.get('cool')?.foeCards).toEqual([]);
    expect(views.get('cool')?.foeBase).toBe(0);
  });

  it('shows the opponent placement once that round has entered reveal', () => {
    const views = buildZoneViewsFromView(makeView('roundReveal', 2), {
      foeVisible: true,
      recallable: false,
    });

    expect(views.get('cool')?.foeCards).toHaveLength(1);
    expect(views.get('cool')?.foeBase).toBe(2);
  });
});

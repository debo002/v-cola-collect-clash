import { describe, expect, it } from 'vitest';
import type { Player } from '../game/match';
import { resolveMatch, resolveZone, type ResolveCard, type ZoneInput } from '../game/resolve';
import type { FlavorId } from '../game/types';
import type { ZoneEffect } from '../game/zones';

type Spec = readonly (readonly [string, number])[];

function cards(side: Player, list: Spec, prefix: string): ResolveCard[] {
  return list.map(([flavor, basePower], i) => ({
    cardId: `${prefix}${side}-${flavor}-${i}`,
    flavor: flavor as FlavorId,
    basePower,
    owner: side,
  }));
}

function zone(zoneId: string, a: Spec, b: Spec = [], effect?: ZoneEffect, tag = ''): ZoneInput {
  const prefix = `${tag}${zoneId}-`;
  return { zoneId, effect, cards: { A: cards('A', a, prefix), B: cards('B', b, prefix) } };
}

function effectIds(r: { steps: readonly { effectId: string }[] }): string[] {
  return r.steps.map((s) => s.effectId);
}

describe('rule 1 — exact V Cola + V Diet Cola: -1', () => {
  it('applies -1 on the exact pair', () => {
    const r = resolveZone(
      zone('z', [
        ['v-cola', 3],
        ['v-diet-cola', 3],
      ])
    );
    expect(r.base.A).toBe(6);
    expect(r.totals.A).toBe(5);
    expect(effectIds(r)).toContain('cola-diet-minus1');
  });

  it('extra card breaks the combo', () => {
    const r = resolveZone(
      zone('z', [
        ['v-cola', 3],
        ['v-diet-cola', 3],
        ['blueberry', 3],
      ])
    );
    expect(r.totals.A).toBe(9);
    expect(effectIds(r)).not.toContain('cola-diet-minus1');
  });

  it('duplicate copy breaks the combo (multiset)', () => {
    const r = resolveZone(
      zone('z', [
        ['v-cola', 3],
        ['v-cola', 3],
        ['v-diet-cola', 3],
      ])
    );
    expect(effectIds(r)).not.toContain('cola-diet-minus1');
    expect(effectIds(r)).not.toContain('cola-diet-lemon-plus2');
  });
});

describe('rule 2 — exact trio: +2', () => {
  it('applies +2 on the exact trio', () => {
    const r = resolveZone(
      zone('z', [
        ['v-cola', 2],
        ['v-diet-cola', 2],
        ['v-lemon', 2],
      ])
    );
    expect(r.totals.A).toBe(8);
    expect(effectIds(r)).toContain('cola-diet-lemon-plus2');
  });

  it('extra card does not break it', () => {
    const r = resolveZone(
      zone('z', [
        ['v-cola', 2],
        ['v-diet-cola', 2],
        ['v-lemon', 2],
        ['blueberry', 5],
      ])
    );
    expect(r.totals.A).toBe(13);
    expect(effectIds(r)).toContain('cola-diet-lemon-plus2');
  });

  it('trio takes precedence over the pair when another card is present', () => {
    const r = resolveZone(
      zone('z', [
        ['v-cola', 2],
        ['v-diet-cola', 2],
        ['v-lemon', 2],
        ['blueberry', 3],
      ])
    );
    expect(effectIds(r)).toContain('cola-diet-lemon-plus2');
    expect(effectIds(r)).not.toContain('cola-diet-minus1');
    expect(r.totals.A).toBe(11);
  });

  it('all Cola and Citrus trio members activate their respective effects', () => {
    const r = resolveZone(
      zone('z', [
        ['v-cola', 2],
        ['v-diet-cola', 2],
        ['v-lemon', 2],
        ['lemon-mint', 3],
        ['pink-lemonade', 4],
      ])
    );
    expect(effectIds(r)).toContain('cola-diet-lemon-plus2');
    expect(effectIds(r)).toContain('citrus-trio-double-lowest');
    expect(r.totals.A).toBe(17);
  });

  it('trio vs pair head-to-head', () => {
    const r = resolveZone(
      zone(
        'z',
        [
          ['v-cola', 3],
          ['v-diet-cola', 3],
          ['v-lemon', 3],
        ],
        [
          ['v-cola', 4],
          ['v-diet-cola', 4],
        ]
      )
    );
    // A: 9 + 2 = 11, B: 8 - 1 = 7.
    expect(r.totals).toEqual({ A: 11, B: 7 });
    expect(r.winner).toBe('A');
  });
});

describe('rule 3 — citrus trio doubles lowest', () => {
  it('adds lowest base once more', () => {
    const r = resolveZone(
      zone('z', [
        ['v-lemon', 1],
        ['lemon-mint', 4],
        ['pink-lemonade', 5],
      ])
    );
    expect(r.base.A).toBe(10);
    expect(r.totals.A).toBe(11);
    const step = r.steps.find((s) => s.effectId === 'citrus-trio-double-lowest');
    expect(step?.delta).toBe(1);
    expect(step?.totalAfter).toBe(11);
  });

  it('tied lowest gives the same result either way', () => {
    const r = resolveZone(
      zone('z', [
        ['v-lemon', 2],
        ['lemon-mint', 2],
        ['pink-lemonade', 5],
      ])
    );
    expect(r.totals.A).toBe(11); // 9 + 2
  });

  it('extra card does not break it', () => {
    const r = resolveZone(
      zone('z', [
        ['v-lemon', 2],
        ['lemon-mint', 2],
        ['pink-lemonade', 2],
        ['blueberry', 5],
      ])
    );
    expect(effectIds(r)).toContain('citrus-trio-double-lowest');
    expect(r.totals.A).toBe(13);
  });
});

describe('rule 4 — ingredient sharing', () => {
  it('Apple + Pineapple Malt share malt only: +1', () => {
    const r = resolveZone(
      zone('z', [
        ['v7-apple-malt', 3],
        ['v7-pineapple-malt', 3],
      ])
    );
    expect(r.totals.A).toBe(7);
    expect(r.steps.filter((s) => s.effectId.startsWith('ingredient-share'))).toHaveLength(1);
  });

  it('Pineapple Malt + Pina Colada share pineapple only: +1', () => {
    const r = resolveZone(
      zone('z', [
        ['v7-pineapple-malt', 3],
        ['pina-colada', 3],
      ])
    );
    expect(r.totals.A).toBe(7);
  });

  it('Apple Malt + Pina Colada share nothing: +0', () => {
    const r = resolveZone(
      zone('z', [
        ['v7-apple-malt', 3],
        ['pina-colada', 3],
      ])
    );
    expect(r.totals.A).toBe(6);
    expect(r.steps.filter((s) => s.effectId.startsWith('ingredient-share'))).toHaveLength(0);
  });

  it('all three share both tags: +2', () => {
    const r = resolveZone(
      zone('z', [
        ['v7-apple-malt', 3],
        ['v7-pineapple-malt', 3],
        ['pina-colada', 3],
      ])
    );
    expect(r.totals.A).toBe(11);
    expect(r.steps.filter((s) => s.effectId.startsWith('ingredient-share'))).toHaveLength(2);
  });

  it('other cards do not block sharing', () => {
    const r = resolveZone(
      zone('z', [
        ['v7-apple-malt', 3],
        ['v7-pineapple-malt', 3],
        ['blueberry', 1],
      ])
    );
    expect(r.totals.A).toBe(8); // 7 base + 1 malt
  });
});

describe('rule 5 — Pina Colada alone (via resolveMatch, stacking)', () => {
  it('gives +1 to every zone its side occupies, including its own', () => {
    const results = resolveMatch([
      zone('x', [['pina-colada', 3]], [], undefined, 'm1-'),
      zone('y', [['blueberry', 2]], [], undefined, 'm1-'),
    ]);
    expect(results.find((r) => r.zoneId === 'x')?.totals.A).toBe(4);
    expect(results.find((r) => r.zoneId === 'y')?.totals.A).toBe(3);
  });

  it('two lone Pinas stack to +2 per occupied zone', () => {
    const results = resolveMatch([
      zone('x', [['pina-colada', 3]], [], undefined, 'm2-'),
      zone('y', [['pina-colada', 2]], [], undefined, 'm2-'),
      zone('z', [['blueberry', 1]], [], undefined, 'm2-'),
    ]);
    expect(results.find((r) => r.zoneId === 'x')?.totals.A).toBe(5);
    expect(results.find((r) => r.zoneId === 'y')?.totals.A).toBe(4);
    expect(results.find((r) => r.zoneId === 'z')?.totals.A).toBe(3);
  });

  it('paired Pina is not alone: no bonus', () => {
    const results = resolveMatch([
      zone(
        'x',
        [
          ['pina-colada', 3],
          ['blueberry', 3],
        ],
        [],
        undefined,
        'm3-'
      ),
      zone('y', [['blueberry', 2]], [], undefined, 'm3-'),
    ]);
    expect(results.find((r) => r.zoneId === 'x')?.totals.A).toBe(6);
    expect(results.find((r) => r.zoneId === 'y')?.totals.A).toBe(2);
  });
});

describe('rule 6 — Cream Soda cancels everything in its zone', () => {
  it.each([
    [
      'Cola pair',
      [
        ['v-cola', 3],
        ['v-diet-cola', 3],
      ] as Spec,
    ],
    [
      'Cola trio',
      [
        ['v-cola', 3],
        ['v-diet-cola', 3],
        ['v-lemon', 3],
        ['blueberry', 1],
      ] as Spec,
    ],
    [
      'Lemon trio',
      [
        ['v-lemon', 3],
        ['lemon-mint', 3],
        ['pink-lemonade', 3],
        ['blueberry', 1],
      ] as Spec,
    ],
    [
      'ingredient bonus',
      [
        ['v7-apple-malt', 3],
        ['v7-pineapple-malt', 3],
      ] as Spec,
    ],
    [
      'Berry trio',
      [
        ['blueberry', 1],
        ['pomegranate', 1],
        ['pink-lemonade', 1],
      ] as Spec,
    ],
  ])('cancels the %s even when the other side plays Cream Soda', (_label, sideCards) => {
    const r = resolveZone(zone('z', sideCards, [['cream-soda', 5]], 'more-the-merrier'));
    expect(r.totals.A).toBe(sideCards.reduce((sum, [, power]) => sum + power, 0));
    expect(effectIds(r)).toEqual(['cream-cancels']);
  });

  it('base power only (card combo + zone effect ignored)', () => {
    const r = resolveZone(
      zone(
        'z',
        [
          ['v-cola', 3],
          ['v-diet-cola', 3],
        ],
        [['cream-soda', 5]],
        'stay-frosty'
      )
    );
    expect(r.totals).toEqual({ A: 6, B: 5 });
    expect(effectIds(r)).toEqual(['cream-cancels']);
    expect(r.winner).toBe('A');
  });

  it('blocks incoming Pina +1 but leaves other zones alone', () => {
    const results = resolveMatch([
      zone('x', [['blueberry', 3]], [['cream-soda', 1]], undefined, 'm4-'),
      zone('y', [['pina-colada', 2]], [], undefined, 'm4-'),
    ]);
    // x is Cream: A gets no Pina bonus. y is the lone Pina: own +1.
    expect(results.find((r) => r.zoneId === 'x')?.totals.A).toBe(3);
    expect(results.find((r) => r.zoneId === 'y')?.totals.A).toBe(3);
  });

  it('Pina inside a Cream zone gives nothing anywhere', () => {
    const results = resolveMatch([
      zone('x', [['pina-colada', 4]], [['cream-soda', 1]], undefined, 'm5-'),
      zone('y', [['blueberry', 2]], [], undefined, 'm5-'),
    ]);
    expect(results.find((r) => r.zoneId === 'x')?.totals.A).toBe(4);
    expect(results.find((r) => r.zoneId === 'y')?.totals.A).toBe(2);
  });
});

describe('rule 7 — berry trio auto-win', () => {
  it('wins despite a lower total (others allowed)', () => {
    const r = resolveZone(
      zone(
        'z',
        [
          ['blueberry', 1],
          ['pomegranate', 1],
          ['pink-lemonade', 1],
          ['v-cola', 1],
        ],
        [['v-cola', 5]]
      )
    );
    expect(r.winner).toBe('A');
    expect(effectIds(r)).toContain('berry-trio-autowin');
  });

  it('both sides completing it falls back to totals', () => {
    const r = resolveZone(
      zone(
        'z',
        [
          ['blueberry', 1],
          ['pomegranate', 1],
          ['pink-lemonade', 1],
        ],
        [
          ['blueberry', 2],
          ['pomegranate', 2],
          ['pink-lemonade', 2],
        ]
      )
    );
    expect(effectIds(r)).not.toContain('berry-trio-autowin');
    expect(r.winner).toBe('B');
  });

  it('Cream Soda forces fallback to totals', () => {
    const r = resolveZone(
      zone(
        'z',
        [
          ['blueberry', 1],
          ['pomegranate', 1],
          ['pink-lemonade', 1],
        ],
        [['cream-soda', 5]]
      )
    );
    expect(r.winner).toBe('B');
  });
});

describe('resolver shape', () => {
  it('does not hardcode three zones', () => {
    const two = resolveMatch([zone('a', [['v-cola', 1]]), zone('b', [['v-cola', 2]])]);
    expect(two).toHaveLength(2);
    const four = resolveMatch([
      zone('a', [['v-cola', 1]]),
      zone('b', [['v-cola', 1]]),
      zone('c', [['v-cola', 1]]),
      zone('d', [['v-cola', 1]]),
    ]);
    expect(four).toHaveLength(4);
  });

  it('steps deltas sum to bonus and last totalAfter matches totals', () => {
    const r = resolveZone(
      zone(
        'z',
        [
          ['v-lemon', 1],
          ['lemon-mint', 4],
          ['pink-lemonade', 5],
        ],
        [['v-cola', 9]]
      )
    );
    const deltaA = r.steps.filter((s) => s.side === 'A').reduce((n, s) => n + s.delta, 0);
    expect(deltaA).toBe(r.totals.A - r.base.A);
    const lastA = [...r.steps].reverse().find((s) => s.side === 'A');
    expect(lastA?.totalAfter).toBe(r.totals.A);
  });

  it('uses the existing tie rule', () => {
    const r = resolveZone(zone('z', [['v-cola', 3]], [['v-cola', 3]]));
    expect(r.winner).toBeNull();
  });
});

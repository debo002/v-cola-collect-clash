import { describe, expect, it, afterEach } from 'vitest';
import type { Collection } from '../game/collection';
import type { GameConfig } from '../game/config';
import type { ControllerClock } from '../game/localController';
import { LocalController } from '../game/localController';
import type { PlayerView } from '../game/controller';
import type { Player } from '../game/match';

function createEmptyCollection(): Collection {
  return {
    getFlavors: () => [],
    getOwnedFlavors: () => new Set<string>(),
    addItem: () => {},
    items: [],
  } as unknown as Collection;
}

class FakeClock implements ControllerClock {
  nowMs = 1_000_000;
  private nextId = 1;
  private timers = new Map<number, { at: number; cb: () => void }>();

  now = () => this.nowMs;

  setTimeout = (cb: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowMs + ms, cb });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  clearTimeout = (id: ReturnType<typeof setTimeout>) => {
    this.timers.delete(id as unknown as number);
  };

  pendingCount(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    this.nowMs += ms;
    const due = [...this.timers.entries()]
      .filter(([, t]) => t.at <= this.nowMs)
      .sort((a, b) => a[1].at - b[1].at);
    for (const [id, t] of due) {
      this.timers.delete(id);
      t.cb();
    }
  }
}

function latest(controller: LocalController): PlayerView {
  let current: PlayerView | null = null;
  const off = controller.subscribe((v) => {
    current = v;
  });
  off();
  return current as unknown as PlayerView;
}

function customConfig(): GameConfig {
  return {
    mode: 'custom',
    deck: {
      kind: 'custom',
      flavors: ['v-cola', 'v-diet-cola', 'cream-soda', 'v-lemon', 'lemon-mint', 'blueberry'],
    },
    dealing: 'reveal-all',
    drawPerRound: 2,
    maxPlacedPerRound: 2,
    power: 'fixed',
    fixedPower: {
      'v-cola': 4,
      'v-diet-cola': 4,
      'cream-soda': 5,
      'v-lemon': 3,
      'lemon-mint': 3,
      blueberry: 1,
    },
    effectsEnabled: true,
  };
}

function lockBothForRound(controller: LocalController, handIndex = 0): void {
  controller.setSeat('A');
  controller.send({ type: 'place', handIndex, zone: 'cool' });
  controller.send({ type: 'lock' });
  controller.setSeat('B');
  controller.send({ type: 'place', handIndex, zone: 'cool' });
  controller.send({ type: 'lock' });
}

describe('LocalController', () => {
  const controllers: LocalController[] = [];
  afterEach(() => {
    for (const c of controllers.splice(0)) c.dispose();
  });
  function make(clock?: FakeClock): { controller: LocalController; clock: FakeClock } {
    const fake = clock ?? new FakeClock();
    const controller = new LocalController(createEmptyCollection(), fake);
    controllers.push(controller);
    return { controller, clock: fake };
  }

  it('place, unplace, lock flow keeps cards in hand until reveal', () => {
    const { controller } = make();
    controller.startQuickPlay();
    controller.setSeat('A');
    const before = latest(controller);
    expect(before.phase).toBe('placing');
    expect(before.hand.length).toBeGreaterThan(0);

    controller.send({ type: 'place', handIndex: 0, zone: 'cool' });
    let view = latest(controller);
    const current = view.boards.find((b) => b.kind === 'current');
    expect(current?.zones['cool']?.mine.length).toBe(1);

    controller.send({ type: 'unplace', handIndex: 0 });
    view = latest(controller);
    const afterUnplace = view.boards.find((b) => b.kind === 'current');
    expect(afterUnplace?.zones['cool']?.mine.length).toBe(0);
    expect(view.hand.length).toBe(before.hand.length);

    controller.send({ type: 'place', handIndex: 1, zone: 'party' });
    controller.send({ type: 'lock' });
    view = latest(controller);
    expect(view.locks.A).toBe(true);
  });

  it('both-lock reveals and advances the round', () => {
    const { controller } = make();
    controller.startCustomGame(customConfig());
    lockBothForRound(controller);
    const view = latest(controller);
    expect(view.phase).toBe('roundReveal');
    expect(view.round).toBe(2);
    const revealed = view.boards[0];
    expect(revealed?.kind).toBe('revealed');
    if (revealed?.kind === 'revealed') {
      expect(revealed.zones['cool']?.mine.length).toBe(1);
      expect(revealed.zones['cool']?.foe.length).toBe(1);
      expect(revealed.zones['cool']?.foe[0]?.flavor).toBe('v-cola');
    }
  });

  it('timeout auto-places and locks via the injected scheduler', () => {
    const { controller, clock } = make();
    controller.startCustomGame(customConfig());
    controller.setSeat('A');
    expect(clock.pendingCount()).toBe(1);
    clock.advance(61_000);
    const view = latest(controller);
    expect(view.locks.A).toBe(true);
  });

  it('draw-per-round draws under a draw deadline, then placement deadline starts', () => {
    const { controller, clock } = make();
    const config: GameConfig = {
      ...customConfig(),
      dealing: 'draw-per-round',
      drawPerRound: 2,
    };
    controller.startCustomGame(config);
    controller.setSeat('A');
    let view = latest(controller);
    expect(view.drawsRemaining).toBe(2);
    expect(view.deadlineMs).not.toBeNull();
    expect(clock.pendingCount()).toBe(1);

    controller.send({ type: 'draw' });
    view = latest(controller);
    expect(view.drawsRemaining).toBe(1);
    expect(view.deadlineMs).not.toBeNull();

    controller.send({ type: 'draw' });
    view = latest(controller);
    expect(view.drawsRemaining).toBe(0);
    expect(view.deadlineMs).not.toBeNull();
    expect(clock.pendingCount()).toBe(1);
  });

  it('draw deadline auto-draws the remainder so idle players cannot stall', () => {
    const { controller, clock } = make();
    const config: GameConfig = {
      ...customConfig(),
      dealing: 'draw-per-round',
      drawPerRound: 2,
    };
    controller.startCustomGame(config);
    controller.setSeat('A');
    clock.advance(61_000);
    const view = latest(controller);
    expect(view.drawsRemaining).toBe(0);
    expect(view.hand.length).toBe(2);
    expect(view.deadlineMs).not.toBeNull();
  });

  it('third-card guard rejects, shakes via onReject, card stays in hand', () => {
    const { controller } = make();
    controller.startCustomGame(customConfig());
    controller.setSeat('A');
    const reasons: string[] = [];
    controller.onReject((r) => reasons.push(r));
    controller.send({ type: 'place', handIndex: 0, zone: 'cool' });
    controller.send({ type: 'place', handIndex: 1, zone: 'party' });
    controller.send({ type: 'place', handIndex: 2, zone: 'energy' });
    expect(reasons.length).toBe(1);
    const view = latest(controller);
    const current = view.boards.find((b) => b.kind === 'current');
    let placed = 0;
    if (current) {
      for (const zoneId of Object.keys(current.zones)) {
        placed += current.zones[zoneId]?.mine.length ?? 0;
      }
    }
    expect(placed).toBe(2);
    expect(view.hand.length).toBe(6);
  });

  it('custom config honors maxPlacedPerRound', () => {
    const { controller } = make();
    controller.startCustomGame({ ...customConfig(), maxPlacedPerRound: 3 });
    controller.setSeat('A');
    controller.send({ type: 'place', handIndex: 0, zone: 'cool' });
    controller.send({ type: 'place', handIndex: 1, zone: 'cool' });
    controller.send({ type: 'place', handIndex: 2, zone: 'cool' });
    const view = latest(controller);
    expect(view.boards.find((b) => b.kind === 'current')?.zones['cool']?.mine.length).toBe(3);
  });

  it('rematch restarts the match', () => {
    const { controller } = make();
    controller.startCustomGame(customConfig());
    lockBothForRound(controller, 0);
    controller.nextRound();
    lockBothForRound(controller, 1);
    controller.nextRound();
    lockBothForRound(controller, 2);
    let view = latest(controller);
    expect(view.phase).toBe('complete');
    controller.send({ type: 'rematch' });
    view = latest(controller);
    expect(view.phase).toBe('placing');
    expect(view.round).toBe(1);
  });

  it('empty hand auto-locks locally and never dead-waits (both + one empty)', () => {
    const tiny: GameConfig = {
      mode: 'custom',
      deck: { kind: 'custom', flavors: ['v-cola', 'v-diet-cola', 'cream-soda'] },
      dealing: 'reveal-all',
      drawPerRound: 1,
      maxPlacedPerRound: 3,
      power: 'fixed',
      fixedPower: { 'v-cola': 4, 'v-diet-cola': 4, 'cream-soda': 5 },
      effectsEnabled: true,
    };
    // Both empty: round 1 spends everything, later rounds auto-pass.
    const { controller } = make();
    controller.startCustomGame(tiny);
    controller.setSeat('A');
    expect(controller.isSeatEmpty('A')).toBe(false);
    for (const idx of [0, 1, 2]) controller.send({ type: 'place', handIndex: idx, zone: 'cool' });
    controller.send({ type: 'lock' });
    controller.setSeat('B');
    for (const idx of [0, 1, 2]) controller.send({ type: 'place', handIndex: idx, zone: 'cool' });
    controller.send({ type: 'lock' });
    expect(latest(controller).phase).toBe('roundReveal');
    controller.nextRound();
    // Round 2 auto-revealed with zero intents; round 3 showing as reveal.
    expect(latest(controller).phase).toBe('roundReveal');
    expect(latest(controller).round).toBe(3);
    controller.nextRound();
    expect(latest(controller).phase).toBe('complete');

    // One empty (large maxPlaced 6 spends A's full hand in round 1).
    const big = make().controller;
    big.startCustomGame({ ...customConfig(), maxPlacedPerRound: 6 });
    big.setSeat('A');
    for (const idx of [0, 1, 2, 3, 4, 5]) big.send({ type: 'place', handIndex: idx, zone: 'cool' });
    big.send({ type: 'lock' });
    big.setSeat('B');
    big.send({ type: 'place', handIndex: 0, zone: 'cool' });
    big.send({ type: 'lock' });
    expect(latest(big).phase).toBe('roundReveal');
    big.nextRound();
    expect(big.isSeatEmpty('A')).toBe(true);
    expect(big.isSeatEmpty('B')).toBe(false);
    expect(latest(big).locks.A).toBe(true);
    big.setSeat('B');
    big.send({ type: 'place', handIndex: 1, zone: 'party' });
    big.send({ type: 'lock' });
    expect(latest(big).phase).toBe('roundReveal');
  });

  it('hot-seat draw-per-round: A finishing draws must not auto-lock B (smoke-custom)', () => {
    // Regression: B has an empty hand and stale drawsLeft 0 before its turn
    // begins. Completing A's draws used to auto-lock B via the both-seats
    // scope in maybeStartPlacement, so A's lock revealed immediately and B's
    // turn (and its pass screen) was skipped entirely.
    const { controller } = make();
    controller.startCustomGame({
      ...customConfig(),
      dealing: 'draw-per-round',
      drawPerRound: 2,
    });
    controller.setSeat('A');
    controller.send({ type: 'draw' });
    controller.send({ type: 'draw' });
    // B never began: not locked, not "empty" for pass-screen purposes.
    expect(latest(controller).locks.B).toBe(false);
    expect(controller.isSeatEmpty('B')).toBe(false);
    controller.send({ type: 'place', handIndex: 0, zone: 'cool' });
    controller.send({ type: 'place', handIndex: 1, zone: 'party' });
    controller.send({ type: 'lock' });
    expect(latest(controller).locks).toEqual({ A: true, B: false });
    // B's turn begins normally with its own draws.
    controller.setSeat('B');
    expect(latest(controller).locks.B).toBe(false);
    controller.send({ type: 'draw' });
    controller.send({ type: 'draw' });
    controller.send({ type: 'place', handIndex: 0, zone: 'cool' });
    controller.send({ type: 'lock' });
    expect(latest(controller).phase).toBe('roundReveal');
  });

  it('hidden info: opponent count/zones/recall invisible pre-reveal, visible after', () => {
    const cfg: GameConfig = { ...customConfig(), maxPlacedPerRound: 3 };
    type Run = (c: LocalController, base: number) => void;
    const variants: Array<[string, Run, number]> = [
      ['none', () => {}, 0],
      ['one', (c, b) => void c.send({ type: 'place', handIndex: b, zone: 'cool' }), 1],
      [
        'three',
        (c, b) => {
          c.send({ type: 'place', handIndex: b, zone: 'party' });
          c.send({ type: 'place', handIndex: b + 1, zone: 'energy' });
          c.send({ type: 'place', handIndex: b + 2, zone: 'party' });
        },
        3,
      ],
      [
        'recall',
        (c, b) => {
          c.send({ type: 'place', handIndex: b, zone: 'energy' });
          c.send({ type: 'place', handIndex: b + 1, zone: 'party' });
          c.send({ type: 'unplace', handIndex: b });
          c.send({ type: 'unplace', handIndex: b + 1 });
        },
        0,
      ],
    ];
    for (const seat of ['A', 'B'] as const) {
      const foe: Player = seat === 'A' ? 'B' : 'A';
      for (const round of [1, 2] as const) {
        // Fresh hand indices per round (earlier rounds' cards stay spent).
        const own = round === 1 ? 0 : 1;
        const base = round === 1 ? 0 : 1;
        const snapshots = variants.map(([name, run]) => {
          const { controller } = make();
          controller.startCustomGame(cfg);
          if (round === 2) {
            // Identical round 1 first, so round 2 also covers "later rounds".
            lockBothForRound(controller, 0);
            controller.nextRound();
          }
          controller.setSeat(seat);
          controller.send({ type: 'place', handIndex: own, zone: 'cool' });
          controller.setSeat(foe);
          run(controller, base);
          controller.setSeat(seat);
          return { name, json: JSON.stringify(latest(controller)) };
        });
        const first = snapshots[0]?.json ?? '';
        for (const { name, json } of snapshots) {
          expect(json, `${seat} round ${round} variant ${name}`).toBe(first);
        }
        // Entire serialized view is identical: spot-check the fields that
        // could plausibly move when the opponent acts.
        for (const { name, json } of snapshots) {
          const parsed = JSON.parse(json) as PlayerView;
          const ref = JSON.parse(first) as PlayerView;
          expect(parsed.opponentHandCount, name).toBe(ref.opponentHandCount);
          expect(parsed.drawsRemaining, name).toBe(ref.drawsRemaining);
          expect(parsed.drawPileCount, name).toBe(ref.drawPileCount);
          expect(parsed.deadlineMs, name).toBe(ref.deadlineMs);
          expect(parsed.locks, name).toEqual(ref.locks);
          for (const board of parsed.boards) {
            if (board.kind !== 'current') continue;
            for (const zone of Object.values(board.zones)) {
              expect(zone, name).not.toHaveProperty('foe');
              expect(zone, name).not.toHaveProperty('foeCount');
              expect(Object.keys(zone).sort(), name).toEqual(['mine']);
            }
          }
        }
        if (round === 2) {
          // Past round stays visible: identical round 1 revealed both sides.
          const past = JSON.parse(first) as PlayerView;
          const revealed = past.boards[0];
          expect(revealed?.kind).toBe('revealed');
          if (revealed?.kind === 'revealed') {
            expect(revealed.zones['cool']?.foe.length).toBe(1);
          }
        }
        // Reveal: the opponent's cards ARE present, with the variant's count.
        // (Empty variants cannot lock pre-item-4, so only placed variants
        // reveal here; emptiness-visibility is covered by the placing check.)
        variants.forEach(([vname, run, expected]) => {
          if (expected === 0) return;
          const { controller } = make();
          controller.startCustomGame(cfg);
          if (round === 2) {
            lockBothForRound(controller, 0);
            controller.nextRound();
          }
          controller.setSeat(seat);
          controller.send({ type: 'place', handIndex: own, zone: 'cool' });
          controller.send({ type: 'lock' });
          controller.setSeat(foe);
          run(controller, base);
          controller.send({ type: 'lock' });
          controller.setSeat(seat);
          const view = latest(controller);
          expect(view.phase).toBe('roundReveal');
          const board = view.boards[round - 1];
          expect(board?.kind).toBe('revealed');
          if (board?.kind === 'revealed') {
            let foeCards = 0;
            for (const zone of Object.values(board.zones)) foeCards += zone.foe.length;
            expect(foeCards, `variant ${vname}`).toBe(expected);
          }
        });
      }
    }
  });
});

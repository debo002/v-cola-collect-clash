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

  it('redaction: identical own state with different opponent secrets gives identical JSON', () => {
    const phases: Array<'placing' | 'roundReveal' | 'complete'> = [
      'placing',
      'roundReveal',
      'complete',
    ];
    for (const seat of ['A', 'B'] as const) {
      for (const phase of phases) {
        const first = make().controller;
        const second = make().controller;
        first.startCustomGame(customConfig());
        second.startCustomGame(customConfig());
        if (phase === 'placing') {
          first.setSeat(seat);
          second.setSeat(seat);
          first.send({ type: 'place', handIndex: 0, zone: 'cool' });
          second.send({ type: 'place', handIndex: 0, zone: 'cool' });
          const foe: Player = seat === 'A' ? 'B' : 'A';
          first.setSeat(foe);
          second.setSeat(foe);
          // Same count (1 in cool), different hidden card.
          first.send({ type: 'place', handIndex: 0, zone: 'cool' });
          second.send({ type: 'place', handIndex: 1, zone: 'cool' });
          first.setSeat(seat);
          second.setSeat(seat);
        } else if (phase === 'roundReveal') {
          lockBothForRound(first, 0);
          lockBothForRound(second, 0);
          first.setSeat(seat);
          second.setSeat(seat);
        } else {
          for (let round = 0; round < 3; round += 1) {
            lockBothForRound(first, round);
            lockBothForRound(second, round);
            if (round < 2) {
              first.nextRound();
              second.nextRound();
            }
          }
          first.setSeat(seat);
          second.setSeat(seat);
        }
        let viewA: PlayerView | null = null;
        let viewB: PlayerView | null = null;
        const offA = first.subscribe((v) => {
          viewA = v;
        });
        const offB = second.subscribe((v) => {
          viewB = v;
        });
        offA();
        offB();
        expect(viewA?.phase).toBe(phase === 'placing' ? 'placing' : phase);
        expect(JSON.stringify(viewB)).toBe(JSON.stringify(viewA));
        // Current-round opponent data is a count only.
        const parsed = JSON.parse(JSON.stringify(viewA)) as PlayerView;
        for (const board of parsed.boards) {
          if (board.kind === 'current') {
            for (const zoneId of Object.keys(board.zones)) {
              const zone = board.zones[zoneId];
              expect(zone).toHaveProperty('foeCount');
              expect(zone).not.toHaveProperty('foe');
              expect(typeof zone?.foeCount).toBe('number');
            }
          }
        }
        expect(typeof parsed.opponentHandCount).toBe('number');
      }
    }
  });
});

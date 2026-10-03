import { describe, expect, it, afterEach } from 'vitest';
import type { Collection } from '../game/collection';
import type { GameConfig } from '../game/config';
import type { PlayerView } from '../game/controller';
import type { HandCard } from '../game/hands';
import { LocalController, type ControllerClock } from '../game/localController';
import {
  apply,
  applyTimeout,
  beginTurn,
  createRoomState,
  type RoomState,
} from '../game/matchEngine';
import type { Player } from '../game/match';
import type { FlavorId } from '../game/types';
import { buildPlayerView } from '../game/view';

const NOW = 1_000_000;
const zeroRng = () => 0;
const ctx = () => ({ now: NOW, rng: zeroRng });

const ROSTER: FlavorId[] = [
  'v-cola',
  'v-diet-cola',
  'cream-soda',
  'v-lemon',
  'lemon-mint',
  'blueberry',
];

const FIXED_POWER: Record<string, number> = {
  'v-cola': 4,
  'v-diet-cola': 4,
  'cream-soda': 5,
  'v-lemon': 3,
  'lemon-mint': 3,
  blueberry: 1,
};

/** Flavors outside the fixed test hand: legal draw-pool entries (no duplicates). */
const DRAW_POOL: FlavorId[] = [
  'pomegranate',
  'pink-lemonade',
  'pina-colada',
  'v7-apple-malt',
  'v7-pineapple-malt',
];

function engineConfig(dealing: GameConfig['dealing'] = 'reveal-all'): GameConfig {
  return {
    mode: 'custom',
    deck: { kind: 'custom', flavors: [...ROSTER] },
    dealing,
    drawPerRound: 2,
    maxPlacedPerRound: 2,
    power: 'fixed',
    fixedPower: { ...FIXED_POWER } as GameConfig['fixedPower'],
    effectsEnabled: true,
  };
}

function fixedHand(): HandCard[] {
  return ROSTER.map((flavor) => ({ flavor, loaner: true, power: FIXED_POWER[flavor] ?? 3 }));
}

function makeRoom(
  poolA: FlavorId[] = [],
  poolB: FlavorId[] = [],
  dealing: GameConfig['dealing'] = 'reveal-all'
): RoomState {
  const config = engineConfig(dealing);
  return createRoomState(config, fixedHand(), fixedHand(), poolA, poolB);
}

function lockBoth(room: RoomState, handIndex = 0): RoomState {
  let next = apply(room, 'A', { type: 'place', handIndex, zone: 'cool' }, ctx()).state;
  next = apply(next, 'A', { type: 'lock' }, ctx()).state;
  next = apply(next, 'B', { type: 'place', handIndex, zone: 'cool' }, ctx()).state;
  next = apply(next, 'B', { type: 'lock' }, ctx()).state;
  return next;
}

describe('matchEngine', () => {
  it('place, unplace, lock keeps state consistent', () => {
    let room = makeRoom();
    room = apply(room, 'A', { type: 'place', handIndex: 0, zone: 'cool' }, ctx()).state;
    expect(buildPlayerView(room, 'A').boards[0]?.kind).toBe('current');
    room = apply(room, 'A', { type: 'unplace', handIndex: 0 }, ctx()).state;
    const view = buildPlayerView(room, 'A');
    const current = view.boards.find((b) => b.kind === 'current');
    let placed = 0;
    if (current) {
      for (const zoneId of Object.keys(current.zones))
        placed += current.zones[zoneId]?.mine.length ?? 0;
    }
    expect(placed).toBe(0);
    room = apply(room, 'A', { type: 'place', handIndex: 1, zone: 'party' }, ctx()).state;
    room = apply(room, 'A', { type: 'lock' }, ctx()).state;
    expect(room.match.locks.A).toBe(true);
  });

  it('rejects invalid intents without changing state', () => {
    const room = makeRoom();
    const third = (() => {
      let next = apply(room, 'A', { type: 'place', handIndex: 0, zone: 'cool' }, ctx()).state;
      next = apply(next, 'A', { type: 'place', handIndex: 1, zone: 'party' }, ctx()).state;
      return apply(next, 'A', { type: 'place', handIndex: 2, zone: 'energy' }, ctx());
    })();
    expect(third.rejected).toBe('Place at most 2 cards per round');
    expect(third.events).toEqual([]);
    // State keeps the two legal placements; the third card stays in hand.
    const kept = (() => {
      let placed = 0;
      const board = third.state.match.boards[third.state.match.round - 1];
      if (board !== undefined) {
        for (const zoneId of Object.keys(board)) placed += board[zoneId]?.A.length ?? 0;
      }
      return placed;
    })();
    expect(kept).toBe(2);
    const notWaiting = apply(room, 'A', { type: 'ready' }, ctx());
    expect(notWaiting.rejected).toBe('Not waiting for ready');
    const earlyRematch = apply(room, 'A', { type: 'rematch' }, ctx());
    expect(earlyRematch.rejected).toBe('Match is not over');
  });

  it('both-lock reveals simultaneously; ready advances only when both ready', () => {
    let room = makeRoom();
    room = lockBoth(room, 0);
    expect(room.stage).toBe('roundReveal');
    expect(room.match.round).toBe(2);
    const revealed = buildPlayerView(room, 'A').boards[0];
    expect(revealed?.kind).toBe('revealed');
    const single = apply(room, 'A', { type: 'ready' }, ctx());
    expect(single.rejected).toBeUndefined();
    expect(single.state.stage).toBe('roundReveal');
    const both = apply(single.state, 'B', { type: 'ready' }, ctx());
    expect(both.events).toEqual(['advanced']);
    expect(both.state.stage).toBe('placing');
    expect(both.state.match.round).toBe(2);
  });

  it('rematch needs both seats', () => {
    let room = makeRoom();
    for (let round = 0; round < 3; round += 1) {
      room = lockBoth(room, round);
      if (round < 2) {
        room = apply(room, 'A', { type: 'ready' }, ctx()).state;
        room = apply(room, 'B', { type: 'ready' }, ctx()).state;
      }
    }
    expect(room.stage).toBe('complete');
    const single = apply(room, 'A', { type: 'rematch' }, ctx());
    expect(single.events).toEqual([]);
    expect(single.state.rematch).toEqual({ A: true, B: false });
    const both = apply(single.state, 'B', { type: 'rematch' }, ctx());
    expect(both.events).toEqual(['rematchAgreed']);
  });

  it('timeout auto-places with seeded rng and can target one seat', () => {
    const first = applyTimeout(beginTurn(makeRoom(), 'A', ctx()), ['A', 'B'], ctx());
    const second = applyTimeout(beginTurn(makeRoom(), 'A', ctx()), ['A', 'B'], ctx());
    expect(JSON.stringify(first.state.match.boards)).toBe(
      JSON.stringify(second.state.match.boards)
    );

    let room = beginTurn(makeRoom(), 'A', ctx());
    room = applyTimeout(room, ['A'], ctx()).state;
    expect(room.match.locks.A).toBe(true);
    expect(room.match.locks.B).toBe(false);
    let placedB = 0;
    const board = room.match.boards[room.match.round - 1];
    if (board !== undefined) {
      for (const zoneId of Object.keys(board)) placedB += board[zoneId]?.B.length ?? 0;
    }
    expect(placedB).toBe(0);
  });

  it('draw-per-round starts the shared deadline only after all draws', () => {
    let room = makeRoom([...DRAW_POOL], [...DRAW_POOL], 'draw-per-round');
    room = beginTurn(room, 'A', ctx());
    room = beginTurn(room, 'B', ctx());
    expect(room.drawsLeft).toEqual({ A: 2, B: 2 });
    expect(room.deadlineMs).toBeNull();
    room = apply(room, 'A', { type: 'draw' }, ctx()).state;
    room = apply(room, 'A', { type: 'draw' }, ctx()).state;
    expect(room.deadlineMs).toBeNull();
    room = apply(room, 'B', { type: 'draw' }, ctx()).state;
    room = apply(room, 'B', { type: 'draw' }, ctx()).state;
    expect(room.drawsLeft).toEqual({ A: 0, B: 0 });
    expect(room.deadlineMs).toBe(NOW + 60_000);
  });

  it('view computes results itself at complete', () => {
    let room = makeRoom();
    for (let round = 0; round < 3; round += 1) {
      room = lockBoth(room, round);
      if (round < 2) {
        room = apply(room, 'A', { type: 'ready' }, ctx()).state;
        room = apply(room, 'B', { type: 'ready' }, ctx()).state;
      }
    }
    const view = buildPlayerView(room, 'A');
    expect(view.phase).toBe('complete');
    expect(view.results).not.toBeNull();
    expect(view.explanations).not.toBeNull();
    expect(view.boards.every((b) => b.kind === 'revealed')).toBe(true);
  });

  it('redaction: same own state, different opponent secrets, identical JSON (every phase x seat)', () => {
    for (const seat of ['A', 'B'] as const) {
      const foe: Player = seat === 'A' ? 'B' : 'A';
      // placing: different opponent card, same zone and count
      {
        let first = beginTurn(makeRoom(), seat, ctx());
        let second = beginTurn(makeRoom(), seat, ctx());
        first = apply(first, seat, { type: 'place', handIndex: 0, zone: 'cool' }, ctx()).state;
        second = apply(second, seat, { type: 'place', handIndex: 0, zone: 'cool' }, ctx()).state;
        first = apply(first, foe, { type: 'place', handIndex: 0, zone: 'cool' }, ctx()).state;
        second = apply(second, foe, { type: 'place', handIndex: 1, zone: 'cool' }, ctx()).state;
        expect(JSON.stringify(buildPlayerView(second, seat))).toBe(
          JSON.stringify(buildPlayerView(first, seat))
        );
      }
      // roundReveal
      {
        const first = lockBoth(makeRoom(), 0);
        const second = lockBoth(makeRoom(), 0);
        expect(JSON.stringify(buildPlayerView(second, seat))).toBe(
          JSON.stringify(buildPlayerView(first, seat))
        );
      }
      // complete
      {
        let first = makeRoom();
        let second = makeRoom();
        for (let round = 0; round < 3; round += 1) {
          first = lockBoth(first, round);
          second = lockBoth(second, round);
          if (round < 2) {
            first = apply(first, 'A', { type: 'ready' }, ctx()).state;
            first = apply(first, 'B', { type: 'ready' }, ctx()).state;
            second = apply(second, 'A', { type: 'ready' }, ctx()).state;
            second = apply(second, 'B', { type: 'ready' }, ctx()).state;
          }
        }
        expect(JSON.stringify(buildPlayerView(second, seat))).toBe(
          JSON.stringify(buildPlayerView(first, seat))
        );
      }
    }
  });

  it('redaction: draw-per-round where opponent draws different cards', () => {
    const ownPool = DRAW_POOL.slice(0, 3);
    const foePoolOne: FlavorId[] = ['v7-apple-malt', 'v7-pineapple-malt', 'pomegranate'];
    const foePoolTwo: FlavorId[] = ['pomegranate', 'pink-lemonade', 'pina-colada'];
    for (const seat of ['A', 'B'] as const) {
      const pools = (foePool: FlavorId[]): [FlavorId[], FlavorId[]] =>
        seat === 'A' ? [ownPool, foePool] : [foePool, ownPool];
      const [a1, b1] = pools(foePoolOne);
      const [a2, b2] = pools(foePoolTwo);
      let first = makeRoom(a1, b1, 'draw-per-round');
      let second = makeRoom(a2, b2, 'draw-per-round');
      first = beginTurn(first, 'A', ctx());
      second = beginTurn(second, 'A', ctx());
      first = beginTurn(first, 'B', ctx());
      second = beginTurn(second, 'B', ctx());
      for (let d = 0; d < 2; d += 1) {
        first = apply(first, 'A', { type: 'draw' }, ctx()).state;
        second = apply(second, 'A', { type: 'draw' }, ctx()).state;
      }
      for (let d = 0; d < 2; d += 1) {
        first = apply(first, 'B', { type: 'draw' }, ctx()).state;
        second = apply(second, 'B', { type: 'draw' }, ctx()).state;
      }
      const viewA = buildPlayerView(first, seat);
      const viewB = buildPlayerView(second, seat);
      expect(JSON.stringify(viewB)).toBe(JSON.stringify(viewA));
    }
  });
});

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

function emptyCollection(): Collection {
  return {
    getFlavors: () => [],
    getOwnedFlavors: () => new Set<string>(),
    addItem: () => {},
    items: [],
  } as unknown as Collection;
}

function latestView(controller: LocalController): PlayerView {
  let current: PlayerView | null = null;
  const off = controller.subscribe((v) => {
    current = v;
  });
  off();
  return current as unknown as PlayerView;
}

function customGame(controller: LocalController): void {
  controller.startCustomGame({
    mode: 'custom',
    deck: { kind: 'custom', flavors: [...ROSTER] },
    dealing: 'reveal-all',
    drawPerRound: 2,
    maxPlacedPerRound: 2,
    power: 'fixed',
    fixedPower: { ...FIXED_POWER } as GameConfig['fixedPower'],
    effectsEnabled: true,
  });
}

describe('LocalController timer parity', () => {
  const controllers: LocalController[] = [];
  afterEach(() => {
    for (const c of controllers.splice(0)) c.dispose();
  });

  it('A times out: only A auto-placed', () => {
    const clock = new FakeClock();
    const controller = new LocalController(emptyCollection(), clock);
    controllers.push(controller);
    customGame(controller);
    controller.setSeat('A');
    clock.advance(61_000);
    const view = latestView(controller);
    expect(view.locks.A).toBe(true);
    expect(view.locks.B).toBe(false);
    const current = view.boards.find((b) => b.kind === 'current');
    let foePlaced = 0;
    if (current) {
      for (const zoneId of Object.keys(current.zones))
        foePlaced += current.zones[zoneId]?.foeCount ?? 0;
    }
    expect(foePlaced).toBe(0);
  });

  it('deadline resets on setSeat', () => {
    const clock = new FakeClock();
    const controller = new LocalController(emptyCollection(), clock);
    controllers.push(controller);
    customGame(controller);
    controller.setSeat('A');
    const first = latestView(controller).deadlineMs;
    clock.advance(10_000);
    controller.send({ type: 'place', handIndex: 0, zone: 'cool' });
    controller.send({ type: 'lock' });
    controller.setSeat('B');
    const second = latestView(controller).deadlineMs;
    expect(first).toBe(1_000_000 + 60_000);
    expect(second).toBe(1_010_000 + 60_000);
  });

  it('nextRound issues ready for both seats', () => {
    const clock = new FakeClock();
    const controller = new LocalController(emptyCollection(), clock);
    controllers.push(controller);
    customGame(controller);
    controller.setSeat('A');
    controller.send({ type: 'place', handIndex: 0, zone: 'cool' });
    controller.send({ type: 'lock' });
    controller.setSeat('B');
    controller.send({ type: 'place', handIndex: 0, zone: 'cool' });
    controller.send({ type: 'lock' });
    expect(latestView(controller).phase).toBe('roundReveal');
    controller.nextRound();
    const view = latestView(controller);
    expect(view.phase).toBe('placing');
    expect(view.round).toBe(2);
    expect(view.seat).toBe('A');
  });
});

import type { GameConfig } from './config';
import {
  addDrawnCard,
  autoPlaceForTimeout,
  bothLocked,
  createMatch,
  lockPlayer,
  placeCards,
  revealRound,
  TIMER_SECONDS,
  unplaceCard,
  type MatchState,
  type Player,
} from './match';
import { intBelow, rollPower, type Rng } from './rng';
import type { FlavorId } from './types';
import { ZONES } from './zones';
import type { Intent } from './controller';

/**
 * Pure shared match engine (no DOM, no timers, no Date.now, no Math.random).
 * Both the hot-seat LocalController and the online room server apply intents
 * through here, so local and online play share one rule path. All randomness
 * and time come from `ctx`, injected by the caller.
 */

export interface EngineCtx {
  readonly now: number;
  readonly rng: Rng;
}

export type RoomStage = 'idle' | 'placing' | 'roundReveal' | 'complete';

export interface RoomState {
  readonly stage: RoomStage;
  readonly config: GameConfig;
  readonly match: MatchState;
  readonly decks: Readonly<Record<Player, readonly FlavorId[]>>;
  readonly drawsLeft: Readonly<Record<Player, number>>;
  readonly deadlineMs: number | null;
  readonly ready: Readonly<Record<Player, boolean>>;
  readonly rematch: Readonly<Record<Player, boolean>>;
}

export type RoomEvent = 'revealed' | 'advanced' | 'completed' | 'rematchAgreed';

export interface ApplyResult {
  readonly state: RoomState;
  readonly rejected?: string;
  readonly events: readonly RoomEvent[];
}

export function createRoomState(
  config: GameConfig,
  handA: readonly import('./hands').HandCard[],
  handB: readonly import('./hands').HandCard[],
  poolA: readonly FlavorId[],
  poolB: readonly FlavorId[]
): RoomState {
  return {
    stage: 'placing',
    config,
    match: createMatch(handA, handB, config),
    decks: { A: poolA, B: poolB },
    drawsLeft: { A: 0, B: 0 },
    deadlineMs: null,
    ready: { A: false, B: false },
    rematch: { A: false, B: false },
  };
}

/**
 * Hot-seat turn start: set this seat's required draws and reset the 60s
 * clock (each hot-seat turn has its own deadline). No-op unless placing.
 */
export function beginTurn(state: RoomState, seat: Player, ctx: EngineCtx): RoomState {
  if (state.stage !== 'placing') return state;
  const count =
    state.config.dealing === 'draw-per-round'
      ? Math.min(state.config.drawPerRound, state.decks[seat].length)
      : 0;
  return {
    ...state,
    drawsLeft: { ...state.drawsLeft, [seat]: count },
    deadlineMs: count === 0 ? ctx.now + TIMER_SECONDS * 1000 : null,
  };
}

/** Shared deadline for simultaneous play: start once all required draws are done. */
function maybeStartDeadline(state: RoomState, ctx: EngineCtx): RoomState {
  if (
    state.stage === 'placing' &&
    state.deadlineMs === null &&
    state.drawsLeft.A === 0 &&
    state.drawsLeft.B === 0
  ) {
    return { ...state, deadlineMs: ctx.now + TIMER_SECONDS * 1000 };
  }
  return state;
}

function reveal(state: RoomState): { state: RoomState; event: RoomEvent } {
  const match = revealRound(state.match);
  if (match.phase === 'complete') {
    return {
      state: { ...state, match, stage: 'complete', deadlineMs: null },
      event: 'completed',
    };
  }
  return {
    state: {
      ...state,
      match,
      stage: 'roundReveal',
      deadlineMs: null,
      ready: { A: false, B: false },
    },
    event: 'revealed',
  };
}

function currentPlacements(state: RoomState, seat: Player): Map<number, string> {
  const placements = new Map<number, string>();
  const board = state.match.boards[state.match.round - 1];
  if (board === undefined) return placements;
  for (const zone of ZONES) {
    const side = board[zone.id];
    if (side === undefined) continue;
    for (const card of side[seat]) placements.set(card.handIndex, zone.id);
  }
  return placements;
}

export function apply(state: RoomState, seat: Player, intent: Intent, ctx: EngineCtx): ApplyResult {
  const reject = (rejected: string): ApplyResult => ({ state, rejected, events: [] });

  if (intent.type === 'ready') {
    if (state.stage !== 'roundReveal') return reject('Not waiting for ready');
    const ready = { ...state.ready, [seat]: true };
    if (ready.A && ready.B) {
      let next: RoomState = { ...state, stage: 'placing', ready: { A: false, B: false } };
      if (next.config.dealing === 'draw-per-round') {
        next = {
          ...next,
          drawsLeft: {
            A: Math.min(next.config.drawPerRound, next.decks.A.length),
            B: Math.min(next.config.drawPerRound, next.decks.B.length),
          },
        };
      }
      next = maybeStartDeadline(next, ctx);
      return { state: next, events: ['advanced'] };
    }
    return { state: { ...state, ready }, events: [] };
  }

  if (intent.type === 'rematch') {
    if (state.stage !== 'complete') return reject('Match is not over');
    const rematch = { ...state.rematch, [seat]: true };
    if (rematch.A && rematch.B) {
      return { state: { ...state, rematch }, events: ['rematchAgreed'] };
    }
    return { state: { ...state, rematch }, events: [] };
  }

  if (state.stage !== 'placing') return reject('Match is not accepting intents');

  if (intent.type === 'place') {
    const placements = currentPlacements(state, seat);
    if (placements.has(intent.handIndex)) {
      placements.set(intent.handIndex, intent.zone);
    } else {
      const maxPlaced = state.match.maxPlacedPerRound ?? 2;
      if (placements.size >= maxPlaced) {
        return reject(`Place at most ${maxPlaced} cards per round`);
      }
      placements.set(intent.handIndex, intent.zone);
    }
    try {
      const list = [...placements.entries()].map(([handIndex, zone]) => ({ handIndex, zone }));
      const match = placeCards(state.match, seat, list);
      return { state: { ...state, match }, events: [] };
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'Invalid placement');
    }
  }

  if (intent.type === 'unplace') {
    try {
      const match = unplaceCard(state.match, seat, intent.handIndex);
      return { state: { ...state, match }, events: [] };
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'Cannot remove card');
    }
  }

  if (intent.type === 'draw') {
    if (state.drawsLeft[seat] <= 0) return reject('No draws remaining');
    const pool = state.decks[seat];
    if (pool.length === 0) return reject('No cards left to draw');
    const index = intBelow(ctx.rng, pool.length);
    const flavor = pool[index];
    if (flavor === undefined) return reject('No cards left to draw');
    try {
      const match = addDrawnCard(state.match, seat, {
        flavor,
        loaner: true,
        power:
          state.config.power === 'fixed'
            ? (state.config.fixedPower[flavor] ?? 3)
            : rollPower(ctx.rng),
      });
      let next: RoomState = {
        ...state,
        match,
        decks: { ...state.decks, [seat]: pool.filter((_, i) => i !== index) },
        drawsLeft: { ...state.drawsLeft, [seat]: Math.max(0, state.drawsLeft[seat] - 1) },
      };
      next = maybeStartDeadline(next, ctx);
      return { state: next, events: [] };
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'Cannot draw');
    }
  }

  if (intent.type === 'lock') {
    try {
      const match = lockPlayer(state.match, seat);
      const next: RoomState = { ...state, match };
      if (bothLocked(match)) {
        const { state: revealed, event } = reveal(next);
        return { state: revealed, events: [event] };
      }
      return { state: next, events: [] };
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'Cannot lock in yet');
    }
  }

  return reject('Unknown intent');
}

/**
 * Timeout path. `seats` selects who times out: hot-seat passes only the
 * active seat (timer parity with master: each turn has its own clock);
 * online passes every unlocked seat against the one shared deadline.
 */
export function applyTimeout(
  state: RoomState,
  seats: readonly Player[],
  ctx: EngineCtx
): ApplyResult {
  if (state.stage !== 'placing') return { state, events: [] };
  let match = state.match;
  for (const seat of seats) {
    if (!match.locks[seat]) match = autoPlaceForTimeout(match, seat, ctx.rng);
  }
  if (bothLocked(match)) {
    const { state: revealed, event } = reveal({ ...state, match });
    return { state: revealed, events: [event] };
  }
  return { state: { ...state, match }, events: [] };
}

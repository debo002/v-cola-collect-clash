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
 *
 * Server deadlines (all persisted in the room row; the DO arms a single
 * alarm for the earliest due time):
 * - drawMs: draw phase (60s). On expiry the server auto-draws the remainder,
 *   then the placement deadline starts. A connected-but-idle player can never
 *   stall the match.
 * - placeMs: shared simultaneous-placement deadline (60s) once draws are done.
 * - readyMs: round-reveal auto-advance (8s).
 * - disconnect: a seat seen at least once and then gone 2 minutes forfeits.
 * - idle: rooms with no activity for 1 hour are deleted.
 */

export const DRAW_SECONDS = 60;
export const PLACE_SECONDS = TIMER_SECONDS;
export const READY_SECONDS = 8;
export const DISCONNECT_MS = 120_000;
export const IDLE_MS = 3_600_000;

export interface EngineCtx {
  readonly now: number;
  readonly rng: Rng;
}

export type RoomStage = 'idle' | 'placing' | 'roundReveal' | 'complete';

export interface RoomOver {
  readonly winner: Player | null;
  readonly reason: string;
}

export interface RoomState {
  readonly stage: RoomStage;
  readonly config: GameConfig;
  readonly match: MatchState;
  readonly decks: Readonly<Record<Player, readonly FlavorId[]>>;
  readonly drawsLeft: Readonly<Record<Player, number>>;
  /** Displayed deadline: drawMs ?? placeMs. */
  readonly deadlineMs: number | null;
  readonly drawMs: number | null;
  readonly placeMs: number | null;
  readonly readyMs: number | null;
  readonly ready: Readonly<Record<Player, boolean>>;
  readonly rematch: Readonly<Record<Player, boolean>>;
  readonly seenAt: Readonly<Record<Player, number | null>>;
  readonly bornAt: number;
  readonly activityMs: number;
  readonly over: RoomOver | null;
}

export type RoomEvent = 'revealed' | 'advanced' | 'completed' | 'rematchAgreed' | 'forfeit';

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
  poolB: readonly FlavorId[],
  now: number
): RoomState {
  return {
    stage: 'placing',
    config,
    match: createMatch(handA, handB, config),
    decks: { A: poolA, B: poolB },
    drawsLeft: { A: 0, B: 0 },
    deadlineMs: null,
    drawMs: null,
    placeMs: null,
    readyMs: null,
    ready: { A: false, B: false },
    rematch: { A: false, B: false },
    seenAt: { A: null, B: null },
    bornAt: now,
    activityMs: now,
    over: null,
  };
}

function syncDisplay(state: RoomState): RoomState {
  const deadlineMs = state.drawMs ?? state.placeMs;
  return state.deadlineMs === deadlineMs ? state : { ...state, deadlineMs };
}

/**
 * Hot-seat turn start: set this seat's required draws and reset the 60s
 * clock (each hot-seat turn has its own deadline). No-op unless placing.
 */
export function beginTurn(state: RoomState, seat: Player, ctx: EngineCtx): RoomState {
  if (state.stage !== 'placing' || state.over !== null) return state;
  const count =
    state.config.dealing === 'draw-per-round'
      ? Math.min(state.config.drawPerRound, state.decks[seat].length)
      : 0;
  const next: RoomState = {
    ...state,
    drawsLeft: { ...state.drawsLeft, [seat]: count },
    drawMs: count > 0 ? ctx.now + DRAW_SECONDS * 1000 : null,
    placeMs: count === 0 ? ctx.now + PLACE_SECONDS * 1000 : null,
  };
  return syncDisplay(next);
}

/** Shared deadline for simultaneous play: start once all required draws are done. */
function maybeStartPlacement(state: RoomState, ctx: EngineCtx): RoomState {
  if (
    state.stage === 'placing' &&
    state.placeMs === null &&
    state.drawsLeft.A === 0 &&
    state.drawsLeft.B === 0
  ) {
    return syncDisplay({ ...state, placeMs: ctx.now + PLACE_SECONDS * 1000 });
  }
  return syncDisplay(state);
}

function reveal(state: RoomState, ctx: EngineCtx): { state: RoomState; event: RoomEvent } {
  const match = revealRound(state.match);
  if (match.phase === 'complete') {
    return {
      state: syncDisplay({
        ...state,
        match,
        stage: 'complete',
        drawMs: null,
        placeMs: null,
        readyMs: null,
        activityMs: ctx.now,
      }),
      event: 'completed',
    };
  }
  return {
    state: syncDisplay({
      ...state,
      match,
      stage: 'roundReveal',
      drawMs: null,
      placeMs: null,
      readyMs: ctx.now + READY_SECONDS * 1000,
      ready: { A: false, B: false },
      activityMs: ctx.now,
    }),
    event: 'revealed',
  };
}

function advanceRound(state: RoomState, ctx: EngineCtx): RoomState {
  let next: RoomState = {
    ...state,
    stage: 'placing',
    ready: { A: false, B: false },
    readyMs: null,
  };
  if (next.config.dealing === 'draw-per-round') {
    const drawsLeft = {
      A: Math.min(next.config.drawPerRound, next.decks.A.length),
      B: Math.min(next.config.drawPerRound, next.decks.B.length),
    };
    next = { ...next, drawsLeft };
  }
  if (next.drawsLeft.A === 0 && next.drawsLeft.B === 0) {
    next = { ...next, drawMs: null, placeMs: ctx.now + PLACE_SECONDS * 1000 };
  } else {
    next = { ...next, drawMs: ctx.now + DRAW_SECONDS * 1000, placeMs: null };
  }
  return syncDisplay({ ...next, activityMs: ctx.now });
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

function touch(state: RoomState, seat: Player, ctx: EngineCtx): RoomState {
  return {
    ...state,
    seenAt: { ...state.seenAt, [seat]: ctx.now },
    activityMs: ctx.now,
  };
}

/** Record inbound contact without changing match state (resume/close path). */
export function touchSeen(state: RoomState, seat: Player, now: number): RoomState {
  return { ...state, seenAt: { ...state.seenAt, [seat]: now }, activityMs: now };
}

export function apply(state: RoomState, seat: Player, intent: Intent, ctx: EngineCtx): ApplyResult {
  const touched = touch(state, seat, ctx);
  const reject = (rejected: string): ApplyResult => ({ state: touched, rejected, events: [] });
  if (touched.over !== null) return reject('Room is closed');

  if (intent.type === 'ready') {
    if (touched.stage !== 'roundReveal') return reject('Not waiting for ready');
    const ready = { ...touched.ready, [seat]: true };
    if (ready.A && ready.B) {
      return { state: advanceRound({ ...touched, ready }, ctx), events: ['advanced'] };
    }
    return { state: { ...touched, ready }, events: [] };
  }

  if (intent.type === 'rematch') {
    if (touched.stage !== 'complete') return reject('Match is not over');
    const rematch = { ...touched.rematch, [seat]: true };
    if (rematch.A && rematch.B) {
      return { state: { ...touched, rematch }, events: ['rematchAgreed'] };
    }
    return { state: { ...touched, rematch }, events: [] };
  }

  if (touched.stage !== 'placing') return reject('Match is not accepting intents');

  if (intent.type === 'place') {
    const placements = currentPlacements(touched, seat);
    if (placements.has(intent.handIndex)) {
      placements.set(intent.handIndex, intent.zone);
    } else {
      const maxPlaced = touched.match.maxPlacedPerRound ?? 2;
      if (placements.size >= maxPlaced) {
        return reject(`Place at most ${maxPlaced} cards per round`);
      }
      placements.set(intent.handIndex, intent.zone);
    }
    try {
      const list = [...placements.entries()].map(([handIndex, zone]) => ({ handIndex, zone }));
      const match = placeCards(touched.match, seat, list);
      return { state: { ...touched, match }, events: [] };
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'Invalid placement');
    }
  }

  if (intent.type === 'unplace') {
    try {
      const match = unplaceCard(touched.match, seat, intent.handIndex);
      return { state: { ...touched, match }, events: [] };
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'Cannot remove card');
    }
  }

  if (intent.type === 'draw') {
    if (touched.drawsLeft[seat] <= 0) return reject('No draws remaining');
    const pool = touched.decks[seat];
    if (pool.length === 0) return reject('No cards left to draw');
    const index = intBelow(ctx.rng, pool.length);
    const flavor = pool[index];
    if (flavor === undefined) return reject('No cards left to draw');
    try {
      const match = addDrawnCard(touched.match, seat, {
        flavor,
        loaner: true,
        power:
          touched.config.power === 'fixed'
            ? (touched.config.fixedPower[flavor] ?? 3)
            : rollPower(ctx.rng),
      });
      let next: RoomState = {
        ...touched,
        match,
        decks: { ...touched.decks, [seat]: pool.filter((_, i) => i !== index) },
        drawsLeft: { ...touched.drawsLeft, [seat]: Math.max(0, touched.drawsLeft[seat] - 1) },
      };
      if (next.drawsLeft.A === 0 && next.drawsLeft.B === 0) {
        next = { ...next, drawMs: null };
        next = maybeStartPlacement(next, ctx);
      }
      return { state: syncDisplay(next), events: [] };
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'Cannot draw');
    }
  }

  if (intent.type === 'lock') {
    try {
      const match = lockPlayer(touched.match, seat);
      const next: RoomState = { ...touched, match };
      if (bothLocked(match)) {
        const { state: revealed, event } = reveal(next, ctx);
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
  if (state.stage !== 'placing' || state.over !== null) return { state, events: [] };
  let match = state.match;
  for (const seat of seats) {
    if (!match.locks[seat]) match = autoPlaceForTimeout(match, seat, ctx.rng);
  }
  if (bothLocked(match)) {
    const { state: revealed, event } = reveal({ ...state, match }, ctx);
    return { state: revealed, events: [event] };
  }
  return { state: syncDisplay({ ...state, match, activityMs: ctx.now }), events: [] };
}

/**
 * Draw-phase timeout: auto-draw every seat's remainder with server-picked
 * randomness, then start the placement deadline. Idempotent.
 */
export function applyDrawTimeout(state: RoomState, ctx: EngineCtx): ApplyResult {
  if (state.stage !== 'placing' || state.over !== null) return { state, events: [] };
  if (state.drawsLeft.A === 0 && state.drawsLeft.B === 0) {
    return { state: syncDisplay({ ...state, drawMs: null }), events: [] };
  }
  let next = state;
  for (const seat of ['A', 'B'] as const) {
    while (next.drawsLeft[seat] > 0) {
      const pool = next.decks[seat];
      if (pool.length === 0) break;
      const index = intBelow(ctx.rng, pool.length);
      const flavor = pool[index];
      if (flavor === undefined) break;
      try {
        const match = addDrawnCard(next.match, seat, {
          flavor,
          loaner: true,
          power:
            next.config.power === 'fixed'
              ? (next.config.fixedPower[flavor] ?? 3)
              : rollPower(ctx.rng),
        });
        next = {
          ...next,
          match,
          decks: { ...next.decks, [seat]: pool.filter((_, i) => i !== index) },
          drawsLeft: { ...next.drawsLeft, [seat]: Math.max(0, next.drawsLeft[seat] - 1) },
        };
      } catch {
        next = {
          ...next,
          decks: { ...next.decks, [seat]: pool.filter((_, i) => i !== index) },
          drawsLeft: { ...next.drawsLeft, [seat]: Math.max(0, next.drawsLeft[seat] - 1) },
        };
      }
    }
  }
  next = { ...next, drawMs: null, activityMs: ctx.now };
  return { state: maybeStartPlacement(next, ctx), events: [] };
}

export type Presence = Readonly<Record<Player, boolean>>;

/** Earliest due time across all persisted deadlines, or null when idle. */
export function nextDueMs(state: RoomState, now: number, present: Presence): number | null {
  const due: number[] = [];
  if (state.over !== null) {
    due.push(state.activityMs + IDLE_MS);
    return due.length > 0 ? Math.min(...due) : null;
  }
  if (state.drawMs !== null) due.push(state.drawMs);
  if (state.placeMs !== null) due.push(state.placeMs);
  if (state.readyMs !== null) due.push(state.readyMs);
  if (state.stage === 'placing' || state.stage === 'roundReveal') {
    for (const seat of ['A', 'B'] as const) {
      const seen = state.seenAt[seat];
      if (!present[seat] && seen !== null) due.push(seen + DISCONNECT_MS);
    }
  }
  due.push(state.activityMs + IDLE_MS);
  void now;
  return due.length > 0 ? Math.min(...due) : null;
}

export function isIdleCleanupDue(state: RoomState, now: number): boolean {
  return now - state.activityMs >= IDLE_MS;
}

/**
 * Single-alarm handler for everything due. Idempotent: each branch no-ops
 * unless its deadline actually passed, so repeated runs are safe (alarms are
 * at-least-once and retried).
 */
export function onAlarm(state: RoomState, present: Presence, ctx: EngineCtx): ApplyResult {
  if (state.over !== null) return { state, events: [] };
  let next = state;
  const events: RoomEvent[] = [];
  if (next.drawMs !== null && ctx.now >= next.drawMs) {
    const result = applyDrawTimeout(next, ctx);
    next = result.state;
  }
  if (next.placeMs !== null && ctx.now >= next.placeMs && next.stage === 'placing') {
    const seats = (['A', 'B'] as const).filter((seat) => !next.match.locks[seat]);
    const cleared: RoomState = syncDisplay({ ...next, placeMs: null });
    const result = applyTimeout(cleared, seats, ctx);
    next = result.state;
    events.push(...result.events);
  }
  if (next.readyMs !== null && ctx.now >= next.readyMs && next.stage === 'roundReveal') {
    next = advanceRound(next, ctx);
    events.push('advanced');
  }
  if ((next.stage === 'placing' || next.stage === 'roundReveal') && next.over === null) {
    const gone = (['A', 'B'] as const).filter((seat) => {
      const seen = next.seenAt[seat];
      return !present[seat] && seen !== null && ctx.now - seen >= DISCONNECT_MS;
    });
    if (gone.length === 2) {
      next = { ...next, over: { winner: null, reason: 'abandoned' }, activityMs: ctx.now };
      events.push('forfeit');
    } else if (gone.length === 1) {
      const winner: Player = gone[0] === 'A' ? 'B' : 'A';
      next = { ...next, over: { winner, reason: 'forfeit' }, activityMs: ctx.now };
      events.push('forfeit');
    }
  }
  return { state: next, events };
}

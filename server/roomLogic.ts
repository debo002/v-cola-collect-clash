import { validateGameConfig, type GameConfig } from '../src/game/config';
import type { Player } from '../src/game/match';
import {
  apply,
  beginTurn,
  createRoomState,
  type RoomEvent,
  type RoomState,
} from '../src/game/matchEngine';
import { dealMatchHands } from '../src/game/dealing';
import { buildPlayerView } from '../src/game/view';
import { newRoomCode, newToken, parseIntent, sanitizePlayerName, type ServerMsg } from './protocol';
import type { PlayerView } from '../src/game/controller';

/**
 * Pure room operations shared by the Worker, the Room DO and Vitest.
 * No Cloudflare imports here: persistence (one row per accepted intent),
 * sockets and alarms live in the thin DO glue. Engine apply() is wrapped
 * in try/catch — any exception becomes `rejected` with state unchanged,
 * never a crash or retry loop.
 */

export interface RoomRow {
  room: RoomState;
  tokens: { A: string | null; B: string | null };
  names: { A: string; B: string | null };
}

export interface RoomDeps {
  now(): number;
  rng(): number;
}

const randomValues = (deps: RoomDeps, n: number): Uint8Array => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.floor(deps.rng() * 256);
  return out;
};

export function createRoom(
  deps: RoomDeps,
  hostName: string,
  config: GameConfig
): { row: RoomRow; code: string } | { error: string } {
  const clean = sanitizePlayerName(hostName, 'Player A');
  const invalid = validateGameConfig(config);
  if (invalid !== null) return { error: invalid };
  const dealt = dealMatchHands(config, deps.rng);
  const room = createRoomState(
    config,
    dealt.handA,
    dealt.handB,
    dealt.poolA,
    dealt.poolB,
    deps.now()
  );
  const code = newRoomCode((n) => randomValues(deps, n));
  const row: RoomRow = {
    room,
    tokens: { A: newToken((n) => randomValues(deps, n)), B: null },
    names: { A: clean, B: null },
  };
  return { row, code };
}

export function joinRoom(
  row: RoomRow,
  deps: RoomDeps,
  guestName: unknown
): { row: RoomRow; token: string } | { error: string } {
  if (row.room.over !== null) return { error: 'closed' };
  if (row.tokens.B !== null) return { error: 'full' };
  const clean = sanitizePlayerName(guestName, 'Player B');
  const token = newToken((n) => randomValues(deps, n));
  const ctx = { now: deps.now(), rng: deps.rng };
  let room = beginTurn(row.room, 'A', ctx);
  room = beginTurn(room, 'B', ctx);
  return {
    row: {
      ...row,
      room,
      tokens: { ...row.tokens, B: token },
      names: { ...row.names, B: clean },
    },
    token,
  };
}

export function resumeSeat(row: RoomRow, token: string): Player | null {
  if (token !== '' && row.tokens.A !== null && token === row.tokens.A) return 'A';
  if (token !== '' && row.tokens.B !== null && token === row.tokens.B) return 'B';
  return null;
}

export interface IntentOutcome {
  row: RoomRow;
  views: Record<Player, PlayerView>;
  events: readonly RoomEvent[];
}

export type SeatPresence = Readonly<Record<Player, boolean>>;

/**
 * The exact `view` envelope the DO sends (unit-testable without sockets).
 * opponentConnected comes from live socket tags; readyDeadlineMs mirrors the
 * room's ready auto-advance deadline (view.deadlineMs stays null in reveal).
 */
export function viewEnvelope(
  room: RoomState,
  seat: Player,
  present: SeatPresence,
  now: number,
  names: { A: string; B: string | null } = { A: 'Player A', B: 'Player B' }
): Extract<ServerMsg, { type: 'view' }> {
  const foe: Player = seat === 'A' ? 'B' : 'A';
  return {
    type: 'view',
    view: buildPlayerView(room, seat),
    serverNowMs: now,
    opponentConnected: present[foe],
    readyDeadlineMs: room.readyMs,
    names: {
      me: sanitizePlayerName(names[seat], seat === 'A' ? 'Player A' : 'Player B'),
      opponent: sanitizePlayerName(names[foe], foe === 'A' ? 'Player A' : 'Player B'),
    },
  };
}

export function applyClientIntent(
  row: RoomRow,
  deps: RoomDeps,
  seat: Player,
  rawIntent: unknown
): { ok: true; outcome: IntentOutcome } | { ok: false; reason: string } {
  if (row.room.over !== null) return { ok: false, reason: 'closed' };
  const intent = parseIntent(rawIntent);
  if (intent === null) return { ok: false, reason: 'malformed' };
  let next: RoomState;
  let events: readonly RoomEvent[];
  try {
    const result = apply(row.room, seat, intent, { now: deps.now(), rng: deps.rng });
    if (result.rejected !== undefined) return { ok: false, reason: result.rejected };
    next = result.state;
    events = result.events;
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'invalid' };
  }
  if (events.includes('rematchAgreed')) {
    const dealt = dealMatchHands(next.config, deps.rng);
    let fresh = createRoomState(
      next.config,
      dealt.handA,
      dealt.handB,
      dealt.poolA,
      dealt.poolB,
      deps.now()
    );
    const ctx = { now: deps.now(), rng: deps.rng };
    fresh = beginTurn(fresh, 'A', ctx);
    fresh = beginTurn(fresh, 'B', ctx);
    next = fresh;
  }
  const nextRow: RoomRow = { ...row, room: next };
  return {
    ok: true,
    outcome: {
      row: nextRow,
      views: { A: buildPlayerView(next, 'A'), B: buildPlayerView(next, 'B') },
      events,
    },
  };
}

import { describe, expect, it, vi } from 'vitest';

// room.ts imports cloudflare:workers (DO runtime only): mock the module so
// the Worker entrypoint loads under node. CORS logic lives in worker.
vi.mock('../../server/room', () => ({ Room: class {} }));
import type { GameConfig } from '../game/config';
import type { Player } from '../game/match';
import type { FlavorId } from '../game/types';
import { nextDueMs, onAlarm } from '../game/matchEngine';
import { buildPlayerView } from '../game/view';
import { parseClientMessage, parseIntent } from '../../server/protocol';
import {
  applyClientIntent,
  createRoom,
  joinRoom,
  resumeSeat,
  type RoomDeps,
  type RoomRow,
} from '../../server/roomLogic';

const ROSTER: FlavorId[] = [
  'v-cola',
  'v-diet-cola',
  'cream-soda',
  'v-lemon',
  'lemon-mint',
  'blueberry',
];

function config(dealing: GameConfig['dealing'] = 'reveal-all'): GameConfig {
  return {
    mode: 'custom',
    deck: { kind: 'custom', flavors: [...ROSTER] },
    dealing,
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

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function deps(now = 1_000_000, seed = 7): RoomDeps {
  const rng = seeded(seed);
  return { now: () => now, rng };
}

/** Round-trip through the real serialization path, exactly as the DO sends it. */
function wireView(row: RoomRow, seat: Player): unknown {
  const text = JSON.stringify({
    type: 'view',
    view: buildPlayerView(row.room, seat),
    serverNowMs: 1_000_000,
  });
  return JSON.parse(text).view;
}

function startRow(seed = 7): RoomRow {
  const created = createRoom(deps(1_000_000, seed), 'Host', config());
  if ('error' in created) throw new Error(created.error);
  const joined = joinRoom(created.row, deps(1_000_000, seed), 'Guest');
  if ('error' in joined) throw new Error(joined.error);
  return joined.row;
}

// NOTE: explicit `=== false` comparisons below — truthiness narrowing does
// not discriminate these unions under this repo's tsconfig (verified: tsc
// errors TS2339 on the `!x.ok` / `if (x.ok) throw` forms, clean on `===`).
function send(row: RoomRow, seat: Player, intent: unknown, seed = 7): RoomRow {
  const outcome = applyClientIntent(row, deps(1_000_000, seed), seat, intent);
  if (outcome.ok === false) throw new Error(`expected accept, got: ${outcome.reason}`);
  return outcome.outcome.row;
}

describe('roomServer', () => {
  it('create validates name and config; join fills seat B', () => {
    expect(createRoom(deps(), '', config())).toEqual({ error: 'bad-name' });
    expect(createRoom(deps(), 'Host', { ...config(), maxPlacedPerRound: 99 })).toEqual({
      error: 'placed-invalid',
    });
    const created = createRoom(deps(), 'Host', config());
    if ('error' in created) throw new Error(created.error);
    expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(created.row.tokens.A).toMatch(/^[0-9a-f]{32}$/);
    expect(created.row.tokens.B).toBeNull();
    expect(joinRoom(created.row, deps(), '')).toEqual({ error: 'bad-name' });
    const joined = joinRoom(created.row, deps(), 'Guest');
    if ('error' in joined) throw new Error(joined.error);
    expect(joinRoom(joined.row, deps(), 'Third')).toEqual({ error: 'full' });
  });

  it('resume maps tokens to seats, rejects unknown tokens', () => {
    const row = startRow();
    expect(resumeSeat(row, row.tokens.A ?? '')).toBe('A');
    expect(resumeSeat(row, row.tokens.B ?? '')).toBe('B');
    expect(resumeSeat(row, 'nope')).toBeNull();
    expect(resumeSeat(row, '')).toBeNull();
  });

  it('boundary rejects malformed JSON, wrong types, unknown zones, extra keys', () => {
    expect(parseClientMessage('{oops')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseClientMessage('42')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseClientMessage(JSON.stringify({ type: 'intent' }))).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(parseIntent({ type: 'place', handIndex: '0', zone: 'cool' })).toBeNull();
    expect(parseIntent({ type: 'place', handIndex: 1.5, zone: 'cool' })).toBeNull();
    expect(parseIntent({ type: 'place', handIndex: -1, zone: 'cool' })).toBeNull();
    expect(parseIntent({ type: 'place', handIndex: 0, zone: 'void' })).toBeNull();
    expect(parseIntent({ type: 'lock', extra: 1 })).toBeNull();
    // Forged cross-seat field is an extra key: rejected before the engine.
    expect(parseIntent({ type: 'place', handIndex: 0, zone: 'cool', seat: 'B' })).toBeNull();
    const row = startRow();
    const forged = applyClientIntent(row, deps(), 'A', {
      type: 'place',
      handIndex: 0,
      zone: 'cool',
      seat: 'B',
    });
    if (forged.ok === true) throw new Error('forged intent accepted');
    expect(forged.reason).toBe('malformed');
    const badZone = applyClientIntent(row, deps(), 'A', {
      type: 'place',
      handIndex: 0,
      zone: 'void',
    });
    if (badZone.ok === true) throw new Error('bad zone accepted');
    expect(badZone.reason).toBe('malformed');
    const outOfRange = applyClientIntent(row, deps(), 'A', {
      type: 'place',
      handIndex: 99,
      zone: 'cool',
    });
    if (outOfRange.ok === true) throw new Error('out-of-range accepted');
    expect(outOfRange.reason).toBe('Card not in hand: 99');
  });

  it('engine exceptions become rejected with state unchanged, never a crash', () => {
    const row = startRow();
    const before = JSON.stringify(row);
    const broken = { ...row, room: { ...row.room, match: undefined } } as unknown as RoomRow;
    const outcome = applyClientIntent(broken, deps(), 'A', { type: 'lock' });
    if (outcome.ok === true) throw new Error('broken row accepted');
    expect(typeof outcome.reason).toBe('string');
    expect(JSON.stringify(row)).toBe(before);
  });

  it('simultaneous placement then both-lock reveal', () => {
    let row = startRow();
    row = send(row, 'A', { type: 'place', handIndex: 0, zone: 'party' });
    row = send(row, 'B', { type: 'place', handIndex: 1, zone: 'energy' });
    row = send(row, 'A', { type: 'lock' });
    expect(row.room.stage).toBe('placing');
    row = send(row, 'B', { type: 'lock' });
    expect(row.room.stage).toBe('roundReveal');
    expect(row.room.match.round).toBe(2);
  });

  it('timeout auto-place is deterministic for a seed', () => {
    const run = () => {
      let row = startRow(11);
      const due = row.room.placeMs ?? 0;
      const result = onAlarm(row.room, { A: true, B: true }, { now: due + 1, rng: seeded(11) });
      row = { ...row, room: result.state };
      return JSON.stringify(row.room.match.boards);
    };
    expect(run()).toBe(run());
  });

  it('draw-per-round: server picks the card, only the drawer learns which', () => {
    const drawConfig = config('draw-per-round');
    const mk = (seed: number, foePool: FlavorId[]) => {
      const created = createRoom(deps(1_000_000, seed), 'Host', drawConfig);
      if ('error' in created) throw new Error(created.error);
      // Swap the guest pool so the opponent draws different cards.
      const row: RoomRow = {
        ...created.row,
        room: { ...created.row.room, decks: { ...created.row.room.decks, B: foePool } },
      };
      const joined = joinRoom(row, deps(1_000_000, seed), 'Guest');
      if ('error' in joined) throw new Error(joined.error);
      return joined.row;
    };
    const poolX: FlavorId[] = ['pomegranate', 'pink-lemonade', 'pina-colada'];
    const poolY: FlavorId[] = ['v7-apple-malt', 'v7-pineapple-malt', 'pomegranate'];
    let first = mk(21, poolX);
    let second = mk(21, poolY);
    for (const seat of ['A', 'B'] as const) {
      for (let d = 0; d < 2; d += 1) {
        first = send(first, seat, { type: 'draw' }, 21);
        second = send(second, seat, { type: 'draw' }, 21);
      }
    }
    // A's own draws came from the same pool with the same seed: identical.
    expect(JSON.stringify(wireView(second, 'A'))).toBe(JSON.stringify(wireView(first, 'A')));
    // B drew different cards, and A's wire view does not name them.
    const handsB = [first.room.match.hands.B, second.room.match.hands.B].map((h) =>
      h.map((c) => c.flavor).join(',')
    );
    expect(handsB[0]).not.toBe(handsB[1]);
    const aText = JSON.stringify(wireView(first, 'A'));
    for (const flavor of second.room.match.hands.B.map((c) => c.flavor)) {
      if (!first.room.match.hands.A.some((c) => c.flavor === flavor)) {
        expect(aText).not.toContain(`"flavor":"${flavor}"`);
      }
    }
  });

  it('ready advances only on both; 8s auto-advance is idempotent', () => {
    let row = startRow();
    row = send(row, 'A', { type: 'place', handIndex: 0, zone: 'cool' });
    row = send(row, 'A', { type: 'lock' });
    row = send(row, 'B', { type: 'place', handIndex: 0, zone: 'cool' });
    row = send(row, 'B', { type: 'lock' });
    const readyAt = row.room.readyMs ?? 0;
    const early = onAlarm(row.room, { A: true, B: true }, { now: readyAt - 1_000, rng: seeded(1) });
    expect(early.state.stage).toBe('roundReveal');
    const late = onAlarm(row.room, { A: true, B: true }, { now: readyAt + 1_000, rng: seeded(1) });
    expect(late.state.stage).toBe('placing');
    expect(late.events).toEqual(['advanced']);
    const again = onAlarm(
      late.state,
      { A: true, B: true },
      { now: readyAt + 2_000, rng: seeded(1) }
    );
    expect(again.events).toEqual([]);
    expect(JSON.stringify(again.state)).toBe(JSON.stringify(late.state));
  });

  it('rematch needs both seats', () => {
    let row = startRow();
    for (let round = 0; round < 3; round += 1) {
      row = send(row, 'A', { type: 'place', handIndex: round, zone: 'cool' });
      row = send(row, 'A', { type: 'lock' });
      row = send(row, 'B', { type: 'place', handIndex: round, zone: 'cool' });
      row = send(row, 'B', { type: 'lock' });
      if (round < 2) {
        row = send(row, 'A', { type: 'ready' });
        row = send(row, 'B', { type: 'ready' });
      }
    }
    expect(row.room.stage).toBe('complete');
    const single = applyClientIntent(row, deps(), 'A', { type: 'rematch' });
    if (!single.ok) throw new Error('first rematch rejected');
    expect(single.outcome.events).toEqual([]);
    const both = applyClientIntent(single.outcome.row, deps(), 'B', { type: 'rematch' });
    if (!both.ok) throw new Error('second rematch rejected');
    expect(both.outcome.events).toEqual(['rematchAgreed']);
    expect(both.outcome.row.room.stage).toBe('placing');
    expect(both.outcome.row.room.match.round).toBe(1);
  });

  it('disconnect: gone 2 minutes forfeits to the other seat', () => {
    let row = startRow();
    row = send(row, 'A', { type: 'place', handIndex: 0, zone: 'cool' });
    row = send(row, 'B', { type: 'place', handIndex: 1, zone: 'cool' });
    const seen = 1_000_000;
    const due = seen + 121_000;
    const one = onAlarm(row.room, { A: true, B: false }, { now: due, rng: seeded(1) });
    expect(one.state.over).toEqual({ winner: 'A', reason: 'forfeit' });
    expect(one.events).toContain('forfeit');
    const bothGone = onAlarm(row.room, { A: false, B: false }, { now: due, rng: seeded(1) });
    expect(bothGone.state.over).toEqual({ winner: null, reason: 'abandoned' });
    // Fresh join window (never seen) never forfeits.
    const fresh: RoomRow = {
      ...row,
      room: { ...row.room, seenAt: { A: null, B: null } },
    };
    const idle = onAlarm(fresh.room, { A: false, B: false }, { now: due, rng: seeded(1) });
    expect(idle.state.over).toBeNull();
  });

  it('nextDueMs tracks the earliest persisted deadline', () => {
    const row = startRow();
    const due = nextDueMs(row.room, 1_000_000, { A: true, B: true });
    expect(due).toBe(row.room.placeMs);
    const over = nextDueMs({ ...row.room, over: { winner: 'A', reason: 'forfeit' } }, 1_000_000, {
      A: true,
      B: false,
    });
    expect(over).toBe(row.room.activityMs + 3_600_000);
  });

  it('view envelope carries opponentConnected and readyDeadlineMs', async () => {
    const { viewEnvelope } = await import('../../server/roomLogic');
    const row = startRow();
    // Join (both present): each side sees the opponent connected.
    expect(viewEnvelope(row.room, 'A', { A: true, B: true }, 1_000_000).opponentConnected).toBe(
      true
    );
    // Disconnect: the remaining side sees false.
    expect(viewEnvelope(row.room, 'A', { A: true, B: false }, 1_000_000).opponentConnected).toBe(
      false
    );
    // Reconnect: true again.
    expect(viewEnvelope(row.room, 'A', { A: true, B: true }, 1_000_001).opponentConnected).toBe(
      true
    );
    // No ready deadline while placing (view.deadlineMs is the placement clock).
    const placing = viewEnvelope(row.room, 'A', { A: true, B: true }, 1_000_000);
    expect(placing.readyDeadlineMs).toBeNull();
    // Round reveal exposes the 8s auto-advance deadline in the envelope.
    let revealed = send(row, 'A', { type: 'place', handIndex: 0, zone: 'cool' });
    revealed = send(revealed, 'A', { type: 'lock' });
    revealed = send(revealed, 'B', { type: 'place', handIndex: 0, zone: 'cool' });
    revealed = send(revealed, 'B', { type: 'lock' });
    const envelope = viewEnvelope(revealed.room, 'A', { A: true, B: true }, 1_000_000);
    expect(revealed.room.stage).toBe('roundReveal');
    expect(envelope.readyDeadlineMs).toBe(revealed.room.readyMs);
    expect(envelope.readyDeadlineMs).not.toBeNull();
    expect(envelope.view.deadlineMs).toBeNull();
  });

  it('worker answers CORS preflight and headers', async () => {
    const worker = (await import('../../server/worker')).default;
    type WorkerEnv = Parameters<typeof worker.fetch>[1];
    const stubFetch = async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/internal/exists')) return Response.json({ exists: false });
      if (text.endsWith('/internal/init')) return Response.json({ ok: true });
      if (text.endsWith('/internal/join'))
        return Response.json({ token: 't'.repeat(32), seat: 'B' });
      return new Response('not found', { status: 404 });
    };
    const fakeEnv = {
      ROOM: {
        idFromName: (name: string) => ({ name }),
        get: () => ({ fetch: stubFetch }),
      },
    } as unknown as WorkerEnv;
    const preflight = await worker.fetch(
      new Request('http://x/api/rooms', { method: 'OPTIONS' }),
      fakeEnv
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toBe('content-type');
    const created = await worker.fetch(
      new Request('http://x/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Alice', config: config() }),
      }),
      fakeEnv
    );
    expect(created.status).toBe(200);
    expect(created.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const joined = await worker.fetch(
      new Request('http://x/api/rooms/ABCDEF/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Bob' }),
      }),
      fakeEnv
    );
    expect(joined.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

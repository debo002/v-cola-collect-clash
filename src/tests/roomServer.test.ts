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
  it('create sanitizes names (fallback, never rejects); join fills seat B', () => {
    // Empty/blank names fall back instead of erroring.
    const empty = createRoom(deps(), '   ', config());
    if ('error' in empty) throw new Error(empty.error);
    expect(empty.row.names.A).toBe('Player A');
    expect(createRoom(deps(), 'Host', { ...config(), maxPlacedPerRound: 99 })).toEqual({
      error: 'placed-invalid',
    });
    const created = createRoom(deps(), 'Host', config());
    if ('error' in created) throw new Error(created.error);
    expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(created.row.tokens.A).toMatch(/^[0-9a-f]{32}$/);
    expect(created.row.tokens.B).toBeNull();
    const blankGuest = joinRoom(created.row, deps(), '  \n ');
    if ('error' in blankGuest) throw new Error(blankGuest.error);
    expect(blankGuest.row.names.B).toBe('Player B');
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

  it('worker validates custom GameConfig over the wire (valid accepts, invalid rejects)', async () => {
    const worker = (await import('../../server/worker')).default;
    type WorkerEnv = Parameters<typeof worker.fetch>[1];
    const stubFetch = async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/internal/exists')) return Response.json({ exists: false });
      if (text.endsWith('/internal/init')) return Response.json({ ok: true });
      return new Response('not found', { status: 404 });
    };
    const fakeEnv = {
      ROOM: {
        idFromName: (name: string) => ({ name }),
        get: () => ({ fetch: stubFetch }),
      },
    } as unknown as WorkerEnv;

    // 1. Valid custom config accepts (200)
    const validRes = await worker.fetch(
      new Request('http://x/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Alice', config: config('draw-per-round') }),
      }),
      fakeEnv
    );
    expect(validRes.status).toBe(200);

    // 2. Invalid drawPerRound rejects (400)
    const invalidDraw = await worker.fetch(
      new Request('http://x/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Alice',
          config: { ...config('draw-per-round'), drawPerRound: 99 },
        }),
      }),
      fakeEnv
    );
    expect(invalidDraw.status).toBe(400);
    const drawErr = (await invalidDraw.json()) as { error: string };
    expect(drawErr.error).toBe('draw-invalid');

    // 3. Invalid power rejects (400)
    const invalidPower = await worker.fetch(
      new Request('http://x/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Alice',
          config: {
            ...config(),
            fixedPower: { ...config().fixedPower, 'v-cola': 10 },
          },
        }),
      }),
      fakeEnv
    );
    expect(invalidPower.status).toBe(400);
    const powerErr = (await invalidPower.json()) as { error: string };
    expect(powerErr.error).toBe('power-invalid');

    // 4. Extra unknown key on config rejects (400)
    const invalidKeys = await worker.fetch(
      new Request('http://x/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Alice',
          config: { ...config(), hackedKey: true },
        }),
      }),
      fakeEnv
    );
    expect(invalidKeys.status).toBe(400);
    const keyErr = (await invalidKeys.json()) as { error: string };
    expect(keyErr.error).toBe('config-invalid');
  });

  it('custom config is visible to both views and immutable across intents & rematch', () => {
    const customConfig = config('draw-per-round');
    const created = createRoom(deps(1_000_000, 42), 'Host', customConfig);
    if ('error' in created) throw new Error(created.error);
    const joined = joinRoom(created.row, deps(1_000_000, 42), 'Guest');
    if ('error' in joined) throw new Error(joined.error);

    let row = joined.row;
    // Config visible in both views
    const viewA = buildPlayerView(row.room, 'A');
    const viewB = buildPlayerView(row.room, 'B');
    expect(viewA.config).toEqual(customConfig);
    expect(viewB.config).toEqual(customConfig);

    // Apply intents — config remains unchanged
    row = send(row, 'A', { type: 'draw' }, 42);
    row = send(row, 'B', { type: 'draw' }, 42);
    expect(row.room.config).toEqual(customConfig);

    // Rematch preserves the exact custom config
    row = send(row, 'A', { type: 'draw' }, 42);
    row = send(row, 'B', { type: 'draw' }, 42);
    row = send(row, 'A', { type: 'place', handIndex: 0, zone: 'cool' }, 42);
    row = send(row, 'A', { type: 'lock' }, 42);
    row = send(row, 'B', { type: 'place', handIndex: 0, zone: 'cool' }, 42);
    row = send(row, 'B', { type: 'lock' }, 42);
    row = send(row, 'A', { type: 'ready' }, 42);
    row = send(row, 'B', { type: 'ready' }, 42);
    // Round 2
    row = send(row, 'A', { type: 'draw' }, 42);
    row = send(row, 'A', { type: 'draw' }, 42);
    row = send(row, 'B', { type: 'draw' }, 42);
    row = send(row, 'B', { type: 'draw' }, 42);
    row = send(row, 'A', { type: 'place', handIndex: 1, zone: 'party' }, 42);
    row = send(row, 'A', { type: 'lock' }, 42);
    row = send(row, 'B', { type: 'place', handIndex: 1, zone: 'party' }, 42);
    row = send(row, 'B', { type: 'lock' }, 42);
    row = send(row, 'A', { type: 'ready' }, 42);
    row = send(row, 'B', { type: 'ready' }, 42);
    // Round 3
    row = send(row, 'A', { type: 'place', handIndex: 2, zone: 'energy' }, 42);
    row = send(row, 'A', { type: 'lock' }, 42);
    row = send(row, 'B', { type: 'place', handIndex: 2, zone: 'energy' }, 42);
    row = send(row, 'B', { type: 'lock' }, 42);
    expect(row.room.stage).toBe('complete');
    expect(row.room.config).toEqual(customConfig);

    // Agree rematch
    row = send(row, 'A', { type: 'rematch' }, 42);
    row = send(row, 'B', { type: 'rematch' }, 42);
    expect(row.room.stage).toBe('placing');
    expect(row.room.match.round).toBe(1);
    expect(row.room.config).toEqual(customConfig);
    expect(buildPlayerView(row.room, 'A').config).toEqual(customConfig);
    expect(buildPlayerView(row.room, 'B').config).toEqual(customConfig);
  });

  it('fixed power custom game runs through a full server match with exact powers', () => {
    const fixedConfig = config('reveal-all');
    const created = createRoom(deps(1_000_000, 11), 'Host', fixedConfig);
    if ('error' in created) throw new Error(created.error);
    const joined = joinRoom(created.row, deps(1_000_000, 11), 'Guest');
    if ('error' in joined) throw new Error(joined.error);

    let row = joined.row;
    // Verify initial dealt cards have exact fixed power configured
    const viewA = buildPlayerView(row.room, 'A');
    for (const card of viewA.hand) {
      expect(card.power).toBe(fixedConfig.fixedPower[card.flavor]);
    }
    const viewB = buildPlayerView(row.room, 'B');
    for (const card of viewB.hand) {
      expect(card.power).toBe(fixedConfig.fixedPower[card.flavor]);
    }

    // Play 3 rounds
    for (let r = 0; r < 3; r += 1) {
      row = send(row, 'A', { type: 'place', handIndex: r * 2, zone: 'cool' }, 11);
      row = send(row, 'A', { type: 'place', handIndex: r * 2 + 1, zone: 'party' }, 11);
      row = send(row, 'A', { type: 'lock' }, 11);
      row = send(row, 'B', { type: 'place', handIndex: r * 2, zone: 'cool' }, 11);
      row = send(row, 'B', { type: 'place', handIndex: r * 2 + 1, zone: 'party' }, 11);
      row = send(row, 'B', { type: 'lock' }, 11);
      if (r < 2) {
        row = send(row, 'A', { type: 'ready' }, 11);
        row = send(row, 'B', { type: 'ready' }, 11);
      }
    }
    expect(row.room.stage).toBe('complete');
    const finalA = buildPlayerView(row.room, 'A');
    expect(finalA.results).not.toBeNull();
    expect(finalA.winner).not.toBeUndefined();
  });

  it('GET /rooms/:code preview: open room, unknown, full, closed, CORS, exact key set', async () => {
    const worker = (await import('../../server/worker')).default;
    type WorkerEnv = Parameters<typeof worker.fetch>[1];
    const previewPayload = {
      open: true,
      config: config(),
      hostName: 'Alice',
    };
    let mode: 'open' | 'unknown' | 'full' | 'closed' = 'open';
    const stubFetch = async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/internal/preview')) {
        if (mode === 'open') return Response.json(previewPayload);
        if (mode === 'unknown') return new Response('not found', { status: 404 });
        if (mode === 'full') return Response.json({ error: 'full' }, { status: 404 });
        if (mode === 'closed') return Response.json({ error: 'closed' }, { status: 404 });
      }
      return new Response('not found', { status: 404 });
    };
    const fakeEnv = {
      ROOM: {
        idFromName: (name: string) => ({ name }),
        get: () => ({ fetch: stubFetch }),
      },
    } as unknown as WorkerEnv;

    // 1. Open room returns 200 with CORS and exact key set (no seat, token, hands, room state)
    mode = 'open';
    const resOpen = await worker.fetch(new Request('http://x/rooms/ABCDEF'), fakeEnv);
    expect(resOpen.status).toBe(200);
    expect(resOpen.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(resOpen.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    const openBody = (await resOpen.json()) as Record<string, unknown>;
    expect(openBody.open).toBe(true);
    expect(openBody.hostName).toBe('Alice');
    expect(openBody.config).toEqual(config());
    expect(Object.keys(openBody).sort()).toEqual(['config', 'hostName', 'open']);
    // Assert no hidden data leaked
    expect('token' in openBody).toBe(false);
    expect('seat' in openBody).toBe(false);
    expect('hands' in openBody).toBe(false);
    expect('room' in openBody).toBe(false);
    expect('roomState' in openBody).toBe(false);

    // Also supports /api/rooms/ABCDEF
    const resApi = await worker.fetch(new Request('http://x/api/rooms/ABCDEF'), fakeEnv);
    expect(resApi.status).toBe(200);

    // 2. 404 for unknown room with CORS
    mode = 'unknown';
    const resUnknown = await worker.fetch(new Request('http://x/rooms/ABCDEF'), fakeEnv);
    expect(resUnknown.status).toBe(404);
    expect(resUnknown.headers.get('Access-Control-Allow-Origin')).toBe('*');

    // 3. 404 for full room with CORS
    mode = 'full';
    const resFull = await worker.fetch(new Request('http://x/rooms/ABCDEF'), fakeEnv);
    expect(resFull.status).toBe(404);
    expect(resFull.headers.get('Access-Control-Allow-Origin')).toBe('*');

    // 4. 404 for closed room with CORS
    mode = 'closed';
    const resClosed = await worker.fetch(new Request('http://x/rooms/ABCDEF'), fakeEnv);
    expect(resClosed.status).toBe(404);
    expect(resClosed.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('match and timers do not start until joiner joins', () => {
    const created = createRoom(deps(1_000_000, 7), 'Host', config());
    if ('error' in created) throw new Error(created.error);

    // Match is created, but placement/draw deadlines are not started yet
    expect(created.row.room.deadlineMs).toBeNull();
    expect(created.row.room.placeMs).toBeNull();
    expect(created.row.room.drawMs).toBeNull();

    // nextDueMs only has idle cleanup, not match turn deadlines
    const dueBeforeJoin = nextDueMs(created.row.room, 1_000_000, { A: true, B: false });
    expect(dueBeforeJoin).toBe(1_000_000 + 3_600_000);

    // An alarm firing while waiting for an opponent does not time out or lock cards
    const alarmResult = onAlarm(
      created.row.room,
      { A: true, B: false },
      { now: 1_060_000, rng: Math.random }
    );
    expect(alarmResult.state.over).toBeNull();
    expect(alarmResult.events).toEqual([]);
    expect(alarmResult.state.deadlineMs).toBeNull();

    // Now seat B joins
    const joined = joinRoom(created.row, deps(1_000_000, 7), 'Guest');
    if ('error' in joined) throw new Error(joined.error);

    // Match timer is now active!
    expect(joined.row.room.placeMs).toBe(1_000_000 + 60_000);
    expect(joined.row.room.deadlineMs).toBe(1_000_000 + 60_000);
    const dueAfterJoin = nextDueMs(joined.row.room, 1_000_000, { A: true, B: true });
    expect(dueAfterJoin).toBe(1_000_000 + 60_000);
  });

  it('custom maxPlacedPerRound 3 runs through a full server match', () => {
    const customConfig: GameConfig = {
      ...config('reveal-all'),
      maxPlacedPerRound: 3,
    };
    const created = createRoom(deps(1_000_000, 23), 'Host', customConfig);
    if ('error' in created) throw new Error(created.error);
    const joined = joinRoom(created.row, deps(1_000_000, 23), 'Guest');
    if ('error' in joined) throw new Error(joined.error);

    let row = joined.row;
    expect(row.room.config.maxPlacedPerRound).toBe(3);

    // Round 1: place 1 card each
    row = send(row, 'A', { type: 'place', handIndex: 0, zone: 'cool' }, 23);
    row = send(row, 'A', { type: 'lock' }, 23);

    row = send(row, 'B', { type: 'place', handIndex: 0, zone: 'cool' }, 23);
    row = send(row, 'B', { type: 'lock' }, 23);

    expect(row.room.stage).toBe('roundReveal');
    row = send(row, 'A', { type: 'ready' }, 23);
    row = send(row, 'B', { type: 'ready' }, 23);

    // Round 2: place 3 cards each (testing maxPlacedPerRound: 3 works)
    expect(row.room.match.round).toBe(2);
    row = send(row, 'A', { type: 'place', handIndex: 1, zone: 'cool' }, 23);
    row = send(row, 'A', { type: 'place', handIndex: 2, zone: 'party' }, 23);
    row = send(row, 'A', { type: 'place', handIndex: 3, zone: 'energy' }, 23);
    // Placing a 4th card is rejected by the server
    const tooMany = applyClientIntent(row, deps(1_000_000, 23), 'A', {
      type: 'place',
      handIndex: 4,
      zone: 'cool',
    });
    if (tooMany.ok === true) throw new Error('expected reject on 4th placement');
    expect(tooMany.reason).toBe('Place at most 3 cards per round');
    row = send(row, 'A', { type: 'lock' }, 23);

    row = send(row, 'B', { type: 'place', handIndex: 1, zone: 'cool' }, 23);
    row = send(row, 'B', { type: 'place', handIndex: 2, zone: 'party' }, 23);
    row = send(row, 'B', { type: 'place', handIndex: 3, zone: 'energy' }, 23);
    row = send(row, 'B', { type: 'lock' }, 23);

    expect(row.room.stage).toBe('roundReveal');
    row = send(row, 'A', { type: 'ready' }, 23);
    row = send(row, 'B', { type: 'ready' }, 23);

    // Round 3: place remaining 2 cards each (hand indices 4, 5)
    expect(row.room.match.round).toBe(3);
    row = send(row, 'A', { type: 'place', handIndex: 4, zone: 'party' }, 23);
    row = send(row, 'A', { type: 'place', handIndex: 5, zone: 'energy' }, 23);
    row = send(row, 'A', { type: 'lock' }, 23);

    row = send(row, 'B', { type: 'place', handIndex: 4, zone: 'party' }, 23);
    row = send(row, 'B', { type: 'place', handIndex: 5, zone: 'energy' }, 23);
    row = send(row, 'B', { type: 'lock' }, 23);

    expect(row.room.stage).toBe('complete');
    const finalA = buildPlayerView(row.room, 'A');
    expect(finalA.results).not.toBeNull();
    expect(finalA.winner).not.toBeUndefined();
  });

  it('deck pool too small (2 flavors) is rejected by validateGameConfig with cannot-finish', () => {
    // 2 flavors is below the minimum 3; createRoom must reject before the engine runs.
    const tinyConfig: GameConfig = {
      mode: 'custom',
      deck: { kind: 'custom', flavors: ['v-cola', 'v-diet-cola'] },
      dealing: 'draw-per-round',
      drawPerRound: 1,
      maxPlacedPerRound: 1,
      power: 'random',
      fixedPower: {},
      effectsEnabled: true,
    };
    const result = createRoom(deps(), 'Host', tinyConfig);
    expect(result).toEqual({ error: 'cannot-finish' });
  });

  it('minimum valid pool (3 flavors, draw-per-round=1) runs to completion', () => {
    // 3 flavors with 1 draw/round: each player draws 1 card per round for 3 rounds.
    // Pool of 3 is exactly consumed; match must reach stage=complete.
    const minConfig: GameConfig = {
      mode: 'custom',
      deck: { kind: 'custom', flavors: ['v-cola', 'v-diet-cola', 'cream-soda'] },
      dealing: 'draw-per-round',
      drawPerRound: 1,
      maxPlacedPerRound: 1,
      power: 'random',
      fixedPower: {},
      effectsEnabled: true,
    };
    const created = createRoom(deps(1_000_000, 5), 'Host', minConfig);
    if ('error' in created) throw new Error(created.error);
    const joined = joinRoom(created.row, deps(1_000_000, 5), 'Guest');
    if ('error' in joined) throw new Error(joined.error);

    let row = joined.row;
    for (let r = 0; r < 3; r += 1) {
      // Each player draws 1 card per round; new card arrives at index r
      row = send(row, 'A', { type: 'draw' }, 5);
      row = send(row, 'B', { type: 'draw' }, 5);
      // Place the freshly drawn card (index r, since prior draws are already placed)
      row = send(row, 'A', { type: 'place', handIndex: r, zone: 'cool' }, 5);
      row = send(row, 'A', { type: 'lock' }, 5);
      row = send(row, 'B', { type: 'place', handIndex: r, zone: 'cool' }, 5);
      row = send(row, 'B', { type: 'lock' }, 5);
      if (r < 2) {
        row = send(row, 'A', { type: 'ready' }, 5);
        row = send(row, 'B', { type: 'ready' }, 5);
      }
    }
    expect(row.room.stage).toBe('complete');
    const final = buildPlayerView(row.room, 'A');
    expect(final.results).not.toBeNull();
  });

  it('effectsEnabled:false full match runs to completion without applying effects', () => {
    const noFxConfig: GameConfig = {
      ...config('reveal-all'),
      effectsEnabled: false,
    };
    const created = createRoom(deps(1_000_000, 33), 'Host', noFxConfig);
    if ('error' in created) throw new Error(created.error);
    const joined = joinRoom(created.row, deps(1_000_000, 33), 'Guest');
    if ('error' in joined) throw new Error(joined.error);

    let row = joined.row;
    expect(row.room.config.effectsEnabled).toBe(false);

    // 3 rounds of placing 1 card each
    for (let r = 0; r < 3; r += 1) {
      row = send(row, 'A', { type: 'place', handIndex: r, zone: 'cool' }, 33);
      row = send(row, 'A', { type: 'lock' }, 33);
      row = send(row, 'B', { type: 'place', handIndex: r, zone: 'cool' }, 33);
      row = send(row, 'B', { type: 'lock' }, 33);
      if (r < 2) {
        row = send(row, 'A', { type: 'ready' }, 33);
        row = send(row, 'B', { type: 'ready' }, 33);
      }
    }
    expect(row.room.stage).toBe('complete');
    const final = buildPlayerView(row.room, 'A');
    expect(final.results).not.toBeNull();
    expect(final.winner).not.toBeUndefined();
    // Config preserved with effects disabled
    expect(final.config.effectsEnabled).toBe(false);
  });

  it('hidden info: opponent count/zones/recall invisible pre-reveal (both seats, both rounds)', () => {
    const hiddenConfig: GameConfig = { ...config(), maxPlacedPerRound: 3 };
    const mk = (): RoomRow => {
      const created = createRoom(deps(1_000_000, 7), 'Host', hiddenConfig);
      if ('error' in created) throw new Error(created.error);
      const joined = joinRoom(created.row, deps(1_000_000, 7), 'Guest');
      if ('error' in joined) throw new Error(joined.error);
      return joined.row;
    };
    type Run = (row: RoomRow, seat: Player, base: number) => RoomRow;
    const variants: Array<[string, Run, number]> = [
      ['none', (r) => r, 0],
      ['one', (r, seat, b) => send(r, seat, { type: 'place', handIndex: b, zone: 'cool' }), 1],
      [
        'three',
        (r, seat, b) => {
          let next = send(r, seat, { type: 'place', handIndex: b, zone: 'party' });
          next = send(next, seat, { type: 'place', handIndex: b + 1, zone: 'energy' });
          return send(next, seat, { type: 'place', handIndex: b + 2, zone: 'party' });
        },
        3,
      ],
      [
        'recall',
        (r, seat, b) => {
          let next = send(r, seat, { type: 'place', handIndex: b, zone: 'energy' });
          next = send(next, seat, { type: 'place', handIndex: b + 1, zone: 'party' });
          next = send(next, seat, { type: 'unplace', handIndex: b });
          return send(next, seat, { type: 'unplace', handIndex: b + 1 });
        },
        0,
      ],
    ];
    for (const viewer of ['A', 'B'] as const) {
      const opponent: Player = viewer === 'A' ? 'B' : 'A';
      for (const round of [1, 2] as const) {
        const own = round === 1 ? 0 : 1;
        const base = round === 1 ? 0 : 1;
        const snapshots = variants.map(([name, run]) => {
          let row = mk();
          if (round === 2) {
            row = send(row, 'A', { type: 'place', handIndex: 0, zone: 'cool' });
            row = send(row, 'A', { type: 'lock' });
            row = send(row, 'B', { type: 'place', handIndex: 0, zone: 'cool' });
            row = send(row, 'B', { type: 'lock' });
            row = send(row, 'A', { type: 'ready' });
            row = send(row, 'B', { type: 'ready' });
          }
          row = send(row, viewer, { type: 'place', handIndex: own, zone: 'cool' });
          row = run(row, opponent, base);
          return { name, json: JSON.stringify(buildPlayerView(row.room, viewer)) };
        });
        const first = snapshots[0]?.json ?? '';
        for (const { name, json } of snapshots) {
          expect(json, `${viewer} round ${round} variant ${name}`).toBe(first);
        }
        for (const { name, json } of snapshots) {
          const parsed = JSON.parse(json) as ReturnType<typeof buildPlayerView>;
          const ref = JSON.parse(first) as ReturnType<typeof buildPlayerView>;
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
          const past = JSON.parse(first) as ReturnType<typeof buildPlayerView>;
          const revealed = past.boards[0];
          expect(revealed?.kind).toBe('revealed');
          if (revealed?.kind === 'revealed') {
            expect(revealed.zones['cool']?.foe.length).toBe(1);
          }
        }
        // Reveal: the opponent's cards ARE present with the variant's count.
        variants.forEach(([vname, run, expected]) => {
          if (expected === 0) return;
          let row = mk();
          if (round === 2) {
            row = send(row, 'A', { type: 'place', handIndex: 0, zone: 'cool' });
            row = send(row, 'A', { type: 'lock' });
            row = send(row, 'B', { type: 'place', handIndex: 0, zone: 'cool' });
            row = send(row, 'B', { type: 'lock' });
            row = send(row, 'A', { type: 'ready' });
            row = send(row, 'B', { type: 'ready' });
          }
          row = send(row, viewer, { type: 'place', handIndex: own, zone: 'cool' });
          row = send(row, viewer, { type: 'lock' });
          row = run(row, opponent, base);
          row = send(row, opponent, { type: 'lock' });
          expect(row.room.stage).toBe('roundReveal');
          const view = buildPlayerView(row.room, viewer);
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

  it('hidden info: draw-per-round draws leave no per-opponent trace in the view', () => {
    const drawConfig: GameConfig = {
      ...config('draw-per-round'),
      maxPlacedPerRound: 2,
    };
    const mk = (): RoomRow => {
      const created = createRoom(deps(1_000_000, 9), 'Host', drawConfig);
      if ('error' in created) throw new Error(created.error);
      const joined = joinRoom(created.row, deps(1_000_000, 9), 'Guest');
      if ('error' in joined) throw new Error(joined.error);
      return joined.row;
    };
    // Same draws both sides; B then varies 0 / 1 / place-then-recall.
    const runs: Array<[string, (row: RoomRow) => RoomRow]> = [
      ['none', (r) => r],
      ['one', (r) => send(r, 'B', { type: 'place', handIndex: 0, zone: 'cool' }, 9)],
      [
        'recall',
        (r) =>
          send(
            send(r, 'B', { type: 'place', handIndex: 0, zone: 'energy' }, 9),
            'B',
            { type: 'unplace', handIndex: 0 },
            9
          ),
      ],
    ];
    const snapshots = runs.map(([name, run]) => {
      let row = mk();
      row = send(row, 'A', { type: 'draw' }, 9);
      row = send(row, 'A', { type: 'draw' }, 9);
      row = send(row, 'B', { type: 'draw' }, 9);
      row = send(row, 'B', { type: 'draw' }, 9);
      row = send(row, 'A', { type: 'place', handIndex: 0, zone: 'cool' }, 9);
      row = run(row);
      return { name, json: JSON.stringify(buildPlayerView(row.room, 'A')) };
    });
    const first = snapshots[0]?.json ?? '';
    for (const { name, json } of snapshots) {
      expect(json, `draw variant ${name}`).toBe(first);
    }
    const ref = JSON.parse(first) as ReturnType<typeof buildPlayerView>;
    expect(typeof ref.opponentHandCount).toBe('number');
    expect(typeof ref.drawsRemaining).toBe('number');
    expect(typeof ref.drawPileCount).toBe('number');
    expect(ref.deadlineMs).not.toBeNull();
  });

  it('view envelope carries sanitized names for both seats', async () => {
    const { viewEnvelope } = await import('../../server/roomLogic');
    const { sanitizePlayerName } = await import('../../server/protocol');
    // Sanitization matrix (amendment 3).
    expect(sanitizePlayerName('  Alice  ', 'Player A')).toBe('Alice');
    expect(sanitizePlayerName('', 'Player A')).toBe('Player A');
    expect(sanitizePlayerName('   ', 'Player B')).toBe('Player B');
    expect(sanitizePlayerName('a\nb\rc\td', 'Player A')).toBe('abcd');
    expect(sanitizePlayerName('x\u200By\u200Fz\uFEFFend', 'Player A')).toBe('xyzend');
    expect(sanitizePlayerName('Evil\u202Eolleh', 'Player A')).toBe('Evilolleh');
    expect(sanitizePlayerName('a'.repeat(25), 'Player A')).toBe('a'.repeat(20));
    // Emoji counts as one code point: 19 chars + emoji fits, 20 chars + emoji cuts.
    expect(Array.from(sanitizePlayerName(`${'a'.repeat(19)}🎉`, 'P')).length).toBe(20);
    expect(sanitizePlayerName(`${'a'.repeat(20)}🎉`, 'P')).toBe('a'.repeat(20));
    // Arabic letters pass through intact.
    expect(sanitizePlayerName('  عبدالله  ', 'Player A')).toBe('عبدالله');
    expect(sanitizePlayerName(123, 'Player B')).toBe('Player B');
    // Both seats get both names.
    const created = createRoom(deps(), '  Alice\n ', config());
    if ('error' in created) throw new Error(created.error);
    const joined = joinRoom(created.row, deps(), 'Bob\u202E');
    if ('error' in joined) throw new Error(joined.error);
    expect(joined.row.names).toEqual({ A: 'Alice', B: 'Bob' });
    const envA = viewEnvelope(
      joined.row.room,
      'A',
      { A: true, B: true },
      1_000_000,
      joined.row.names
    );
    expect(envA.names).toEqual({ me: 'Alice', opponent: 'Bob' });
    const envB = viewEnvelope(
      joined.row.room,
      'B',
      { A: true, B: true },
      1_000_000,
      joined.row.names
    );
    expect(envB.names).toEqual({ me: 'Bob', opponent: 'Alice' });
    // Reload/resume: a fresh envelope from persisted state keeps the names.
    const reloaded = JSON.parse(JSON.stringify(joined.row)) as RoomRow;
    const again = viewEnvelope(
      reloaded.room,
      'A',
      { A: true, B: false },
      1_000_001,
      reloaded.names
    );
    expect(again.names).toEqual({ me: 'Alice', opponent: 'Bob' });
    // Pre-join (B null) falls back.
    const pre = viewEnvelope(
      created.row.room,
      'A',
      { A: true, B: false },
      1_000_000,
      created.row.names
    );
    expect(pre.names).toEqual({ me: 'Alice', opponent: 'Player B' });
  });

  it('ready flags ride the view per seat and survive reload while waiting', () => {
    let row = startRow();
    row = send(row, 'A', { type: 'place', handIndex: 0, zone: 'cool' });
    row = send(row, 'A', { type: 'lock' });
    // Locked-waiting: A latched, B still placing.
    expect(buildPlayerView(row.room, 'A').locks).toEqual({ A: true, B: false });
    expect(buildPlayerView(row.room, 'B').locks).toEqual({ A: true, B: false });
    row = send(row, 'B', { type: 'place', handIndex: 0, zone: 'cool' });
    row = send(row, 'B', { type: 'lock' });
    expect(row.room.stage).toBe('roundReveal');
    // Locked-waiting state: A locked while B pending; reveal resets locks.
    expect(buildPlayerView(row.room, 'A').ready).toEqual({ me: false, opponent: false });
    // Ready-waiting: A ready, B pending — mirrored per seat.
    row = send(row, 'A', { type: 'ready' });
    expect(row.room.stage).toBe('roundReveal');
    expect(buildPlayerView(row.room, 'A').ready).toEqual({ me: true, opponent: false });
    expect(buildPlayerView(row.room, 'B').ready).toEqual({ me: false, opponent: true });
    // Reload while waiting: a fresh view from persisted state keeps the flags.
    const reloaded = JSON.parse(JSON.stringify(row)) as RoomRow;
    expect(buildPlayerView(reloaded.room, 'A').ready).toEqual({ me: true, opponent: false });
    expect(buildPlayerView(reloaded.room, 'B').ready).toEqual({ me: false, opponent: true });
    row = send(row, 'B', { type: 'ready' });
    expect(row.room.stage).toBe('placing');
  });

  it('empty hand auto-locks; both empty reveals immediately (small + large maxPlaced)', () => {
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
    const mkTiny = (): RoomRow => {
      const created = createRoom(deps(1_000_000, 7), 'Host', tiny);
      if ('error' in created) throw new Error(created.error);
      const joined = joinRoom(created.row, deps(1_000_000, 7), 'Guest');
      if ('error' in joined) throw new Error(joined.error);
      return joined.row;
    };
    // Round 1 spends everything (3 of 3 each).
    let row = mkTiny();
    for (const seat of ['A', 'B'] as const) {
      row = send(row, seat, { type: 'place', handIndex: 0, zone: 'cool' });
      row = send(row, seat, { type: 'place', handIndex: 1, zone: 'party' });
      row = send(row, seat, { type: 'place', handIndex: 2, zone: 'energy' });
      row = send(row, seat, { type: 'lock' });
    }
    expect(row.room.stage).toBe('roundReveal');
    // Advancing with both hands empty auto-locks both and reveals round 2
    // with ZERO place/lock intents — no timer wait involved.
    row = send(row, 'A', { type: 'ready' });
    row = send(row, 'B', { type: 'ready' });
    expect(row.room.match.round).toBe(3);
    expect(row.room.stage).toBe('roundReveal');
    expect(buildPlayerView(row.room, 'A').locks).toEqual({ A: false, B: false });
    // Round 3 is empty too: both ready auto-completes the match.
    row = send(row, 'A', { type: 'ready' });
    row = send(row, 'B', { type: 'ready' });
    expect(row.room.stage).toBe('complete');
    expect(buildPlayerView(row.room, 'A').results).not.toBeNull();

    // Large maxPlacedPerRound (6): one round also spends a full 6-card hand.
    const big: GameConfig = { ...config(), maxPlacedPerRound: 6 };
    const mkBig = (): RoomRow => {
      const created = createRoom(deps(1_000_000, 7), 'Host', big);
      if ('error' in created) throw new Error(created.error);
      const joined = joinRoom(created.row, deps(1_000_000, 7), 'Guest');
      if ('error' in joined) throw new Error(joined.error);
      return joined.row;
    };
    let bigRow = mkBig();
    for (const idx of [0, 1, 2, 3, 4, 5]) {
      bigRow = send(bigRow, 'A', { type: 'place', handIndex: idx, zone: 'cool' });
    }
    bigRow = send(bigRow, 'A', { type: 'lock' });
    bigRow = send(bigRow, 'B', { type: 'place', handIndex: 0, zone: 'cool' });
    bigRow = send(bigRow, 'B', { type: 'lock' });
    bigRow = send(bigRow, 'A', { type: 'ready' });
    bigRow = send(bigRow, 'B', { type: 'ready' });
    // A is empty in round 2 (auto-locked, no intent); B plays on normally.
    expect(bigRow.room.stage).toBe('placing');
    expect(bigRow.room.match.locks.A).toBe(true);
    expect(bigRow.room.match.locks.B).toBe(false);
    bigRow = send(bigRow, 'B', { type: 'place', handIndex: 1, zone: 'party' });
    bigRow = send(bigRow, 'B', { type: 'lock' });
    expect(bigRow.room.stage).toBe('roundReveal');
  });
});

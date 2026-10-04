import { describe, expect, it, vi, afterEach } from 'vitest';
import type { PlayerView } from '../game/controller';
import { DEFAULT_GAME_CONFIG } from '../game/config';
import { backoffForAttempt } from './socket';
import { OnlineController, RETRY_BUDGET_MS, type OnlineMeta } from './onlineController';
import { parseSession } from './sessionStore';
import { createOnlineRoom, joinOnlineRoom, serverBaseUrl, wsUrl } from './http';

class FakeClock {
  nowMs = 1_000_000;
  private timers = new Map<number, { at: number; cb: () => void }>();
  private nextId = 1;
  now = () => this.nowMs;
  setTimeout = (cb: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowMs + ms, cb });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  clearTimeout = (id: ReturnType<typeof setTimeout>) => {
    this.timers.delete(id as unknown as number);
  };
  pendingDelays(): number[] {
    return [...this.timers.values()].map((t) => t.at - this.nowMs).sort((a, b) => a - b);
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

interface FakeSocket {
  sent: string[];
  open(): void;
  message(text: string): void;
  close(code: number): void;
}

function fakeFactory(sockets: FakeSocket[]) {
  return (
    _url: string,
    events: { onOpen(): void; onMessage(t: string): void; onClose(c: number): void }
  ) => {
    const socket: FakeSocket & { events: typeof events } = {
      sent: [],
      events,
      open: () => events.onOpen(),
      message: (text: string) => events.onMessage(text),
      close: (code: number) => events.onClose(code),
    };
    sockets.push(socket);
    return {
      send: (text: string) => {
        socket.sent.push(text);
      },
      close: () => {},
    };
  };
}

const emptyView: PlayerView = {
  seat: 'A',
  phase: 'placing',
  round: 1,
  config: DEFAULT_GAME_CONFIG,
  hand: [],
  boards: [],
  locks: { A: false, B: false },
  ready: { me: false, opponent: false },
  opponentHandCount: 0,
  deadlineMs: null,
  drawsRemaining: 0,
  results: null,
  winner: null,
  explanations: null,
};

function viewFrame(
  view: Partial<PlayerView>,
  serverNowMs: number,
  opponentConnected: boolean
): string {
  return JSON.stringify({
    type: 'view',
    view: { ...emptyView, ...view },
    serverNowMs,
    opponentConnected,
    readyDeadlineMs: null,
  });
}

describe('onlineController', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('backoff schedule caps at 5s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(backoffForAttempt)).toEqual([
      250, 500, 1000, 2000, 4000, 5000, 5000, 5000,
    ]);
  });

  it('resumes with the token after a drop', () => {
    const clock = new FakeClock();
    const sockets: FakeSocket[] = [];
    const gone: string[] = [];
    const controller = new OnlineController('A', 'ABCDEF', 'tok', 'http://x', {
      clock,
      openSocket: fakeFactory(sockets),
      onSessionGone: () => gone.push('gone'),
    });
    const metas: string[] = [];
    controller.onConnection((m) => metas.push(m.connection));
    controller.connect();
    expect(sockets.length).toBe(1);
    sockets[0]?.open();
    expect(sockets[0]?.sent).toEqual([JSON.stringify({ type: 'resume', token: 'tok' })]);
    sockets[0]?.message(viewFrame({}, clock.now(), true));
    sockets[0]?.close(1006);
    clock.advance(300);
    expect(sockets.length).toBe(2);
    sockets[1]?.open();
    expect(sockets[1]?.sent).toEqual([JSON.stringify({ type: 'resume', token: 'tok' })]);
    expect(gone).toEqual([]);
    controller.dispose();
  });

  it('corrects clock skew from serverNowMs', () => {
    const clock = new FakeClock();
    const sockets: FakeSocket[] = [];
    const controller = new OnlineController('A', 'ABCDEF', 'tok', 'http://x', {
      clock,
      openSocket: fakeFactory(sockets),
    });
    controller.connect();
    sockets[0]?.open();
    sockets[0]?.message(viewFrame({}, clock.now() + 5000, true));
    expect(controller.serverNowMs()).toBe(clock.now() + 5000);
    controller.dispose();
  });

  it('routes rejected to onReject and closed stops reconnecting', () => {
    const clock = new FakeClock();
    const sockets: FakeSocket[] = [];
    const gone: string[] = [];
    const controller = new OnlineController('A', 'ABCDEF', 'tok', 'http://x', {
      clock,
      openSocket: fakeFactory(sockets),
      onSessionGone: () => gone.push('gone'),
    });
    const rejects: string[] = [];
    controller.onReject((r) => rejects.push(r));
    const metas: string[] = [];
    controller.onConnection((m) => metas.push(m.connection));
    controller.connect();
    sockets[0]?.open();
    sockets[0]?.message(viewFrame({}, clock.now(), true));
    sockets[0]?.message(JSON.stringify({ type: 'rejected', reason: 'malformed' }));
    expect(rejects).toEqual(['malformed']);
    sockets[0]?.message(JSON.stringify({ type: 'closed', reason: 'forfeit' }));
    expect(metas[metas.length - 1]).toBe('closed');
    expect(gone).toEqual(['gone']);
    const count = sockets.length;
    clock.advance(60_000);
    expect(sockets.length).toBe(count);
    controller.dispose();
  });

  it('gives up after ~60s of failed retries with Retry to recover', () => {
    const clock = new FakeClock();
    const sockets: FakeSocket[] = [];
    const controller = new OnlineController('A', 'ABCDEF', 'tok', 'http://x', {
      clock,
      openSocket: fakeFactory(sockets),
    });
    const metas: string[] = [];
    controller.onConnection((m) => metas.push(m.connection));
    controller.connect();
    // Never opens: repeated handshake failures.
    for (let i = 0; i < 12; i += 1) {
      const last = sockets[sockets.length - 1];
      last?.close(1006);
      clock.advance(6_000);
    }
    expect(clock.now() - 1_000_000).toBeGreaterThanOrEqual(RETRY_BUDGET_MS);
    expect(metas).toContain('unreachable');
    const count = sockets.length;
    clock.advance(30_000);
    expect(sockets.length).toBe(count);
    controller.retry();
    expect(sockets.length).toBe(count + 1);
    expect(metas[metas.length - 1]).toBe('connecting');
    controller.dispose();
  });

  it('waiting vs opponent-disconnected follows presence, not timers', () => {
    const clock = new FakeClock();
    const sockets: FakeSocket[] = [];
    const controller = new OnlineController('A', 'ABCDEF', 'tok', 'http://x', {
      clock,
      openSocket: fakeFactory(sockets),
    });
    const metas: string[] = [];
    controller.onConnection((m) => metas.push(m.connection));
    controller.connect();
    sockets[0]?.open();
    sockets[0]?.message(viewFrame({}, clock.now(), false));
    expect(metas[metas.length - 1]).toBe('waiting-for-opponent');
    sockets[0]?.message(
      viewFrame(
        {
          boards: [
            {
              kind: 'current',
              zones: {
                cool: {
                  mine: [{ handIndex: 0, flavor: 'v-cola', power: 4, loaner: true }],
                },
              },
            },
          ],
        },
        clock.now(),
        false
      )
    );
    expect(metas[metas.length - 1]).toBe('opponent-disconnected');
    sockets[0]?.message(viewFrame({}, clock.now(), true));
    expect(metas[metas.length - 1]).toBe('live');
    controller.dispose();
  });

  it('send without an open socket rejects instead of throwing', () => {
    const clock = new FakeClock();
    const sockets: FakeSocket[] = [];
    const controller = new OnlineController('A', 'ABCDEF', 'tok', 'http://x', {
      clock,
      openSocket: fakeFactory(sockets),
    });
    const rejects: string[] = [];
    controller.onReject((r) => rejects.push(r));
    controller.connect();
    controller.send({ type: 'lock' });
    expect(rejects).toEqual(['not-connected']);
    controller.dispose();
  });

  it('parses envelope names; old servers without names keep prior names', () => {
    const clock = new FakeClock();
    const sockets: FakeSocket[] = [];
    const controller = new OnlineController('A', 'ABCDEF', 'tok', 'http://x', {
      clock,
      openSocket: fakeFactory(sockets),
    });
    const metas: OnlineMeta[] = [];
    controller.onConnection((m) => metas.push(m));
    controller.connect();
    sockets[0]?.open();
    expect(metas[metas.length - 1]?.names).toEqual({ me: '', opponent: '' });
    sockets[0]?.message(
      JSON.stringify({
        type: 'view',
        view: { ...emptyView },
        serverNowMs: clock.now(),
        opponentConnected: true,
        readyDeadlineMs: null,
        names: { me: 'Alice', opponent: 'Bob' },
      })
    );
    expect(metas[metas.length - 1]?.names).toEqual({ me: 'Alice', opponent: 'Bob' });
    // Old server without names: keep the previous names, stay fresh.
    sockets[0]?.message(viewFrame({}, clock.now(), true));
    expect(metas[metas.length - 1]?.names).toEqual({ me: 'Alice', opponent: 'Bob' });
    expect(metas[metas.length - 1]?.needsRefresh).toBe(false);
    controller.dispose();
  });

  it('unrecognized view shape latches needsRefresh and emits no view', () => {
    const clock = new FakeClock();
    const sockets: FakeSocket[] = [];
    const controller = new OnlineController('A', 'ABCDEF', 'tok', 'http://x', {
      clock,
      openSocket: fakeFactory(sockets),
    });
    const views: PlayerView[] = [];
    controller.subscribe((v) => views.push(v));
    const metas: OnlineMeta[] = [];
    controller.onConnection((m) => metas.push(m));
    controller.connect();
    sockets[0]?.open();
    sockets[0]?.message(
      JSON.stringify({ type: 'view', view: { bogus: 1 }, serverNowMs: clock.now() })
    );
    expect(views).toEqual([]);
    expect(metas[metas.length - 1]?.needsRefresh).toBe(true);
    controller.dispose();
  });
});

describe('sessionStore', () => {
  it('validates stored sessions', () => {
    expect(parseSession({ code: 'ABCDEF', token: 't', seat: 'A' })).toEqual({
      code: 'ABCDEF',
      token: 't',
      seat: 'A',
    });
    expect(parseSession(null)).toBeNull();
    expect(parseSession({ code: 'ABC', token: 't', seat: 'A' })).toBeNull();
    expect(parseSession({ code: 'ABCDEF', token: 't', seat: 'C' })).toBeNull();
    expect(parseSession({ code: 'ABCDEF', token: 't', seat: 'A', extra: 1 })).toEqual({
      code: 'ABCDEF',
      token: 't',
      seat: 'A',
    });
  });
});

describe('online http', () => {
  it('maps failures to busy/unreachable/gone/full', async () => {
    expect(serverBaseUrl('http://x:8787/')).toBe('http://x:8787');
    expect(serverBaseUrl(undefined)).toBe('http://localhost:8787');
    expect(wsUrl('http://localhost:8787', 'ROOM12', 'A')).toBe(
      'ws://localhost:8787/api/rooms/ROOM12/ws?seat=A'
    );
    expect(wsUrl('https://example.com', 'ROOM12', 'B')).toBe(
      'wss://example.com/api/rooms/ROOM12/ws?seat=B'
    );
    vi.stubGlobal('window', {
      location: { hostname: 'v-cola.pages.dev', host: 'v-cola.pages.dev', protocol: 'https:' },
    });
    expect(serverBaseUrl(undefined)).toBe('');
    expect(wsUrl('', 'ROOM12', 'A')).toBe('wss://v-cola.pages.dev/api/rooms/ROOM12/ws?seat=A');
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      })
    );
    await expect(createOnlineRoom('http://x', 'Al')).rejects.toMatchObject({
      failure: { kind: 'unreachable' },
    });
    const failing = (status: number, body: unknown) =>
      vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', failing(500, {}));
    await expect(createOnlineRoom('http://x', 'Al')).rejects.toMatchObject({
      failure: { kind: 'busy' },
    });
    vi.stubGlobal('fetch', failing(404, { error: 'gone' }));
    await expect(joinOnlineRoom('http://x', 'ABCDEF', 'Bo')).rejects.toMatchObject({
      failure: { kind: 'gone' },
    });
    vi.stubGlobal('fetch', failing(409, { error: 'full' }));
    await expect(joinOnlineRoom('http://x', 'ABCDEF', 'Bo')).rejects.toMatchObject({
      failure: { kind: 'full' },
    });
    vi.stubGlobal(
      'fetch',
      failing(200, { code: 'ABCDEF', token: 't', seat: 'A' } as unknown as Record<string, unknown>)
    );
    await expect(createOnlineRoom('http://x', 'Al')).resolves.toEqual({
      code: 'ABCDEF',
      token: 't',
      seat: 'A',
    });
  });

  it('join-after-preview: gone and full map to OnlineHttpError that onlineRoomGone covers', async () => {
    // previewOnlineRoom: 404 → gone
    const failing404 = vi.fn(
      async () => new Response(JSON.stringify({ error: 'gone' }), { status: 404 })
    );
    vi.stubGlobal('fetch', failing404);
    await expect(
      (await import('./http')).previewOnlineRoom('http://x', 'ABCDEF')
    ).rejects.toMatchObject({ failure: { kind: 'gone' } });

    // joinOnlineRoom: 404 → gone (room disappeared between preview and join)
    const failing404join = vi.fn(
      async () => new Response(JSON.stringify({ error: 'gone' }), { status: 404 })
    );
    vi.stubGlobal('fetch', failing404join);
    await expect(
      (await import('./http')).joinOnlineRoom('http://x', 'ABCDEF', 'Bob')
    ).rejects.toMatchObject({ failure: { kind: 'gone' } });

    // joinOnlineRoom: 409 → full (room became full after the joiner previewed)
    const failing409 = vi.fn(
      async () => new Response(JSON.stringify({ error: 'full' }), { status: 409 })
    );
    vi.stubGlobal('fetch', failing409);
    await expect(
      (await import('./http')).joinOnlineRoom('http://x', 'ABCDEF', 'Bob')
    ).rejects.toMatchObject({ failure: { kind: 'full' } });
  });
});

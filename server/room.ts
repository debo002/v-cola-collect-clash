import { DurableObject } from 'cloudflare:workers';
import type { Player } from '../src/game/match';
import { isIdleCleanupDue, nextDueMs, onAlarm, touchSeen } from '../src/game/matchEngine';
import { parseClientMessage, type ServerMsg } from './protocol';
import { applyClientIntent, joinRoom, resumeSeat, viewEnvelope, type RoomRow } from './roomLogic';

/**
 * One SQLite-backed Durable Object per room. Thin glue over the shared
 * engine: hibernatable WebSockets (acceptWebSocket + tags per seat),
 * one persisted row per accepted intent, a single alarm for the earliest
 * persisted deadline. In-memory state (sockets map) is never trusted —
 * the DO can hibernate between any two messages.
 */

interface Attachment {
  seat: Player;
  authed: boolean;
  connectedAt: number;
}

const UNAUTHED_GRACE_MS = 30_000;

function attachmentOf(ws: WebSocket): Attachment | null {
  try {
    const att = (ws as WebSocket & { deserializeAttachment(): unknown }).deserializeAttachment();
    if (att === null || typeof att !== 'object') return null;
    const rec = att as Record<string, unknown>;
    if ((rec.seat === 'A' || rec.seat === 'B') && typeof rec.authed === 'boolean') {
      return {
        seat: rec.seat,
        authed: rec.authed,
        connectedAt: typeof rec.connectedAt === 'number' ? rec.connectedAt : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export class Room extends DurableObject {
  /**
   * Last serialized view-frame per socket. A seat gets a new `view` frame
   * only when its serialized view (or presence/ready extras) changed, so
   * frame timing reveals nothing about the opponent's activity. serverNowMs
   * is deliberately excluded from the comparison (it changes every send).
   */
  private readonly lastSent = new WeakMap<object, string>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/internal/exists')) {
      const row = await this.ctx.storage.get<RoomRow>('row');
      return Response.json({ exists: row !== undefined });
    }
    if (url.pathname.endsWith('/internal/preview')) {
      const row = await this.ctx.storage.get<RoomRow>('row');
      if (row === undefined || row.room.over !== null || row.tokens.B !== null) {
        return Response.json({ error: 'gone' }, { status: 404 });
      }
      return Response.json({
        open: true,
        config: row.room.config,
        hostName: row.names.A,
      });
    }
    if (url.pathname.endsWith('/internal/init') && request.method === 'POST') {
      const existing = await this.ctx.storage.get<RoomRow>('row');
      if (existing !== undefined) return Response.json({ error: 'exists' }, { status: 409 });
      const row = (await request.json()) as RoomRow;
      await this.ctx.storage.put<RoomRow>('row', row);
      return Response.json({ ok: true });
    }
    if (url.pathname.endsWith('/internal/join') && request.method === 'POST') {
      const row = await this.ctx.storage.get<RoomRow>('row');
      if (row === undefined) return Response.json({ error: 'gone' }, { status: 404 });
      const body = (await request.json()) as { name?: unknown };
      const joined = joinRoom(row, { now: () => Date.now(), rng: Math.random }, body.name);
      if ('error' in joined) {
        const status =
          joined.error === 'gone' || joined.error === 'closed'
            ? 404
            : joined.error === 'full'
              ? 409
              : 400;
        return Response.json({ error: joined.error }, { status });
      }
      await this.ctx.storage.put<RoomRow>('row', joined.row);
      return Response.json({ token: joined.token, seat: 'B' });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const seatParam = url.searchParams.get('seat');
    if (seatParam !== 'A' && seatParam !== 'B') {
      return new Response('missing seat', { status: 400 });
    }
    const row = await this.ctx.storage.get<RoomRow>('row');
    if (row === undefined) return new Response('gone', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (server === undefined || client === undefined)
      return new Response('failed', { status: 500 });
    this.ctx.acceptWebSocket(server, [seatParam]);
    (server as WebSocket & { serializeAttachment(v: unknown): void }).serializeAttachment({
      seat: seatParam,
      authed: false,
      connectedAt: Date.now(),
    } satisfies Attachment);
    await this.ensureAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const att = attachmentOf(ws);
    if (att === null) {
      this.safeClose(ws, 4401, 'gone');
      return;
    }
    const row = await this.ctx.storage.get<RoomRow>('row');
    if (row === undefined) {
      this.send(ws, { type: 'closed', reason: 'gone' });
      this.safeClose(ws, 4400, 'gone');
      return;
    }
    const parsed = parseClientMessage(typeof message === 'string' ? message : '[binary]');
    if (!att.authed) {
      if (!parsed.ok || parsed.msg.type !== 'resume') {
        this.send(ws, { type: 'rejected', reason: 'malformed' });
        return;
      }
      const seat = resumeSeat(row, parsed.msg.token);
      if (seat === null || seat !== att.seat) {
        this.send(ws, { type: 'rejected', reason: 'bad-token' });
        this.safeClose(ws, 4403, 'bad-token');
        return;
      }
      (ws as WebSocket & { serializeAttachment(v: unknown): void }).serializeAttachment({
        ...att,
        authed: true,
      });
      await this.ctx.storage.put<RoomRow>('row', {
        ...row,
        room: touchSeen(row.room, seat, Date.now()),
      });
      // Broadcast (not just the resuming socket): the other seat learns
      // opponentConnected flipped without polling.
      this.broadcast({ ...row, room: touchSeen(row.room, seat, Date.now()) });
      await this.ensureAlarm();
      return;
    }
    if (!parsed.ok || parsed.msg.type !== 'intent') {
      this.send(ws, { type: 'rejected', reason: 'malformed' });
      return;
    }
    const outcome = applyClientIntent(
      row,
      { now: () => Date.now(), rng: Math.random },
      att.seat,
      parsed.msg.intent
    );
    if (outcome.ok) {
      await this.ctx.storage.put<RoomRow>('row', outcome.outcome.row);
      this.broadcast(outcome.outcome.row);
      await this.ensureAlarm();
      return;
    }
    // NOTE: explicit `=== false` comparison — truthiness narrowing does not
    // discriminate this union under this repo's tsconfig, verified with tsc.
    if (outcome.ok === false) {
      this.send(ws, { type: 'rejected', reason: outcome.reason });
      return;
    }
  }

  async webSocketClose(): Promise<void> {
    await this.announcePresence();
    await this.ensureAlarm();
  }

  async webSocketError(): Promise<void> {
    await this.announcePresence();
    await this.ensureAlarm();
  }

  /** Re-send views so the remaining player learns the opponent flag flipped. */
  private async announcePresence(): Promise<void> {
    try {
      const row = await this.ctx.storage.get<RoomRow>('row');
      if (row === undefined || row.room.over !== null) return;
      this.broadcast(row);
    } catch {
      // Presence announcement must never break close handling.
    }
  }

  async alarm(): Promise<void> {
    const row = await this.ctx.storage.get<RoomRow>('row');
    if (row === undefined) return;
    const now = Date.now();
    if (isIdleCleanupDue(row.room, now)) {
      this.broadcast({ ...row, room: row.room }, 'idle');
      this.closeAll(4400, 'idle');
      await this.ctx.storage.deleteAll();
      return;
    }
    this.closeStaleUnauthed(now);
    const present = this.presence();
    const result = onAlarm(row.room, present, { now, rng: Math.random });
    if (result.state !== row.room) {
      await this.ctx.storage.put<RoomRow>('row', { ...row, room: result.state });
    }
    if (result.state.over !== null) {
      this.broadcast({ ...row, room: result.state }, result.state.over.reason);
      this.closeAll(4400, result.state.over.reason);
      await this.ctx.storage.deleteAll();
      return;
    }
    if (result.events.length > 0) {
      this.broadcast({ ...row, room: result.state });
    }
    await this.ensureAlarm();
  }

  private presence(): Record<Player, boolean> {
    const present: Record<Player, boolean> = { A: false, B: false };
    for (const seat of ['A', 'B'] as const) {
      for (const ws of this.ctx.getWebSockets(seat)) {
        const att = attachmentOf(ws);
        if (att !== null && att.authed && att.seat === seat) present[seat] = true;
      }
    }
    return present;
  }

  private closeStaleUnauthed(now: number): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = attachmentOf(ws);
      if (att !== null && !att.authed && now - att.connectedAt >= UNAUTHED_GRACE_MS) {
        this.safeClose(ws, 4408, 'resume-timeout');
      }
    }
  }

  private async ensureAlarm(): Promise<void> {
    try {
      const row = await this.ctx.storage.get<RoomRow>('row');
      if (row === undefined) {
        return;
      }
      const present = this.presence();
      const due = nextDueMs(row.room, Date.now(), present);
      const current = await this.ctx.storage.getAlarm();
      if (due === null) {
        if (current !== null) await this.ctx.storage.deleteAlarm();
        return;
      }
      if (current === null || due < current) await this.ctx.storage.setAlarm(due);
    } catch {
      // Alarm scheduling must never break message handling (at-least-once anyway).
    }
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already gone; presence tracking covers the rest.
    }
  }

  private broadcast(row: RoomRow, closedReason?: string): void {
    const present = this.presence();
    for (const ws of this.ctx.getWebSockets()) {
      const att = attachmentOf(ws);
      if (att === null || !att.authed) continue;
      if (closedReason !== undefined) {
        this.send(ws, { type: 'closed', reason: closedReason });
      } else {
        const envelope = viewEnvelope(row.room, att.seat, present, Date.now(), row.names);
        const key = JSON.stringify({
          view: envelope.view,
          opponentConnected: envelope.opponentConnected,
          readyDeadlineMs: envelope.readyDeadlineMs,
        });
        if (this.lastSent.get(ws) === key) continue;
        this.lastSent.set(ws, key);
        this.send(ws, envelope);
      }
    }
  }

  private closeAll(code: number, reason: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.safeClose(ws, code, reason);
    }
  }

  private safeClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }
}

import type { GameController, Intent, PlayerView } from '../game/controller';
import type { Player } from '../game/match';
import { connectSocket, type SocketClock, type SocketFactory, type SocketHandle } from './socket';
import { clearSession } from './sessionStore';
import { wsUrl } from './http';

export type OnlineConnection =
  | 'connecting'
  | 'waiting-for-opponent'
  | 'live'
  | 'reconnecting'
  | 'opponent-disconnected'
  | 'unreachable'
  | 'closed';

export interface OnlineMeta {
  readonly connection: OnlineConnection;
  /** Latest envelope extras (presence + ready countdown source). */
  readonly opponentConnected: boolean;
  readonly readyDeadlineMs: number | null;
  readonly closeReason: string | null;
}

interface EnvelopeView {
  readonly view: PlayerView;
  readonly serverNowMs: number;
  readonly opponentConnected?: boolean;
  readonly readyDeadlineMs?: number | null;
}

/** Give up auto-retry after this long without a server frame. */
export const RETRY_BUDGET_MS = 60_000;

export interface OnlineDeps {
  clock?: SocketClock & { now(): number };
  openSocket?: SocketFactory;
  onSessionGone?: () => void;
}

function defaultClock(): SocketClock & { now(): number } {
  return {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    now: () => Date.now(),
  };
}

function matchStarted(view: PlayerView): boolean {
  if (view.phase !== 'placing' && view.phase !== 'idle') return true;
  if (view.round > 1) return true;
  if (view.locks.A || view.locks.B) return true;
  for (const board of view.boards) {
    for (const zoneId of Object.keys(board.zones)) {
      const zone = board.zones[zoneId];
      if (zone !== undefined && zone.mine.length > 0) return true;
    }
  }
  return false;
}

/**
 * GameController over the room WebSocket. Seat is fixed at construction;
 * the seat always comes from the stored token, never from message content.
 * Countdowns use server time (offset corrected per frame), never the local
 * clock alone.
 */
export class OnlineController implements GameController {
  private listeners = new Set<(view: PlayerView) => void>();
  private rejectListeners = new Set<(reason: string) => void>();
  private connectionListeners = new Set<(meta: OnlineMeta) => void>();
  private socket: SocketHandle | null = null;
  private view: PlayerView | null = null;
  private offsetMs = 0;
  private opponentConnected = false;
  private readyDeadlineMs: number | null = null;
  private connection: OnlineConnection = 'connecting';
  private closeReason: string | null = null;
  private started = false;
  private firstFailureAt: number | null = null;
  private disposed = false;
  private readonly clock: SocketClock & { now(): number };
  private readonly openSocket?: SocketFactory;
  private readonly onSessionGone?: () => void;

  constructor(
    readonly mySeat: Player,
    private readonly code: string,
    private readonly token: string,
    private readonly baseUrl: string,
    deps: OnlineDeps = {}
  ) {
    this.clock = deps.clock ?? defaultClock();
    this.openSocket = deps.openSocket;
    this.onSessionGone = deps.onSessionGone;
  }

  connect(): void {
    if (this.disposed || this.socket !== null) return;
    this.socket = connectSocket(
      wsUrl(this.baseUrl, this.code, this.mySeat),
      this.token,
      {
        onMessage: (text) => this.handleMessage(text),
        onClose: (code) => this.handleClose(code),
      },
      this.clock,
      this.openSocket
    );
  }

  /** Manual retry from `unreachable` (resets the 60s budget). */
  retry(): void {
    if (this.disposed || this.connection === 'closed') return;
    this.firstFailureAt = null;
    this.setConnection(this.view === null ? 'connecting' : 'reconnecting');
    this.socket?.dispose();
    this.socket = null;
    this.connect();
  }

  subscribe(listener: (view: PlayerView) => void): () => void {
    this.listeners.add(listener);
    if (this.view !== null) listener(this.view);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onReject(listener: (reason: string) => void): () => void {
    this.rejectListeners.add(listener);
    return () => {
      this.rejectListeners.delete(listener);
    };
  }

  onConnection(listener: (meta: OnlineMeta) => void): () => void {
    this.connectionListeners.add(listener);
    listener(this.meta());
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  send(intent: Intent): void {
    if (this.socket?.isOpen() !== true) {
      this.reject('not-connected');
      return;
    }
    this.socket?.send(JSON.stringify({ type: 'intent', intent }));
  }

  /** Server time with the latest measured offset applied. */
  serverNowMs(): number {
    return this.clock.now() + this.offsetMs;
  }

  meta(): OnlineMeta {
    return {
      connection: this.connection,
      opponentConnected: this.opponentConnected,
      readyDeadlineMs: this.readyDeadlineMs,
      closeReason: this.closeReason,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.socket?.dispose();
    this.socket = null;
    this.listeners.clear();
    this.rejectListeners.clear();
    this.connectionListeners.clear();
  }

  private handleMessage(text: string): void {
    let msg: {
      type?: unknown;
      view?: PlayerView;
      serverNowMs?: unknown;
      opponentConnected?: unknown;
      readyDeadlineMs?: unknown;
      reason?: unknown;
    };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === 'view' && msg.view !== undefined) {
      const envelope = msg as EnvelopeView;
      if (typeof envelope.serverNowMs === 'number') {
        this.offsetMs = envelope.serverNowMs - this.clock.now();
      }
      this.opponentConnected = envelope.opponentConnected === true;
      this.readyDeadlineMs =
        typeof envelope.readyDeadlineMs === 'number' ? envelope.readyDeadlineMs : null;
      this.view = envelope.view;
      if (matchStarted(envelope.view)) this.started = true;
      this.firstFailureAt = null;
      this.setConnection(
        this.opponentConnected
          ? 'live'
          : this.started
            ? 'opponent-disconnected'
            : 'waiting-for-opponent'
      );
      for (const listener of this.listeners) listener(envelope.view);
      return;
    }
    if (msg.type === 'rejected') {
      this.reject(typeof msg.reason === 'string' ? msg.reason : 'rejected');
      return;
    }
    if (msg.type === 'closed') {
      this.finish(typeof msg.reason === 'string' ? msg.reason : 'closed');
    }
  }

  private handleClose(code: number): void {
    if (this.disposed || this.connection === 'closed') return;
    // 4403 (bad token) means the session itself is invalid: end it like an
    // explicit close so the UI shows "match ended" instead of retrying.
    if (code === 4403) {
      this.finish('bad-token');
      return;
    }
    if (code === 4400 || code === 4401) {
      if (this.closeReason === null) this.finish('closed');
      return;
    }
    // Retryable drop (including a 404 failed upgrade, which surfaces as a
    // handshake error + close): the wrapper already scheduled a retry.
    // After ~60s without any server frame, surface unreachable with actions.
    const now = this.clock.now();
    if (this.firstFailureAt === null) this.firstFailureAt = now;
    if (now - this.firstFailureAt >= RETRY_BUDGET_MS) {
      this.socket?.dispose();
      this.socket = null;
      this.setConnection('unreachable');
      return;
    }
    this.setConnection(this.view === null ? 'connecting' : 'reconnecting');
  }

  private setConnection(connection: OnlineConnection): void {
    if (this.connection === connection) return;
    this.connection = connection;
    const meta = this.meta();
    for (const listener of this.connectionListeners) listener(meta);
  }

  private finish(reason: string): void {
    this.closeReason = reason;
    this.setConnection('closed');
    this.socket?.dispose();
    this.socket = null;
    clearSession().catch(() => {});
    this.onSessionGone?.();
  }

  private reject(reason: string): void {
    for (const listener of this.rejectListeners) listener(reason);
  }
}

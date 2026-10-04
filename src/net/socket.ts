/**
 * Tiny reconnecting WebSocket wrapper (no dependencies). Sends `resume`
 * with the stored token on every (re)connect. Exponential backoff capped
 * at 5s. Stops permanently on dispose() or when the server ends the session
 * (closed message or a final close code); anything else retries.
 */

export const MAX_BACKOFF_MS = 5000;
const BASE_BACKOFF_MS = 250;

/** Server-initiated endings: never retry these. */
function isFinalClose(code: number): boolean {
  return code === 4400 || code === 4401 || code === 4403;
}

export interface SocketEvents {
  onMessage(text: string): void;
  /** Any socket close (final codes included; dispose() is silent). */
  onClose(code: number): void;
}

export interface SocketHandle {
  send(text: string): void;
  isOpen(): boolean;
  dispose(): void;
}

export interface SocketClock {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
}

export type SocketFactory = (
  url: string,
  events: { onOpen(): void; onMessage(text: string): void; onClose(code: number): void }
) => { send(text: string): void; close(): void };

function browserSocket(
  url: string,
  events: { onOpen(): void; onMessage(text: string): void; onClose(code: number): void }
): { send(text: string): void; close(): void } {
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => events.onOpen());
  ws.addEventListener('message', (ev) => events.onMessage(String(ev.data)));
  ws.addEventListener('close', (ev: CloseEvent) => events.onClose(ev.code));
  ws.addEventListener('error', () => {
    // Failed handshakes (e.g. 404 room-gone) surface here, then close.
    try {
      ws.close();
    } catch {
      // Already closed.
    }
  });
  return {
    send: (text) => ws.send(text),
    close: () => ws.close(),
  };
}

function defaultClock(): SocketClock {
  return {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

export function connectSocket(
  url: string,
  token: string,
  events: SocketEvents,
  clock: SocketClock = defaultClock(),
  factory: SocketFactory = browserSocket
): SocketHandle {
  let stopped = false;
  let attempt = 0;
  let opened = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: { send(text: string): void; close(): void } | null = null;

  function open(): void {
    if (stopped) return;
    const socket = factory(url, {
      onOpen: () => {
        attempt = 0;
        opened = true;
        socket.send(JSON.stringify({ type: 'resume', token }));
      },
      onMessage: (text) => {
        if (!stopped) events.onMessage(text);
      },
      onClose: (code) => {
        current = null;
        opened = false;
        if (stopped) return;
        events.onClose(code);
        if (!isFinalClose(code)) schedule();
      },
    });
    current = socket;
  }

  function schedule(): void {
    if (stopped) return;
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
    attempt += 1;
    if (timer !== null) clock.clearTimeout(timer);
    timer = clock.setTimeout(() => {
      timer = null;
      open();
    }, delay);
  }

  open();

  return {
    send: (text) => {
      if (opened) current?.send(text);
    },
    isOpen: () => opened && current !== null,
    dispose: () => {
      stopped = true;
      if (timer !== null) {
        clock.clearTimeout(timer);
        timer = null;
      }
      current?.close();
      current = null;
    },
  };
}

/** Backoff schedule (pure, tested): 250, 500, 1000, 2000, 4000, 5000, 5000, … */
export function backoffForAttempt(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
}

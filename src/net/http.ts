import { DEFAULT_GAME_CONFIG, type GameConfig } from '../game/config';
import type { Player } from '../game/match';

export type HttpFailure =
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'bad'; readonly message: string }
  | { readonly kind: 'gone' }
  | { readonly kind: 'full' };

export class OnlineHttpError extends Error {
  readonly failure: HttpFailure;
  constructor(failure: HttpFailure) {
    super(failure.kind === 'bad' ? failure.message : failure.kind);
    this.failure = failure;
  }
}

export function serverBaseUrl(override?: string): string {
  const raw =
    override ??
    (typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_SERVER_URL as string | undefined)
      : undefined);
  if (raw) {
    return raw.replace(/\/+$/, '');
  }
  if (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
  ) {
    return '';
  }
  return 'http://localhost:8787';
}

export function wsUrl(baseUrl: string, code: string, seat: Player): string {
  if (!baseUrl) {
    if (typeof window !== 'undefined' && window.location) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/api/rooms/${code}/ws?seat=${seat}`;
    }
  }
  const ws = baseUrl.replace(/^http/, 'ws');
  return `${ws}/api/rooms/${code}/ws?seat=${seat}`;
}

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown
): Promise<{ status: number; out: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OnlineHttpError({ kind: 'unreachable' });
  }
  let out: Record<string, unknown> = {};
  try {
    out = (await res.json()) as Record<string, unknown>;
  } catch {
    out = {};
  }
  return { status: res.status, out };
}

function throwForStatus(status: number, out: Record<string, unknown>): never {
  if (status >= 500) throw new OnlineHttpError({ kind: 'busy' });
  const code = typeof out.error === 'string' ? out.error : '';
  if (status === 404 || code === 'gone' || code === 'closed') {
    throw new OnlineHttpError({ kind: 'gone' });
  }
  if (status === 409 || code === 'full' || code === 'exists') {
    throw new OnlineHttpError({ kind: 'full' });
  }
  throw new OnlineHttpError({ kind: 'bad', message: code || `http-${status}` });
}

export async function createOnlineRoom(
  baseUrl: string,
  name: string,
  config: GameConfig = DEFAULT_GAME_CONFIG
): Promise<{ code: string; token: string; seat: Player }> {
  const { status, out } = await postJson(baseUrl, '/api/rooms', { name, config });
  if (status !== 200 || typeof out.code !== 'string' || typeof out.token !== 'string') {
    throwForStatus(status, out);
  }
  return { code: out.code, token: out.token, seat: 'A' as Player };
}

export interface RoomPreview {
  open: boolean;
  config: GameConfig;
  hostName: string;
}

export async function previewOnlineRoom(baseUrl: string, code: string): Promise<RoomPreview> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/rooms/${code}`, {
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    throw new OnlineHttpError({ kind: 'unreachable' });
  }
  let out: Record<string, unknown> = {};
  try {
    out = (await res.json()) as Record<string, unknown>;
  } catch {
    out = {};
  }
  if (res.status === 404) {
    throw new OnlineHttpError({ kind: 'gone' });
  }
  if (
    res.status !== 200 ||
    typeof out.open !== 'boolean' ||
    typeof out.hostName !== 'string' ||
    !out.config
  ) {
    throwForStatus(res.status, out);
  }
  return {
    open: out.open,
    config: out.config as GameConfig,
    hostName: out.hostName,
  };
}

export async function joinOnlineRoom(
  baseUrl: string,
  code: string,
  name: string
): Promise<{ token: string; seat: Player }> {
  const { status, out } = await postJson(baseUrl, `/api/rooms/${code}/join`, { name });
  if (status !== 200 || typeof out.token !== 'string') {
    throwForStatus(status, out);
  }
  return { token: out.token, seat: 'B' as Player };
}

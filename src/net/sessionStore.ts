import { kvDelete, kvGet, kvSet } from '../storage/kv';
import type { Player } from '../game/match';

export interface OnlineSession {
  readonly code: string;
  readonly token: string;
  readonly seat: Player;
}

const SESSION_KEY = 'online-session';

export function parseSession(value: unknown): OnlineSession | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.code !== 'string' || typeof rec.token !== 'string') return null;
  if (rec.seat !== 'A' && rec.seat !== 'B') return null;
  if (rec.code.length !== 6 || rec.token.length === 0) return null;
  return { code: rec.code, token: rec.token, seat: rec.seat };
}

export async function saveSession(session: OnlineSession): Promise<void> {
  await kvSet(SESSION_KEY, session);
}

export async function loadSession(): Promise<OnlineSession | null> {
  try {
    return parseSession(await kvGet(SESSION_KEY));
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await kvDelete(SESSION_KEY);
  } catch {
    // Storage is best-effort; a stale session is harmless (resume just fails).
  }
}

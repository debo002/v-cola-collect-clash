import { kvDelete, kvGet, kvSet } from './kv';

/**
 * Pass-and-play display names, editable on the menu and persisted on-device.
 * Core logic keeps addressing sides as 'A'/'B' — these are labels only.
 */
export interface Players {
  readonly p1: string;
  readonly p2: string;
}

const KEY = 'players';
const MAX_NAME = 12;

export const DEFAULT_PLAYERS: Players = { p1: 'Player 1', p2: 'Player 2' };

function cleanName(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? value.trim().slice(0, MAX_NAME) : '';
  return name.length > 0 ? name : fallback;
}

export function sanitizePlayers(data: unknown): Players {
  if (typeof data !== 'object' || data === null) return DEFAULT_PLAYERS;
  const record = data as { p1?: unknown; p2?: unknown };
  return {
    p1: cleanName(record.p1, DEFAULT_PLAYERS.p1),
    p2: cleanName(record.p2, DEFAULT_PLAYERS.p2),
  };
}

export async function loadPlayers(): Promise<Players> {
  return sanitizePlayers(await kvGet(KEY));
}

export async function savePlayers(players: Players): Promise<void> {
  await kvSet(KEY, sanitizePlayers(players));
}

export async function clearPlayers(): Promise<void> {
  await kvDelete(KEY);
}

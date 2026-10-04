import type { Intent } from '../src/game/controller';
import { ZONES } from '../src/game/zones';
import { DEFAULT_GAME_CONFIG, validateGameConfig, type GameConfig } from '../src/game/config';
import { isFlavorId } from '../src/game/cards';
import type { FlavorId } from '../src/game/types';

/**
 * Online wire protocol (shared by Worker, Room DO, tests and the Phase 3
 * client). validation happens at the boundary: malformed input is rejected
 * without ever reaching the engine. Seats always come from the resume
 * attachment, never from client fields — extra keys are rejected.
 */

export type ClientMsg =
  | { readonly type: 'resume'; readonly token: string }
  | { readonly type: 'intent'; readonly intent: Intent };

export type ServerMsg =
  | {
      readonly type: 'view';
      readonly view: import('../src/game/controller').PlayerView;
      readonly serverNowMs: number;
      /** Additive: whether the other seat is currently connected. */
      readonly opponentConnected: boolean;
      /** Additive: round-reveal auto-advance deadline, null otherwise. */
      readonly readyDeadlineMs: number | null;
    }
  | { readonly type: 'rejected'; readonly reason: string }
  | { readonly type: 'closed'; readonly reason: string };

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newRoomCode(randomValues: (n: number) => Uint8Array): string {
  let code = '';
  while (code.length < 6) {
    const bytes = randomValues(6);
    for (const byte of bytes) {
      if (code.length >= 6) break;
      const index = byte % CODE_ALPHABET.length;
      const ch = CODE_ALPHABET[index];
      if (ch !== undefined) code += ch;
    }
  }
  return code;
}

export function newToken(randomValues: (n: number) => Uint8Array): string {
  const bytes = randomValues(16);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Web Crypto (workers runtime and modern browsers/node); module-scoped so both tsconfigs agree. */
declare const crypto: {
  getRandomValues(array: Uint8Array): Uint8Array;
};

/** Crypto randomness (production). Tests inject a seeded function instead. */
export function cryptoRandom(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}

const ZONE_IDS = new Set(ZONES.map((z) => z.id));

function validHandIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Runtime guard for Intent: known type, correct shapes, no extra keys. Range checks stay in the engine. */
export function parseIntent(value: unknown): Intent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  switch (value.type) {
    case 'place':
      if (!exactKeys(value, ['type', 'handIndex', 'zone'])) return null;
      if (!validHandIndex(value.handIndex)) return null;
      if (typeof value.zone !== 'string' || !ZONE_IDS.has(value.zone)) return null;
      return { type: 'place', handIndex: value.handIndex, zone: value.zone };
    case 'unplace':
      if (!exactKeys(value, ['type', 'handIndex'])) return null;
      if (!validHandIndex(value.handIndex)) return null;
      return { type: 'unplace', handIndex: value.handIndex };
    case 'lock':
      if (!exactKeys(value, ['type'])) return null;
      return { type: 'lock' };
    case 'draw':
      if (!exactKeys(value, ['type'])) return null;
      return { type: 'draw' };
    case 'ready':
      if (!exactKeys(value, ['type'])) return null;
      return { type: 'ready' };
    case 'rematch':
      if (!exactKeys(value, ['type'])) return null;
      return { type: 'rematch' };
    default:
      return null;
  }
}

export function parseClientMessage(
  text: unknown
): { ok: true; msg: ClientMsg } | { ok: false; reason: string } {
  if (typeof text !== 'string') return { ok: false, reason: 'malformed' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string')
    return { ok: false, reason: 'malformed' };
  if (parsed.type === 'resume') {
    if (!exactKeys(parsed, ['type', 'token'])) return { ok: false, reason: 'malformed' };
    if (
      typeof parsed.token !== 'string' ||
      parsed.token.length === 0 ||
      parsed.token.length > 256
    ) {
      return { ok: false, reason: 'malformed' };
    }
    return { ok: true, msg: { type: 'resume', token: parsed.token } };
  }
  if (parsed.type === 'intent') {
    if (!exactKeys(parsed, ['type', 'intent'])) return { ok: false, reason: 'malformed' };
    const intent = parseIntent(parsed.intent);
    if (intent === null) return { ok: false, reason: 'malformed' };
    return { ok: true, msg: { type: 'intent', intent } };
  }
  return { ok: false, reason: 'malformed' };
}

export function validPlayerName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 24;
}

export function parseGameConfig(
  value: unknown
): { ok: true; config: GameConfig } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, config: DEFAULT_GAME_CONFIG };
  }
  if (!isRecord(value)) return { ok: false, error: 'config-invalid' };

  if (value.mode !== 'quick' && value.mode !== 'custom') {
    return { ok: false, error: 'mode-invalid' };
  }
  if (!isRecord(value.deck)) return { ok: false, error: 'deck-invalid' };
  let deck: GameConfig['deck'];
  if (value.deck.kind === 'normal') {
    if (!exactKeys(value.deck, ['kind'])) return { ok: false, error: 'deck-invalid' };
    deck = { kind: 'normal' };
  } else if (value.deck.kind === 'custom') {
    if (!exactKeys(value.deck, ['kind', 'flavors'])) return { ok: false, error: 'deck-invalid' };
    if (!Array.isArray(value.deck.flavors) || !value.deck.flavors.every(isFlavorId)) {
      return { ok: false, error: 'deck-invalid' };
    }
    deck = { kind: 'custom', flavors: value.deck.flavors };
  } else {
    return { ok: false, error: 'deck-invalid' };
  }

  if (value.dealing !== 'reveal-all' && value.dealing !== 'draw-per-round') {
    return { ok: false, error: 'dealing-invalid' };
  }
  if (typeof value.drawPerRound !== 'number' || !Number.isInteger(value.drawPerRound)) {
    return { ok: false, error: 'draw-invalid' };
  }
  if (typeof value.maxPlacedPerRound !== 'number' || !Number.isInteger(value.maxPlacedPerRound)) {
    return { ok: false, error: 'placed-invalid' };
  }
  if (value.power !== 'random' && value.power !== 'fixed') {
    return { ok: false, error: 'power-invalid' };
  }
  if (!isRecord(value.fixedPower)) return { ok: false, error: 'power-invalid' };
  for (const [k, v] of Object.entries(value.fixedPower)) {
    if (!isFlavorId(k) || typeof v !== 'number' || !Number.isInteger(v)) {
      return { ok: false, error: 'power-invalid' };
    }
  }
  if (typeof value.effectsEnabled !== 'boolean') {
    return { ok: false, error: 'effects-invalid' };
  }

  const expectedKeys = [
    'mode',
    'deck',
    'dealing',
    'drawPerRound',
    'maxPlacedPerRound',
    'power',
    'fixedPower',
    'effectsEnabled',
  ];
  if (!exactKeys(value, expectedKeys)) {
    return { ok: false, error: 'config-invalid' };
  }

  const config: GameConfig = {
    mode: value.mode,
    deck,
    dealing: value.dealing,
    drawPerRound: value.drawPerRound,
    maxPlacedPerRound: value.maxPlacedPerRound,
    power: value.power,
    fixedPower: value.fixedPower as Readonly<Partial<Record<FlavorId, number>>>,
    effectsEnabled: value.effectsEnabled,
  };

  const validationError = validateGameConfig(config);
  if (validationError !== null) {
    return { ok: false, error: validationError };
  }
  return { ok: true, config };
}

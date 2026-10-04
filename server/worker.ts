import { createRoom } from './roomLogic';
import { cryptoRandom, newRoomCode, parseGameConfig, validPlayerName } from './protocol';

export { Room } from './room';

/**
 * Online lobby Worker (local only for now; deploy is a later phase).
 * HTTP: create room (name + validated GameConfig -> code + token),
 * join room, WebSocket upgrade proxied to the Room Durable Object.
 * Gameplay randomness is Math.random passed in as ctx.rng (seeded only in
 * tests); room codes and resume tokens use crypto.getRandomValues.
 */

interface Env {
  ROOM: DurableObjectNamespace;
}

function randomCode(): string {
  return newRoomCode((n) => cryptoRandom(n));
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  };
}

function jsonWithCors(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: corsHeaders() });
}

async function roomExists(env: Env, code: string): Promise<boolean> {
  const stub = env.ROOM.get(env.ROOM.idFromName(`room-${code}`));
  const res = await stub.fetch('https://room/internal/exists');
  if (!res.ok) return false;
  const body = (await res.json()) as { exists?: unknown };
  return body.exists === true;
}

async function uniqueCode(env: Env): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    if (!(await roomExists(env, code))) return code;
  }
  throw new Error('code-collision');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonWithCors({ error: 'malformed' }, 400);
      }
      const rec = body as Record<string, unknown>;
      if (!validPlayerName(rec.name)) return jsonWithCors({ error: 'bad-name' }, 400);
      const parsedConfig = parseGameConfig(rec.config);
      if ('error' in parsedConfig) {
        return jsonWithCors({ error: parsedConfig.error }, 400);
      }
      const { config } = parsedConfig;
      const created = createRoom(
        { now: () => Date.now(), rng: Math.random },
        rec.name,
        config
      );
      if ('error' in created) return jsonWithCors({ error: created.error }, 400);
      const code = await uniqueCode(env);
      const stub = env.ROOM.get(env.ROOM.idFromName(`room-${code}`));
      const init = await stub.fetch('https://room/internal/init', {
        method: 'POST',
        body: JSON.stringify(created.row),
      });
      if (!init.ok) return jsonWithCors({ error: 'exists' }, 409);
      return jsonWithCors({ code, token: created.row.tokens.A, seat: 'A' });
    }
    const joinMatch = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/join$/);
    if (request.method === 'POST' && joinMatch?.[1] !== undefined) {
      const code = joinMatch[1];
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonWithCors({ error: 'malformed' }, 400);
      }
      const rec = body as { name?: unknown };
      if (!validPlayerName(rec.name)) return jsonWithCors({ error: 'bad-name' }, 400);
      const stub = env.ROOM.get(env.ROOM.idFromName(`room-${code}`));
      const res = await stub.fetch('https://room/internal/join', {
        method: 'POST',
        body: JSON.stringify({ name: (rec.name as string).trim() }),
      });
      const out = (await res.json()) as Record<string, unknown>;
      return jsonWithCors(out, res.status);
    }
    const wsMatch = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/ws$/);
    if (wsMatch?.[1] !== undefined) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const code = wsMatch[1];
      const stub = env.ROOM.get(env.ROOM.idFromName(`room-${code}`));
      return stub.fetch(request);
    }
    return new Response('not found', { status: 404 });
  },
};

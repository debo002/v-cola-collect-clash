/* Online room transcript: two scripted WebSocket clients play a full match
 * against `wrangler dev`, including forged intents. Local only. */
const BASE = process.env.ROOM_URL || 'http://localhost:8787/';
const WS_BASE = BASE.replace(/^http/, 'ws');

const CONFIG = {
  mode: 'custom',
  deck: {
    kind: 'custom',
    flavors: ['v-cola', 'v-diet-cola', 'cream-soda', 'v-lemon', 'lemon-mint', 'blueberry'],
  },
  dealing: 'reveal-all',
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

async function post(path, body) {
  const res = await fetch(new URL(path, BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(out)}`);
  return out;
}

function summarize(tag, view) {
  const boards = view.boards
    .map((b) => {
      const zones = Object.entries(b.zones)
        .map(([id, z]) => {
          const mine = z.mine?.length ?? 0;
          const foe = z.foe !== undefined ? `foe[${z.foe.length}]` : `foeCount=${z.foeCount}`;
          return `${id}:m${mine},${foe}`;
        })
        .join(' ');
      return `${b.kind}{${zones}}`;
    })
    .join(' | ');
  console.log(
    `${tag} seat=${view.seat} phase=${view.phase} round=${view.round} hand=${view.hand.length} oppHand=${view.opponentHandCount} locks=${view.locks.A},${view.locks.B} draws=${view.drawsRemaining} boards=[${boards}] winner=${view.winner}`
  );
}

function checkRedacted(tag, view) {
  for (const board of view.boards) {
    if (board.kind === 'current') {
      for (const [id, zone] of Object.entries(board.zones)) {
        if (!('foeCount' in zone) || 'foe' in zone) {
          throw new Error(`${tag}: zone ${id} leaks foe cards: ${JSON.stringify(zone)}`);
        }
      }
    }
  }
  if (typeof view.opponentHandCount !== 'number')
    throw new Error(`${tag}: opponent hand not a count`);
}

function connect(seat, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/rooms/${globalThis.__code}/ws?seat=${seat}`, WS_BASE).toString();
    const ws = new WebSocket(url);
    const client = { seat, ws, views: [], rejects: [], closed: [], waiters: [] };
    const timer = setTimeout(() => reject(new Error(`${seat}: connect timeout`)), 10000);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'view') {
        client.views.push(msg.view);
        summarize(`[${seat} view#${client.views.length}]`, msg.view);
        checkRedacted(`[${seat}]`, msg.view);
        for (const w of client.waiters.splice(0)) w(msg.view);
      } else if (msg.type === 'rejected') {
        client.rejects.push(msg.reason);
        console.log(`[${seat} rejected] ${msg.reason}`);
        for (const w of client.waiters.splice(0)) w(null);
      } else if (msg.type === 'closed') {
        client.closed.push(msg.reason);
        console.log(`[${seat} closed] ${msg.reason}`);
      }
    });
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'resume', token }));
    });
    const check = () => {
      if (client.views.length > 0) {
        clearTimeout(timer);
        resolve(client);
      } else {
        setTimeout(check, 100);
      }
    };
    ws.addEventListener('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`${seat}: ws error ${e.message || e.type}`));
    });
    check();
  });
}

function waitViews(clients, counts) {
  return Promise.all(
    clients.map(
      (c, i) =>
        new Promise((resolve, reject) => {
          if (c.views.length > counts[i]) {
            resolve(c.views[c.views.length - 1]);
            return;
          }
          const timer = setTimeout(() => reject(new Error(`${c.seat}: view timeout`)), 10000);
          c.waiters.push(() => {
            clearTimeout(timer);
            resolve(c.views[c.views.length - 1]);
          });
        })
    )
  );
}

async function sendIntent(clients, seat, intent) {
  const counts = clients.map((c) => c.views.length);
  const sender = clients.find((c) => c.seat === seat);
  sender.ws.send(JSON.stringify({ type: 'intent', intent }));
  return waitViews(clients, counts);
}

async function sendRawAndExpectReject(clients, seat, raw) {
  const sender = clients.find((c) => c.seat === seat);
  const rejectsBefore = sender.rejects.length;
  const viewsBefore = sender.views.length;
  sender.ws.send(raw);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (sender.rejects.length > rejectsBefore) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (sender.rejects.length === rejectsBefore) throw new Error(`${seat}: expected rejected frame`);
  if (sender.views.length !== viewsBefore) throw new Error(`${seat}: forged intent changed views`);
  console.log(
    `[${seat} forged] rejected=${sender.rejects[sender.rejects.length - 1]} viewsUnchanged=true`
  );
}

const created = await post('/api/rooms', { name: 'Alice', config: CONFIG });
console.log(
  `create code=${created.code} seat=${created.seat} token=${String(created.token).slice(0, 8)}...`
);
globalThis.__code = created.code;
const joined = await post(`/api/rooms/${created.code}/join`, { name: 'Bob' });
console.log(`join seat=${joined.seat} token=${String(joined.token).slice(0, 8)}...`);

const clients = [await connect('A', created.token), await connect('B', joined.token)];
console.log('both connected + resumed');

// Forged intents before play.
await sendRawAndExpectReject(
  clients,
  'A',
  JSON.stringify({
    type: 'intent',
    intent: { type: 'place', handIndex: 0, zone: 'cool', seat: 'B' },
  })
);
await sendRawAndExpectReject(
  clients,
  'B',
  JSON.stringify({ type: 'intent', intent: { type: 'place', handIndex: 0, zone: 'void' } })
);

for (let r = 0; r < 3; r++) {
  await sendIntent(clients, 'A', { type: 'place', handIndex: 2 * r, zone: 'cool' });
  await sendIntent(clients, 'A', { type: 'place', handIndex: 2 * r + 1, zone: 'party' });
  await sendIntent(clients, 'B', { type: 'place', handIndex: r, zone: 'cool' });
  await sendIntent(clients, 'A', { type: 'lock' });
  await sendIntent(clients, 'B', { type: 'lock' });
  console.log(`--- round ${r + 1} revealed ---`);
  if (r === 0) {
    // Reconnect B mid-match: resume with token must restore its view.
    const b = clients.find((c) => c.seat === 'B');
    b.ws.close();
    await new Promise((res) => setTimeout(res, 500));
    const fresh = await connect('B', joined.token);
    clients[clients.indexOf(b)] = fresh;
    console.log('[B reconnect] resumed ok');
  }
  if (r < 2) {
    await sendIntent(clients, 'A', { type: 'ready' });
    await sendIntent(clients, 'B', { type: 'ready' });
    console.log(`--- advanced to round ${r + 2} ---`);
  }
}

const finalA = clients.find((c) => c.seat === 'A').views.at(-1);
const finalB = clients.find((c) => c.seat === 'B').views.at(-1);
console.log(
  `final A: phase=${finalA.phase} winner=${finalA.winner} results=${JSON.stringify(finalA.results?.map((z) => [z.zoneId, z.winner, z.totals]))}`
);
console.log(`final B: phase=${finalB.phase} winner=${finalB.winner}`);
if (finalA.phase !== 'complete' || finalB.phase !== 'complete')
  throw new Error('match did not complete');
for (const c of clients) c.ws.close();
console.log('TRANSCRIPT PASSED');

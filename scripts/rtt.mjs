/* RTT probe (item 7e, amended): creates ONE room on the live Worker, joins a
 * second socket in the same script, then measures (a) 20 deliberately
 * invalid intents and (b) 20 valid place/unplace pairs from seat A.
 * Reports median + p95 of the `rejected` replies (a) and of the
 * send→authoritative-view latency (b). Run once; no deploy, no login. */
const BASE = 'https://v-cola-rooms.abdullah-weave-dev.workers.dev';
const WS_BASE = BASE.replace(/^http/, 'ws');

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function stats(label, samples) {
  const s = [...samples].sort((a, b) => a - b);
  const median = percentile(s, 50);
  const p95 = percentile(s, 95);
  console.log(
    `${label}: n=${s.length} median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms ` +
      `min=${s[0].toFixed(1)}ms max=${s[s.length - 1].toFixed(1)}ms`
  );
  return { median, p95 };
}

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

function connect(seat, token, code) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/api/rooms/${code}/ws?seat=${seat}`);
    const client = {
      seat,
      ws,
      views: [],
      rejects: [],
      waiters: [],
      nextView() {
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error(`${seat}: view timeout`)), 10000);
          client.waiters.push((v) => {
            clearTimeout(timer);
            res(v);
          });
        });
      },
    };
    const timer = setTimeout(() => reject(new Error(`${seat}: connect timeout`)), 15000);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'view') {
        client.views.push(msg.view);
        for (const w of client.waiters.splice(0)) w(msg.view);
      } else if (msg.type === 'rejected') {
        client.rejects.push({ reason: msg.reason, at: performance.now() });
      }
    });
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'resume', token })));
    ws.addEventListener('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`${seat}: ws error ${e.message || e.type}`));
    });
    const check = () => {
      if (client.views.length > 0) {
        clearTimeout(timer);
        resolve(client);
      } else setTimeout(check, 100);
    };
    check();
  });
}

function sendIntent(client, intent) {
  return performance.now();
}

const created = await post('/api/rooms', { name: 'RTT' });
console.log(`room ${created.code} seat=${created.seat}`);
const joined = await post(`/api/rooms/${created.code}/join`, { name: 'RTT2' });
const a = await connect('A', created.token, created.code);
const b = await connect('B', joined.token, created.code);
console.log(`both connected (B views seen: ${b.views.length})`);

// (a) 20 invalid intents: out-of-range placements are rejected by the engine.
const invalidSamples = [];
for (let i = 0; i < 20; i += 1) {
  const rejectsBefore = a.rejects.length;
  const t0 = performance.now();
  a.ws.send(
    JSON.stringify({ type: 'intent', intent: { type: 'place', handIndex: 999, zone: 'cool' } })
  );
  const deadline = Date.now() + 10000;
  while (a.rejects.length === rejectsBefore && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (a.rejects.length === rejectsBefore) throw new Error('no rejected reply');
  invalidSamples.push(a.rejects[a.rejects.length - 1].at - t0);
}
const invalid = stats('invalid intent -> rejected', invalidSamples);

// (b) 20 valid place/unplace pairs on seat A (alternating one card).
const validSamples = [];
for (let i = 0; i < 20; i += 1) {
  for (const intent of [
    { type: 'place', handIndex: 0, zone: 'cool' },
    { type: 'unplace', handIndex: 0 },
  ]) {
    const pending = a.nextView();
    sendIntent(a, intent);
    const t0 = performance.now();
    a.ws.send(JSON.stringify({ type: 'intent', intent }));
    await pending;
    validSamples.push(performance.now() - t0);
  }
}
const valid = stats('valid intent -> authoritative view', validSamples);

a.ws.close();
b.ws.close();
console.log(
  `RTT SUMMARY invalid(median=${invalid.median.toFixed(1)} p95=${invalid.p95.toFixed(1)}) ` +
    `valid(median=${valid.median.toFixed(1)} p95=${valid.p95.toFixed(1)})`
);
if (valid.median > 150) {
  console.log('DECISION: valid median > 150ms -> build optimistic place/unplace UI');
} else {
  console.log('DECISION: valid median <= 150ms -> skip optimistic UI');
}

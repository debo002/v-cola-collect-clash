import { spawn } from 'node:child_process';
import net from 'node:net';

const TEST_PORT = 8789;

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => reject(new Error(`Port ${port} not free: ${err.message}`)));
    server.once('listening', () => server.close(() => resolve()));
    server.listen(port);
  });
}

async function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function run() {
  await assertPortFree(TEST_PORT);
  console.log(`Starting wrangler dev on port ${TEST_PORT}...`);
  const proc = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['wrangler', 'dev', '--port', String(TEST_PORT)],
    {
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  proc.stdout.on('data', (d) => {
    const str = d.toString();
    if (str.includes('Ready') || str.includes('error')) console.log(`[wrangler] ${str.trim()}`);
  });
  proc.stderr.on('data', (d) => {
    console.error(`[wrangler err] ${d.toString().trim()}`);
  });

  try {
    const baseUrl = `http://localhost:${TEST_PORT}`;
    await waitForHttp(`${baseUrl}/`);
    console.log('Worker + assets server ready!');

    // 1. Verify static asset (index.html)
    const indexRes = await fetch(`${baseUrl}/`);
    const indexText = await indexRes.text();
    if (!indexRes.ok || !indexText.includes('<div id="root">')) {
      throw new Error(`Failed to fetch index.html: status=${indexRes.status}`);
    }
    console.log('PASS 1: index.html served correctly');

    // 2. Verify static asset (manifest.webmanifest)
    const manifestRes = await fetch(`${baseUrl}/manifest.webmanifest`);
    if (!manifestRes.ok) {
      throw new Error(`Failed to fetch manifest: status=${manifestRes.status}`);
    }
    console.log('PASS 2: static file manifest.webmanifest served');

    // 3. Verify SPA fallback routing (requesting client route /online returns index.html)
    const spaRes = await fetch(`${baseUrl}/online`);
    const spaText = await spaRes.text();
    if (!spaRes.ok || !spaText.includes('<div id="root">')) {
      throw new Error(`Failed SPA fallback for /online: status=${spaRes.status}`);
    }
    console.log('PASS 3: SPA fallback routing served index.html');

    // 4. Verify API route POST /api/rooms (handled by Worker, not static assets)
    const createRes = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Failed to create room: status=${createRes.status} ${errText}`);
    }
    const createData = await createRes.json();
    if (!createData.code || !createData.token) {
      throw new Error(`Bad room creation response: ${JSON.stringify(createData)}`);
    }
    console.log(`PASS 4: POST /api/rooms created room ${createData.code}`);

    // 5. Verify API route GET /rooms/:code (preview endpoint)
    const previewRes = await fetch(`${baseUrl}/rooms/${createData.code}`);
    if (!previewRes.ok) {
      throw new Error(`Failed to preview room: status=${previewRes.status}`);
    }
    const previewData = await previewRes.json();
    if (previewData.open !== true || previewData.hostName !== 'Alice') {
      throw new Error(`Bad preview response: ${JSON.stringify(previewData)}`);
    }
    console.log(
      `PASS 5: GET /rooms/${createData.code} preview returned hostName=${previewData.hostName}`
    );

    // 6. Verify API route POST /api/rooms/:code/join
    const joinRes = await fetch(`${baseUrl}/api/rooms/${createData.code}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bob' }),
    });
    if (!joinRes.ok) {
      throw new Error(`Failed to join room: status=${joinRes.status}`);
    }
    const joinData = await joinRes.json();
    if (!joinData.token || joinData.seat !== 'B') {
      throw new Error(`Bad join response: ${JSON.stringify(joinData)}`);
    }
    console.log(`PASS 6: POST /api/rooms/${createData.code}/join joined as seat B`);

    console.log('ALL SINGLE-ORIGIN CHECKS PASSED');
  } finally {
    if (proc.pid) {
      if (process.platform === 'win32') {
        const { execSync } = await import('node:child_process');
        try {
          execSync(`taskkill /pid ${proc.pid} /t /f`, { stdio: 'ignore' });
        } catch {}
      } else {
        proc.kill('SIGTERM');
      }
    }
  }
}

run().catch((e) => {
  console.error('TEST FAILED:', e);
  process.exit(1);
});

# V Cola: Collect & Clash

A landscape mobile-web PWA for local, two-player pass-and-play matches. Players build a collection, receive a six-card Quick Play hand, and compete across three zones. The current game has no scanning or online play. Custom matches and Ranked series are not available yet.

## Run locally

Requires Node.js and npm.

```sh
npm install
npm run dev                 # Start the Vite development server
npm run dev -- --host       # Expose it on the local network for phone testing
npm test                    # Run the Vitest suite
npm run build               # Type-check and create the production build
npm run preview             # Preview the production build
npm run smoke               # Run the Playwright match smoke flow (with preview serving)
```

`npm run smoke` expects the app to be served with `npm run preview -- --port 4173` in another terminal. Other available scripts are `npm run lint`, `npm run format`, `npm run format:check`, and `npm run typecheck`.

## Online multiplayer (local dev & testing)

The online room server runs on Cloudflare Workers and Durable Objects.

```sh
# Terminal 1: start the room server locally
npm run dev:server          # or: npx wrangler dev --port 8787

# Terminal 2: start the client
npm run dev
```

### Phone testing on LAN

To test on physical devices (e.g. two phones on the same Wi-Fi):

1. Start the room server bound to all interfaces:
   ```sh
   npx wrangler dev --port 8787 --ip 0.0.0.0
   ```
2. Find your PC's LAN IP (e.g. `192.168.1.50`).
3. Set `VITE_SERVER_URL` when starting Vite so mobile clients connect to your PC's room server:
   ```sh
   VITE_SERVER_URL=http://<YOUR_LAN_IP>:8787 npm run dev -- --host
   ```
4. Open `http://<YOUR_LAN_IP>:5173/` on both phones.

## Production deployment (Cloudflare Workers)

The application deploys as a single-origin service on Cloudflare Workers:

- **Frontend SPA**: Static assets in `./dist` served directly with SPA routing fallback.
- **Backend API & WebSockets**: Worker + SQLite Durable Objects handling room creation, preview, join, and hibernatable WebSockets.

### Deploying to Cloudflare

1. Ensure the production build is ready and you are logged into Wrangler:
   ```sh
   npx wrangler login           # One-time Cloudflare login via browser
   ```
2. Deploy the combined SPA and Worker:
   ```sh
   npm run deploy               # Runs "npm run build && wrangler deploy"
   ```
3. Once deployed, Wrangler outputs your production URL (e.g., `https://v-cola-rooms.<your-subdomain>.workers.dev`). No extra environment variables (like `VITE_SERVER_URL`) are needed because the client automatically detects same-origin hosting in production.

### Rollback

To instantly revert to a previous deployment without rebuilding:

```sh
npx wrangler rollback
```

### Cloudflare Free-Plan Safety Audit

This project is specifically architected to stay comfortably within the Cloudflare Workers Free Tier:

- **Static Assets bypass Worker compute**: Configured with `run_worker_first: ["/api/*", "/rooms/*"]`, meaning all HTML, CSS, JS, font, and image requests are served directly by Cloudflare's global CDN cache without invoking the Worker. These requests consume 0ms of Worker CPU and do not count against the 100,000 requests/day Worker limit.
- **Worker CPU usage**: API endpoints (`/api/rooms`, `/rooms/:code`, `/api/rooms/:code/join`) execute lightweight in-memory and SQLite checks taking < 1ms, far below the free tier's 10ms CPU limit per invocation.
- **WebSocket Hibernation**: Connected player WebSockets use the Cloudflare Hibernatable WebSocket API in Durable Objects, meaning idle sockets waiting for player turns do not consume CPU time or wall-clock billing.
- **Zero Paid Dependencies**: Does not use Cloudflare KV, R2, D1, or Queues. Room state is stored exclusively in ephemeral SQLite-backed Durable Objects and automatically cleaned up when matches finish.

## Match flow

Quick Play starts with player setup, then passes the device between players. Each player plans cards in a zone and locks in; both players' placements are revealed after both lock in. The `?` help sheet explains the match, zones, combos, card effects, tags, and board indicators without changing the match. After the third round, the game runs the zone-resolution sequence, shows the match review, and lets players tap a zone to replay its resolution. Players can rematch or return to the menu.

The Cola pair applies -1 only when those are the side's exact cards in a zone; adding V Lemon completes the +2 Cola trio, with other cards allowed. The Lemon trio (V Lemon, Lemon Mint, Pink Lemonade) adds its lowest base power again, also with other cards allowed. Cream Soda cancels both sides' card effects and the zone bonus in its zone. The detailed current rules are in [docs/V_COLA_DESIGN.md](docs/V_COLA_DESIGN.md).

The Deck screen lets players manage a deck, but that deck does not currently start a Custom match. Ranked play is not implemented.

## Project map

```text
src/game/                 Framework-agnostic TypeScript for cards, effects, zones,
                          placement, resolution, scoring, and series rules
src/storage/              IndexedDB persistence for collection, deck, and player names
src/components/match/     Title/setup, pass screen, top bar, board, zones, resolution/replay
src/components/           Shared UI components, including GameCard
src/screens/              QuickPlay and Deck screens
src/i18n.tsx              English and Arabic translations and RTL direction
src/tests/                Vitest tests for game and storage modules
public/assets/cards/      Can photos and the V7 logo
```

`src/game/` has no React or DOM dependencies. Card definitions live in `src/game/cards.ts`; zone definitions live in `src/game/zones.ts`. Card power is rolled when hands are built, stays with that hand for the match, and is not persisted in the collection.

## Local project guidance

See [AGENTS.md](AGENTS.md) for coding conventions and [docs/V_COLA_DESIGN.md](docs/V_COLA_DESIGN.md) for the current local rules reference. The local design and implementation documents are ignored by Git.

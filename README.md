# V Cola: Collect & Clash — Phase 1 (local pass-and-play)

Mobile-web PWA, 1v1 collectible card game. Phase 1 is local pass-and-play only:
no backend, no scanning, no online PvP yet. See `docs/` (local-only) for the
locked design spec and build order.

## Run locally

Prerequisites: Node 20+ and npm (verified with Node 24, npm 12 on Windows).

```sh
npm install
npm run dev      # local dev server (Vite)
npm run dev -- --host  # expose a LAN URL for phone testing (same WiFi)
npm test         # Vitest suite (game-logic tests, no browser needed)
npm run build    # typecheck + production build
npm run preview  # preview the production build
```

Other scripts: `npm run lint`, `npm run format`, `npm run typecheck`.

## Project map

```
src/game/        # framework-agnostic TS: rules, placement, reveal, scoring (no React/DOM)
src/storage/     # Phase 1: IndexedDB collection persistence (stub for now)
src/scanning/    # Phase 2 stubs only — no ZXing / TF.js yet
src/components/  # React UI building blocks
src/screens/     # mobile-first screens
src/hooks/       # React hooks
src/tests/       # Vitest tests for game logic
docs/            # local-only specs (gitignored, never committed)
```

Rules: cards store Flavor only — Power (1–5) is rolled fresh every match, never
stored. Flavor/zone names live in `src/game/cards.ts` / `src/game/zones.ts` —
never hardcoded elsewhere.

Demo placeholders: real V7 can photos (`public/assets/cards/<flavor-id>.webp`)
on CSS line-color gradients, CSS zone banners + card back. No AI art. Final art
brief lives in `docs/ASSET_REQUESTS.md` (local-only).

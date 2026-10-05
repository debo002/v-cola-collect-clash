# AGENTS.md — V Cola: Collect & Clash

## Project

Landscape React + TypeScript + Vite PWA for local pass-and-play and online room PvP. The running code is the source of truth; keep documentation aligned with it. Local Quick Play, Custom Game setup, and online rooms are built. Ranked series, trading, and Capacitor packaging are planned, not built.

## Structure and rules

- Keep `src/game/` framework-agnostic TypeScript: no React or DOM. Game rules and effects live there; document what the code does today.
- Do not invent or change card effects. Effects live in `src/game/effects.ts` and `src/game/resolve.ts`; zone definitions live in `src/game/zones.ts`.
- Power is rolled when hands are built and kept for that match. It is not stored in the collection. See `src/game/hands.ts` and `src/game/rng.ts`.
- Keep flavor definitions in `src/game/cards.ts` and zone definitions in `src/game/zones.ts`; avoid duplicating their names or rules.
- One shared `GameCard` component renders every card. Card group membership comes from the effect definitions and colors follow those groups through `src/components/comboTheme.ts`; never create a hardcoded per-card color map.
- Deck screen picks (6 unique slots, deckStore) are stored but not consumed by any match mode.
- UI tasks are presentation-only and must not touch `src/game/`.
- Online code rules: `src/game/` and the room engine (`matchEngine.ts`, `view.ts`, `roomLogic.ts`, `protocol.ts`) stay framework-agnostic and shared by client and server. Hidden information (opponent hand/placements) must never be sent to the other client before reveal — `buildPlayerView` redacts it per seat. `server/` must stay within the Cloudflare free plan (no KV/R2/D1/Queues).

## Design direction

This is a game screen, not a website. Use the `frontend-design` skill for visual work. Keep the zones as the focus; do not add sidebars or dashboard panels.

## Build order

1. Local pass-and-play and its rules/UI (done).
2. Online PvP (done).
3. Planned app packaging with Capacitor.

Do not push or force-push, and do not attempt GitHub authentication, unless the user explicitly authorizes it. The remote is github.com/debo002/v-cola-collect-clash. Do not install global system software or sign up for third-party services. Keep changes small and focused. Run `npm test` after game-logic changes and `npm run build` after significant changes.

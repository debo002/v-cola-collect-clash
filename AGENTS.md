# AGENTS.md — V Cola: Collect & Clash

## Project

Landscape React + TypeScript + Vite PWA for local pass-and-play. The running code is the source of truth; keep documentation aligned with it. Current play is Quick Play. Scanning was removed. Custom-match play, Ranked series, online PvP, and trading are planned, not built.

## Structure and rules

- Keep `src/game/` framework-agnostic TypeScript: no React or DOM. Game rules and effects live there; document what the code does today.
- Do not invent or change card effects. Effects live in `src/game/effects.ts` and `src/game/resolve.ts`; zone definitions live in `src/game/zones.ts`.
- Power is rolled when hands are built and kept for that match. It is not stored in the collection. See `src/game/hands.ts` and `src/game/rng.ts`.
- Keep flavor definitions in `src/game/cards.ts` and zone definitions in `src/game/zones.ts`; avoid duplicating their names or rules.
- One shared `GameCard` component renders every card. Card group membership comes from the effect definitions and colors follow those groups through `src/components/comboTheme.ts`; never create a hardcoded per-card color map.
- UI tasks are presentation-only and must not touch `src/game/`.

## Design direction

This is a game screen, not a website. Use the `frontend-design` skill for visual work. Keep the zones as the focus; do not add sidebars or dashboard panels.

## Build order

1. Local pass-and-play and its rules/UI.
2. Planned online PvP.
3. Planned app packaging with Capacitor.

Do not create a GitHub remote. Pushing changes or attempting GitHub authentication is allowed only when the user explicitly authorizes it. Do not install global system software or sign up for third-party services. Keep changes small and focused. Run `npm test` after game-logic changes and `npm run build` after significant changes.

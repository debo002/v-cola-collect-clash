## What / why

## Spec reference

`docs/V_COLA_DESIGN.md` § / `docs/IMPLEMENTATION_PLAN.md` item:

## Tests

- [ ] `npm test` green (new tests for game-logic changes)
- [ ] `npm run build` green

## Checklist

- [ ] No game rule added, removed, or reinterpreted
- [ ] No Power stored on cards or in the collection
- [ ] No flavor/zone names hardcoded outside `src/game/cards.ts` / `src/game/zones.ts`
- [ ] `src/game/` has no React/DOM imports
- [ ] No private docs committed (`AGENTS.md`, `docs/*.md` stay local)
- [ ] Mobile-first: readable on a 360px phone screen

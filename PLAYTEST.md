# Playtest guide — V Cola: Collect & Clash

## How to run

Phone and laptop should be on the same Wi-Fi network:

```sh
npm run dev -- --host
```

Open the printed Network URL on the phone. The game is landscape-only; portrait shows a rotate-device gate. The stage minimum design width is defined by `STAGE_MIN_W` in `src/components/Stage.tsx`.

For the production build, run `npm run build` and then `npm run preview -- --host`.

Automated coverage: `npm run smoke` (with `npm run preview -- --port 4173` serving) plays English matches at the viewports defined in `scripts/smoke.mjs`, an Arabic match with resolution skipped, and checks the portrait gate. It fails on console errors, page overflow, or stuck states.

## Checklist

1. **Tap placement** — tap a hand card, then a zone. Lock In reflects the placed-card count.
2. **Drag placement** — drag a card into a zone. The ghost follows the pointer and the target zone highlights.
3. **Recall a card** — tap your placed card before locking. It returns to your hand and the Lock In count changes.
4. **Third-card guard** — try placing a third card in a round. The hand shakes, a notice explains the limit, and the card stays in hand.
5. **Timer timeout auto-place** — let the turn timer expire. A random unused card is placed in a random zone and the turn locks.
6. **Tie zones** — tie a zone or split zone wins. Tied zones count for nobody; a drawn match shows the draw result.
7. **Crowded zone** — place as many cards as the match permits into one zone. Cards remain within their strips and the zone pillar stays readable.
8. **Language and RTL** — switch to Arabic on the title screen and check the mirrored layout and complete translated text.
9. **Rotate to portrait** — rotate mid-match. The rotate gate appears; rotating back preserves the match.
10. **Resolution, review, replay, and rematch** — after the final round, step through or skip the resolution sequence, tap a zone to replay it, then rematch or return to the menu.

Check the landscape stage at its minimum, typical, and maximum design widths as defined in `src/components/Stage.tsx`. Also check `prefers-reduced-motion`, an empty collection with loaner cards, and a stocked collection.

## Known issues

None currently recorded. If you find one, note the viewport, language, and round/phase.

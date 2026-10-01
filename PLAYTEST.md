# Playtest guide — V Cola: Collect & Clash (landscape build)

## How to run

Phone + laptop on the same WiFi:

```sh
npm run dev -- --host
```

Open the printed Network URL on the phone (e.g. `http://192.168.1.5:5173`).
Landscape only: rotate the phone — portrait shows a "rotate your device" gate.
For the production build: `npm run build && npm run preview -- --host`.

Automated coverage: `npm run smoke` (needs `npm run preview -- --port 4173`
serving) plays full EN matches at 844×390 + 1920×1080, an AR match with the
resolution skipped, and the portrait gate — failing on console errors,
page overflow, or stuck states.

## Checklist (10 items)

1. **Tap placement** — tap a hand card, tap a zone. Card lands with a pop,
   Lock In counts `(1/2)` → `(2/2)`.
2. **Drag placement** — drag a card into a zone (mouse on laptop, finger on
   phone). Ghost follows the pointer; zone highlights on hover.
3. **Recall a card** — tap your placed card (× badge) before locking. It
   returns to hand; Lock In count drops.
4. **Third-card guard** — try placing a 3rd card in a round. Hand shakes,
   toast explains, nothing places.
5. **Timer timeout auto-place** — wait out the 60s ring (last 10s pulse red).
   A random unused card auto-places and the turn locks.
6. **Tie zones** — split zones 1-1-1 or tie a zone's totals. Tied zones show
   the tie badge and count for nobody; a drawn match shows "Match Drawn".
7. **6 cards in one zone** — both players stack COOL every round (2/round).
   All 12 minis stay inside the column, no scroll, pillar readable.
8. **Language switch mid-menu** — toggle EN/عربي on the title screen. Full
   RTL mirror: rails swap sides, Lock In flips, banner sentences stay whole.
9. **Rotate to portrait** — rotate mid-match. Rotate gate covers everything;
   rotate back and the match is untouched.
10. **Skip the resolution + rematch** — after round 3, tap the board to speed
    through Cool → Party → Energy, or Skip straight to the result. Rematch
    deals fresh hands; menu returns to the title screen.

Also try: empty collection (loaner hands) and starter-pack collection,
`prefers-reduced-motion` (sequence jumps to end states + fade).

## Known issues

- None open. If you find one, note viewport, language, and round/phase.

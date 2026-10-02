# V Cola: Collect & Clash — game-screen design system

## V Cola direction

Design this as a landscape game screen, not a website. The three zones are the focal point; the hand and turn action support them. Keep match information inside the game frame. Do not add website navigation, sidebars, dashboard panels, or a hero-page layout.

Use the project's dark arcade palette and readable brand typography. Keep contrast clear, controls easy to identify, and the board readable in English and Arabic. Use the `frontend-design` skill when making visual decisions.

## Tokens

The CSS custom properties in `src/index.css` are the source of truth. Reuse its color, shape, spacing, and motion tokens instead of introducing parallel values.

| Role | Token |
|---|---|
| Base surfaces | `--ink`, `--ink-2` |
| Brand accent | `--v-red`, `--v-red-deep` |
| Zone accents | `--cool`, `--party`, `--energy` |
| Result accents | `--gold`, `--good`, `--bad` |
| Shapes | `--r-card`, `--r-btn`, `--r-lane` |
| Spacing | `--space-xs` through `--space-3xl` |
| Motion | `--motion-micro`, `--motion-short`, `--motion-med`, `--motion-ease` |

## Typography

Use `Lilita One` for short display and game headings. Use the system sans stack for interface copy; it includes Cairo and Arabic fallbacks for RTL. Keep instructions and card names readable at the stage's scaled size. Do not use pixel fonts for game information.

## Combo color system

`src/game/effects.ts` defines which combo groups each flavor belongs to. `src/components/comboTheme.ts` maps those groups to the approved colors and derives solid or gradient frames. Keep membership derived from the effect definitions and colors mapped by group; do not create a per-card color map. `src/components/GameCard.tsx` is the shared renderer for cards in hand and on the board.

| Group | Color |
|---|---|
| Cola | `#38bdf8` |
| Citrus | `#a3e635` |
| Ingredient | `#fbbf24` |
| Berry | `#e879f9` |
| Solo | `#cbd5e1` |

A single group uses its solid color; multiple memberships blend into a gradient. The solo color identifies solo-effect membership. Visual membership does not by itself mean an effect condition is complete; effect rules remain in `src/game/`.

## Motion and accessibility

Use motion to clarify game actions such as placing, revealing, and resolving cards. Respect `prefers-reduced-motion`: skip or shorten nonessential movement and preserve the same information in the final state. Keep keyboard focus visible, support the app's RTL layout, and avoid motion that obscures the board or game text.

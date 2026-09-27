/**
 * Core game types — framework-agnostic.
 *
 * Per AGENTS.md, `src/game/` must stay free of React/DOM so match rules
 * are testable without a browser. See `docs/V_COLA_DESIGN.md` for rules.
 */

/** Product line a flavor belongs to (from the design doc's grouping). */
export type FlavorLine = 'super-soda' | 'vitamin-sparkling' | 'flavored-malt';

/**
 * A card = Flavor only.
 * No Power is stored on it (rolled fresh 1–5 every time it is played),
 * no effect, no rarity by default. See design doc §3.
 */
export interface Flavor {
  /** Stable kebab-case key, e.g. 'v-cola'. */
  readonly id: string;
  /** Display name, e.g. 'V Cola'. Single source of truth — do not hardcode elsewhere. */
  readonly name: string;
  /** Which V7 product line this flavor comes from. */
  readonly line: FlavorLine;
}

export type FlavorId = Flavor['id'];

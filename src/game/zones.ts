/**
 * Zone identities from design doc §4. Each zone's effect key lives here so
 * scoring keys off a single source — no zone names or effects hardcoded
 * anywhere else.
 */
export type ZoneEffect = 'stay-frosty' | 'more-the-merrier' | 'second-wind';

export interface Zone {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly effect?: ZoneEffect;
}

export const ZONES: readonly Zone[] = [
  { id: 'cool', name: 'COOL', tagline: 'Stay Frosty', effect: 'stay-frosty' },
  { id: 'party', name: 'PARTY', tagline: 'The More The Merrier', effect: 'more-the-merrier' },
  { id: 'energy', name: 'ENERGY', tagline: 'Second Wind', effect: 'second-wind' },
] as const;

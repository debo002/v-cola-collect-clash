/**
 * Zone identities from design doc §4 — names + taglines only.
 * Scoring effects and match logic land with the match module, not here.
 */
export interface Zone {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
}

export const ZONES: readonly Zone[] = [
  { id: 'cool', name: 'COOL', tagline: 'Stay Frosty' },
  { id: 'party', name: 'PARTY', tagline: 'The More The Merrier' },
  { id: 'energy', name: 'ENERGY', tagline: 'Second Wind' },
] as const;

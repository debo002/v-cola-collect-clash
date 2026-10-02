import type { ComboGroup } from '../game/effects';

/**
 * Combo-identification colors (UI only).
 * Membership comes from effects.ts (getCardGroups); this file only maps
 * each ComboGroup to its approved display color. Approved palette:
 * cola #38bdf8, citrus #a3e635, ingredient #fbbf24, berry #e879f9, solo #cbd5e1.
 * `solo` marks solo-effect cards (Pina alone / Cream cancel) — Cream Soda's
 * solid color is intentionally distinct from the four combo-group colors.
 */
export const COMBO_COLORS: Record<ComboGroup, string> = {
  cola: '#38bdf8',
  citrus: '#a3e635',
  ingredient: '#fbbf24',
  berry: '#e879f9',
  solo: '#cbd5e1',
};

/** Frame background: solid for 1 group, gradient for 2+. */
export function comboBackground(groups: readonly ComboGroup[]): string | undefined {
  if (groups.length === 0) return undefined;
  if (groups.length === 1) return COMBO_COLORS[groups[0]];
  const stops = groups.map((g) => COMBO_COLORS[g]).join(', ');
  return `linear-gradient(135deg, ${stops})`;
}

/** Alias used for the gradient-border layer (same value as the frame). */
export function comboBorder(groups: readonly ComboGroup[]): string | undefined {
  return comboBackground(groups);
}

/** First group color — glow + completed-combo outline stay single-hue. */
export function comboGlow(groups: readonly ComboGroup[]): string | undefined {
  if (groups.length === 0) return undefined;
  return COMBO_COLORS[groups[0]];
}

/** Thin outline color for a completed combo (first group color). */
export function comboOutline(group: ComboGroup): string {
  return COMBO_COLORS[group];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function mix(hex: string, target: [number, number, number], amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const m = (c: number, t: number) => Math.round(c + (t - c) * amount);
  return `rgb(${m(r, target[0])}, ${m(g, target[1])}, ${m(b, target[2])})`;
}

/**
 * Luminous card-art wash carrying the combo color(s); keep the can art clear
 * on the zone background instead of fading the card toward near-black.
 */
export function comboArtBackground(groups: readonly ComboGroup[]): string | undefined {
  if (groups.length === 0) return undefined;
  const ink: [number, number, number] = [10, 13, 22];
  if (groups.length === 1) {
    const tinted = mix(COMBO_COLORS[groups[0]], ink, 0.36);
    return `radial-gradient(circle at 50% 28%, ${tinted} 0%, #0a0d16 78%)`;
  }
  const stops = groups.map((g) => mix(COMBO_COLORS[g], ink, 0.34)).join(', ');
  return `linear-gradient(160deg, ${stops}), radial-gradient(circle at 50% 28%, rgba(10,13,22,0.2) 0%, #0a0d16 85%)`;
}

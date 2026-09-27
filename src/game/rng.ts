/** Injectable randomness so game logic stays deterministic in tests. */
export type Rng = () => number;

/** Random int in [0, n). Requires n > 0. */
export function intBelow(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** Fisher–Yates shuffle, returns a new array. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = intBelow(rng, i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export const MIN_POWER = 1;
export const MAX_POWER = 5;

/** Power (1–5), rolled fresh for every card in every match. */
export function rollPower(rng: Rng = Math.random): number {
  return MIN_POWER + intBelow(rng, MAX_POWER - MIN_POWER + 1);
}

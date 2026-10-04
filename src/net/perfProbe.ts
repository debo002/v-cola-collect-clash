/**
 * Zero-cost intent→view round-trip probe for the ?debug=1 overlay.
 * OnlineController notes intent sends and view receipts; the overlay reads
 * the last round trip. Module-level (no React) so any controller can use it.
 */
let lastIntentAt = 0;
let lastRttMs: number | null = null;

export function noteIntentSent(now: number): void {
  lastIntentAt = now;
}

export function noteViewReceived(now: number): void {
  if (lastIntentAt > 0) {
    lastRttMs = now - lastIntentAt;
    lastIntentAt = 0;
  }
}

export function lastIntentViewRtt(): number | null {
  return lastRttMs;
}

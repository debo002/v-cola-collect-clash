import { useState } from 'react';
import { FLAVOR_IDS, getFlavorById } from '../game/cards';
import { ownsFlavor, type Collection } from '../game/collection';
import type { FlavorId } from '../game/types';
import { GameCard } from '../components/GameCard';

/**
 * Scan stand-in until Phase 2 ships real QR/barcode/typed-code/camera
 * scanning (no scanning libraries before then). Simulates one unlock per
 * tap so the collect loop is playable end to end right now.
 */
const FUTURE_METHODS = [
  'QR code on the can (ZXing-js)',
  'Retail barcode EAN/UPC (ZXing-js)',
  'Typed numeric code',
  'Camera can recognition (TensorFlow.js)',
];

export function Scan({
  collection,
  onUnlock,
}: {
  collection: Collection;
  onUnlock: (id: FlavorId) => void;
}) {
  const [last, setLast] = useState<FlavorId | null>(null);

  function simulate() {
    const locked = FLAVOR_IDS.filter((id) => !ownsFlavor(collection, id));
    const pool = locked.length > 0 ? locked : [...FLAVOR_IDS];
    const pick = pool[Math.floor(Math.random() * pool.length)] as FlavorId;
    onUnlock(pick);
    setLast(pick);
  }

  const lastFlavor = last ? getFlavorById(last) : undefined;

  return (
    <section aria-label="Scan">
      <div className="section-head">
        <h2>Scan a can</h2>
      </div>
      <div className="scan-box">
        <p className="demo-note">Demo scanner — 1 tap = 1 flavor, like the real thing.</p>
        <button type="button" className="btn btn-primary lock-btn" onClick={simulate}>
          Simulate scan
        </button>
        {lastFlavor ? (
          <div className="scan-result">
            <GameCard flavor={lastFlavor} />
            <strong>Unlocked {lastFlavor.name}!</strong>
          </div>
        ) : null}
      </div>
      <h2 className="deck-pick-head">Coming in Phase 2</h2>
      <ul className="scan-future">
        {FUTURE_METHODS.map((m) => (
          <li key={m}>{m} — soon</li>
        ))}
      </ul>
      <p className="demo-note">
        Real scanning adds anti-spam rules (one-time codes or a 24h cooldown per flavor).
      </p>
    </section>
  );
}

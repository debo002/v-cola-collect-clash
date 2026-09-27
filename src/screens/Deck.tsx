import { useState } from 'react';
import { FLAVORS } from '../game/cards';
import { countOf, type Collection } from '../game/collection';
import { HAND_SIZE } from '../game/hands';
import type { FlavorId } from '../game/types';
import { getFlavorById } from '../game/cards';
import { GameCard } from '../components/GameCard';

/**
 * Custom battle deck: tap inventory cards to fill 6 slots.
 * Picks must be owned (duplicates need matching copy counts).
 * Empty slots auto-fill at match start — nothing stored but the picks.
 */
export function Deck({
  collection,
  picks,
  onChange,
}: {
  collection: Collection;
  picks: FlavorId[];
  onChange: (picks: FlavorId[]) => void;
}) {
  const [notice, setNotice] = useState('');

  function copiesPicked(id: string): number {
    return picks.filter((p) => p === id).length;
  }

  function add(id: FlavorId) {
    if (picks.length >= HAND_SIZE) {
      setNotice(`Deck is full (${HAND_SIZE} cards) — tap a slot to remove one first.`);
      return;
    }
    if (copiesPicked(id) >= countOf(collection, id)) {
      setNotice('Not enough owned copies — unlock more in Scan first.');
      return;
    }
    setNotice('');
    onChange([...picks, id]);
  }

  function removeAt(index: number) {
    setNotice('');
    onChange(picks.filter((_, i) => i !== index));
  }

  return (
    <section aria-label="Battle deck">
      <div className="section-head">
        <h2>
          Deck ({picks.length}/{HAND_SIZE})
        </h2>
        {picks.length > 0 ? (
          <button type="button" className="btn" onClick={() => onChange([])}>
            Clear
          </button>
        ) : null}
      </div>
      <div className="deck-slots">
        {Array.from({ length: HAND_SIZE }, (_, i) => {
          const id = picks[i];
          const flavor = id ? getFlavorById(id) : undefined;
          return flavor ? (
            <button
              key={i}
              type="button"
              className="deck-slot filled"
              onClick={() => removeAt(i)}
              aria-label={`Remove ${flavor.name} from deck`}
            >
              <GameCard flavor={flavor} />
            </button>
          ) : (
            <div key={i} className="deck-slot empty" aria-hidden="true">
              <span>{i + 1}</span>
            </div>
          );
        })}
      </div>
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      <h2 className="deck-pick-head">Tap owned cards to add them</h2>
      <div className="card-grid">
        {FLAVORS.map((flavor) => {
          const owned = countOf(collection, flavor.id);
          const used = copiesPicked(flavor.id);
          const available = owned - used > 0;
          return (
            <button
              key={flavor.id}
              type="button"
              className="deck-pick"
              disabled={!available}
              onClick={() => add(flavor.id)}
              aria-label={`Add ${flavor.name} to deck (owns ${owned})`}
            >
              <GameCard flavor={flavor} dimmed={!available} />
              <span className="deck-count">
                ×{owned}
                {used > 0 ? ` (${used} in deck)` : ''}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

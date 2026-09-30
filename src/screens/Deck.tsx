import { useState } from 'react';
import { FLAVORS, getFlavorById } from '../game/cards';
import { countOf, totalCopies, type Collection } from '../game/collection';
import { HAND_SIZE } from '../game/hands';
import type { FlavorId } from '../game/types';
import { GameCard } from '../components/GameCard';
import { useI18n } from '../i18n';

/**
 * Custom battle deck: tap inventory cards to fill 6 slots.
 * Each flavor must be UNIQUE in the deck (no duplicates allowed).
 * Empty slots auto-fill at match start — nothing stored but the picks.
 */
export function Deck({
  collection,
  picks,
  onChange,
  onResetCollection,
  onStarterPack,
}: {
  collection: Collection;
  picks: FlavorId[];
  onChange: (picks: FlavorId[]) => void;
  onResetCollection?: () => void;
  onStarterPack?: () => void;
}) {
  const { t } = useI18n();
  const [notice, setNotice] = useState('');
  const totalOwned = totalCopies(collection);

  function add(id: FlavorId) {
    if (picks.length >= HAND_SIZE) {
      setNotice(t.deckFull);
      return;
    }
    // Only unique flavors allowed in a deck!
    if (picks.includes(id)) {
      setNotice(t.deckUniqueOnly);
      return;
    }
    if (countOf(collection, id) <= 0) {
      setNotice(t.noCansDesc);
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
    <section aria-label="Battle deck" className="deck-container">
      <div className="section-head">
        <h2>
          {t.deckTitle} ({picks.length}/{HAND_SIZE})
        </h2>
        <div className="section-actions">
          {picks.length > 0 ? (
            <button type="button" className="btn btn-secondary" onClick={() => onChange([])}>
              {t.clearDeck}
            </button>
          ) : null}
          {totalOwned > 0 && onResetCollection ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (window.confirm('Reset collection to 0 cans?')) {
                  onResetCollection();
                  onChange([]);
                }
              }}
            >
              {t.resetTo0}
            </button>
          ) : null}
        </div>
      </div>

      <div className="deck-slots">
        {Array.from({ length: HAND_SIZE }, (_, i) => {
          const id = picks[i];
          const flavor = id ? getFlavorById(id) : undefined;
          const displayName = flavor ? t.flavors[flavor.id] || flavor.name : '';
          return flavor ? (
            <button
              key={i}
              type="button"
              className="deck-slot"
              onClick={() => removeAt(i)}
              aria-label={`Remove ${displayName} from deck`}
              title="Click to remove from deck"
            >
              <GameCard flavor={flavor} displayName={displayName} />
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

      {totalOwned === 0 ? (
        <div className="empty-collection-box">
          <h3>{t.noCansTitle}</h3>
          <p className="demo-note">{t.noCansDesc}</p>
          {onStarterPack ? (
            <button type="button" className="btn btn-primary" onClick={onStarterPack}>
              {t.starterPackBtn}
            </button>
          ) : null}
        </div>
      ) : null}

      <h3 className="deck-pick-head">
        {totalOwned === 0 ? t.flavorsToUnlock : t.tapOwnedToAdd}
      </h3>

      <div className="card-grid">
        {FLAVORS.map((flavor) => {
          const owned = countOf(collection, flavor.id);
          const alreadyInDeck = picks.includes(flavor.id);
          const available = owned > 0 && !alreadyInDeck;
          const displayName = t.flavors[flavor.id] || flavor.name;

          return (
            <button
              key={flavor.id}
              type="button"
              data-flavor={flavor.id}
              className={`deck-pick${alreadyInDeck ? ' in-deck' : ''}`}
              disabled={!available}
              onClick={() => add(flavor.id)}
              aria-label={`${displayName} (owns ${owned})${alreadyInDeck ? ' - In deck' : ''}`}
            >
              <GameCard
                flavor={flavor}
                displayName={displayName}
                dimmed={!available || alreadyInDeck}
              />
              <div className="deck-meta-row">
                <span className="deck-count">×{owned}</span>
                {alreadyInDeck ? (
                  <span className="deck-in-badge">✓ {t.inDeck}</span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

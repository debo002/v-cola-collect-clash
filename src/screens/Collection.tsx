import { FLAVORS } from '../game/cards';
import { countOf, type Collection } from '../game/collection';
import { GameCard } from '../components/GameCard';

/**
 * Demo collection manager (stand-in until scanning lands in Phase 2):
 * per-flavor copy steppers persisted to IndexedDB, plus unlock-all/reset.
 */
export function Collection({
  collection,
  onAdd,
  onRemove,
  onUnlockAll,
  onReset,
}: {
  collection: Collection;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onUnlockAll: () => void;
  onReset: () => void;
}) {
  return (
    <section aria-label="Collection">
      <div className="section-head">
        <h2>Collection</h2>
        <div className="section-actions">
          <button type="button" className="btn" onClick={onUnlockAll}>
            Unlock all
          </button>
          <button type="button" className="btn" onClick={onReset}>
            Reset
          </button>
        </div>
      </div>
      <div className="card-grid">
        {FLAVORS.map((flavor) => {
          const count = countOf(collection, flavor.id);
          return (
            <div key={flavor.id} className="collection-slot">
              <GameCard flavor={flavor} dimmed={count === 0} />
              <div className="stepper" aria-label={`${flavor.name} copies`}>
                <button
                  type="button"
                  className="btn step"
                  onClick={() => onRemove(flavor.id)}
                  disabled={count === 0}
                  aria-label={`Remove one ${flavor.name}`}
                >
                  −
                </button>
                <span className="count" aria-live="polite">
                  ×{count}
                </span>
                <button
                  type="button"
                  className="btn step"
                  onClick={() => onAdd(flavor.id)}
                  aria-label={`Add one ${flavor.name}`}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

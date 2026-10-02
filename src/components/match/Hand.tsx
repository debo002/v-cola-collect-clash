import type { PointerEvent as ReactPointerEvent } from 'react';
import { getFlavorById } from '../../game/cards';
import { getCardGroups } from '../../game/effects';
import type { HandCard } from '../../game/hands';
import type { FlavorId } from '../../game/types';
import { useI18n } from '../../i18n';
import { GameCard } from '../GameCard';

/**
 * Bottom dock: single card row + inline status line, with count + Lock In
 * stacked in a slim side column. The status line shows the hint by default
 * and the selected card's full effect text (wrapping, never ellipsis);
 * the dock sizes to fit it. All targets ≥56 stage px.
 */
export function Hand({
  visibleCards,
  selected,
  draggingIndex,
  shakeKey,
  handTitle,
  handTip,
  lockLabel,
  canLock,
  onCardPointerDown,
  onCardPointerMove,
  onCardPointerUp,
  onCardPointerCancel,
  onLock,
}: {
  visibleCards: readonly { card: HandCard; index: number }[];
  selected: number | null;
  draggingIndex: number | null;
  shakeKey: number;
  handTitle: string;
  handTip: string;
  lockLabel: string;
  canLock: boolean;
  onCardPointerDown: (e: ReactPointerEvent<HTMLButtonElement>, i: number) => void;
  onCardPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onCardPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onCardPointerCancel: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onLock: () => void;
}) {
  const { t } = useI18n();

  const selectedEntry = selected !== null ? visibleCards.find((v) => v.index === selected) : undefined;
  const selectedFlavor = selectedEntry ? getFlavorById(selectedEntry.card.flavor) : undefined;
  const selectedGroups = selectedFlavor ? getCardGroups(selectedFlavor.id as FlavorId) : [];

  return (
    <div className="hand-row">
      <div className="hand-main">
        <div
          key={shakeKey}
          className={`hand-fan count-${Math.min(visibleCards.length, 6)}${shakeKey > 0 ? ' shake-once' : ''}`}
          role="group"
          aria-label={handTitle}
        >
          {visibleCards.map(({ card: hc, index: i }) => {
            const flavor = getFlavorById(hc.flavor);
            if (!flavor) return null;
            const displayName = t.flavors[flavor.id] || flavor.name;
            const isSelected = selected === i;
            const isDragging = draggingIndex === i;
            const groups = getCardGroups(flavor.id as FlavorId);
            return (
              <button
                key={i}
                type="button"
                className={`fan-card${isSelected ? ' selected' : ''}${isDragging ? ' dragging' : ''}`}
                onPointerDown={(e) => onCardPointerDown(e, i)}
                onPointerMove={onCardPointerMove}
                onPointerUp={onCardPointerUp}
                onPointerCancel={onCardPointerCancel}
                onDragStart={(e) => e.preventDefault()}
            aria-label={`${displayName}, power ${hc.power}${isSelected ? ` — ${t.cardEffects[flavor.id]}` : ''}`}
                aria-pressed={isSelected}
              >
                <GameCard
                  flavor={flavor}
                  power={hc.power}
                  displayName={displayName}
                  selected={isSelected}
                  groups={groups}
                />
              </button>
            );
          })}
        </div>
      </div>
      <div className="dock-side">
        <span className="dock-count">{handTitle}</span>
        <p className="dock-line" role="status">
      {selectedFlavor && selectedGroups.length > 0 ? (
            <><strong>{t.flavors[selectedFlavor.id] || selectedFlavor.name}:</strong>{' '}{t.cardEffects[selectedFlavor.id]}</>
          ) : handTip}
        </p>
        <button
          type="button"
          className={`btn btn-primary lock-btn${!canLock ? ' disabled' : ''}`}
          disabled={!canLock}
          onClick={onLock}
        >
          {lockLabel}
        </button>
      </div>
    </div>
  );
}

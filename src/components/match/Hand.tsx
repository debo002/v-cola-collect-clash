import type { PointerEvent as ReactPointerEvent } from 'react';
import { getFlavorById } from '../../game/cards';
import type { HandCard } from '../../game/hands';
import { useI18n } from '../../i18n';
import { GameCard } from '../GameCard';

/** Bottom hand row: fan of unplaced cards + Lock In. All targets ≥56 stage px. */
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
  return (
    <div className="hand-row">
      <div className="hand-main">
        <div className="hand-header">
          <span className="hand-title">{handTitle}</span>
          <span className="hand-tip">{handTip}</span>
        </div>
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
                aria-label={`${displayName}, power ${hc.power}`}
                aria-pressed={isSelected}
              >
                <GameCard
                  flavor={flavor}
                  power={hc.power}
                  displayName={displayName}
                  selected={isSelected}
                />
              </button>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        className={`btn btn-primary lock-btn${!canLock ? ' disabled' : ''}`}
        disabled={!canLock}
        onClick={onLock}
      >
        {lockLabel}
      </button>
    </div>
  );
}

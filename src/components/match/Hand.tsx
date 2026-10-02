import { type PointerEvent as ReactPointerEvent } from 'react';
import { getFlavorById } from '../../game/cards';
import { getCardGroups } from '../../game/effects';
import type { HandCard } from '../../game/hands';
import type { FlavorId } from '../../game/types';
import { fmt, useI18n } from '../../i18n';
import { GameCard } from '../GameCard';
import { CardHoldPreview } from '../CardHoldPreview';

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
  onLongPress,
  onLock,
  drawPileCount,
  drawsRemaining = 0,
  drawnHandIndex = -1,
  drawAnimKey = 0,
  drawAnimating = false,
  onDraw,
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
  onLongPress: (i: number) => void;
  onLock: () => void;
  drawPileCount?: number;
  drawsRemaining?: number;
  drawnHandIndex?: number;
  drawAnimKey?: number;
  drawAnimating?: boolean;
  onDraw?: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="hand-row">
      {drawPileCount !== undefined ? (
        <div className="draw-pile-wrap">
          <button
            type="button"
            className={`draw-pile${drawsRemaining > 0 ? ' draw-ready' : ''}`}
            disabled={drawsRemaining <= 0 || drawPileCount <= 0 || drawAnimating}
            onClick={onDraw}
            aria-label={t.drawOne}
            title={t.drawOne}
          >
            <span className="draw-pile-mark">V7</span>
            <span className="draw-pile-tap">{t.drawOne}</span>
          </button>
          <span className="draw-pile-count">
            {fmt(t.drawPileCount, { remaining: drawsRemaining, count: drawPileCount })}
          </span>
        </div>
      ) : null}
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
                key={i === drawnHandIndex ? `${i}-draw-${drawAnimKey}` : i}
                type="button"
                className={`fan-card${isSelected ? ' selected' : ''}${isDragging ? ' dragging' : ''}${i === drawnHandIndex ? ' card-drawn-in' : ''}`}
                onPointerDown={(e) => {
                  onCardPointerDown(e, i);
                }}
                onPointerMove={onCardPointerMove}
                onPointerUp={(e) => {
                  onCardPointerUp(e);
                }}
                onPointerCancel={(e) => {
                  onCardPointerCancel(e);
                }}
                onDragStart={(e) => e.preventDefault()}
                aria-label={`${displayName}, power ${hc.power}`}
                aria-pressed={isSelected}
              >
                <CardHoldPreview
                  flavorId={flavor.id as FlavorId}
                  onLongPress={() => onLongPress(i)}
                >
                  <GameCard
                    flavor={flavor}
                    power={hc.power}
                    displayName={displayName}
                    selected={isSelected}
                    groups={groups}
                  />
                </CardHoldPreview>
              </button>
            );
          })}
        </div>
      </div>
      <div className="dock-side">
        <span className="dock-count">{handTitle}</span>
        <p className="dock-line" role="status">
          {handTip}
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

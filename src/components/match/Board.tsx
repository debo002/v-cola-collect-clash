import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { getFlavorById } from '../../game/cards';
import type { HandCard } from '../../game/hands';
import {
  MAX_PLACE,
  MIN_PLACE,
  type MatchState,
  type Player,
} from '../../game/match';
import type { ZoneResult } from '../../game/scoring';
import { ZONES } from '../../game/zones';
import { fmt, useI18n } from '../../i18n';
import { GameCard } from '../GameCard';
import { CrownIcon } from '../icons';
import { useStageScale } from '../Stage';
import { allUsedIndices, placedMap } from './boardUtils';
import { Hand } from './Hand';
import { ZoneColumn, ZoneIcon, type StripCard } from './ZoneColumn';

export interface LastRoundLine {
  zoneId: string;
  mine: number;
  foe: number;
}

/**
 * Landscape match board: left rail (standings + last round) | 3 zone
 * columns | right rail (rules) | bottom hand + Lock In.
 * Owns tap-select + drag state; game rules stay in QuickPlay/src/game.
 *
 * Hidden-info rule: foe current-round cards never render (not even a
 * placeholder) and unrevealed foe power never enters a displayed score.
 */
export function Board({
  match,
  player,
  names,
  displayRound,
  isRevealing,
  isMatchOver,
  results,
  winner,
  shakeKey,
  onPlace,
  onUnplace,
  onLock,
  onTooMany,
  onNextRound,
  onRematch,
  onReturnMenu,
}: {
  match: MatchState;
  player: Player;
  names: Record<Player, string>;
  displayRound: number;
  isRevealing: boolean;
  isMatchOver?: boolean;
  results?: ZoneResult[] | null;
  winner?: Player | null;
  shakeKey: number;
  onPlace: (handIndex: number, zone: string) => void;
  onUnplace: (handIndex: number) => void;
  onLock: () => void;
  onTooMany: () => void;
  onNextRound?: () => void;
  onRematch?: () => void;
  onReturnMenu?: () => void;
}) {
  const { t } = useI18n();
  const { scale } = useStageScale();
  const foe: Player = player === 'A' ? 'B' : 'A';
  const map = placedMap(match, player);
  const hand: readonly HandCard[] = match.hands[player];

  const allUsed = allUsedIndices(match, player);
  const visibleCards = hand
    .map((card, index) => ({ card, index }))
    .filter(({ index }) => !allUsed.has(index));

  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ handIndex: number; x: number; y: number } | null>(null);
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  const pointerState = useRef<{
    handIndex: number;
    startX: number;
    startY: number;
    pointerId: number;
    isDragging: boolean;
  } | null>(null);

  function zoneFromPoint(x: number, y: number): string | null {
    // elementFromPoint takes viewport (client) coords, which are already
    // outside the scaled stage's transform — no scale division needed here.
    // Scale IS needed for ghost sizing (see portal below).
    const el = document.elementFromPoint(x, y)?.closest('[data-zone]');
    return el?.getAttribute('data-zone') ?? null;
  }

  function handleZoneClick(zoneId: string) {
    if (isRevealing) return;
    if (selected === null) return;
    onPlace(selected, zoneId);
    setSelected(null);
  }

  function handleCardTap(i: number) {
    if (isRevealing) return;
    setSelected((prev) => (prev === i ? null : i));
  }

  function onCardPointerDown(e: ReactPointerEvent<HTMLButtonElement>, i: number) {
    if (isRevealing) return;
    pointerState.current = {
      handIndex: i,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      isDragging: false,
    };
  }

  function onCardPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const state = pointerState.current;
    if (!state) return;
    const dist = Math.hypot(e.clientX - state.startX, e.clientY - state.startY);
    if (!state.isDragging && dist > 7) {
      state.isDragging = true;
      try {
        e.currentTarget.setPointerCapture(state.pointerId);
      } catch {
        // Fallback to tap behavior.
      }
    }
    if (state.isDragging) {
      setDrag({ handIndex: state.handIndex, x: e.clientX, y: e.clientY });
      setHoverZone(zoneFromPoint(e.clientX, e.clientY));
    }
  }

  function endPointer(e: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const state = pointerState.current;
    if (!state) return;
    if (state.isDragging && !cancelled) {
      try {
        e.currentTarget.releasePointerCapture(state.pointerId);
      } catch {
        // Ignore.
      }
      const targetZone = zoneFromPoint(e.clientX, e.clientY);
      if (targetZone) {
        // Third-card guard mirrors tap: shake + toast instead of placing.
        const alreadyPlaced = placedMap(match, player);
        if (!alreadyPlaced.has(state.handIndex) && alreadyPlaced.size >= MAX_PLACE) {
          onTooMany();
        } else {
          onPlace(state.handIndex, targetZone);
          setSelected(null);
        }
      }
      setDrag(null);
      setHoverZone(null);
    } else if (!state.isDragging && !cancelled) {
      handleCardTap(state.handIndex);
    }
    if (cancelled) {
      setDrag(null);
      setHoverZone(null);
    }
    pointerState.current = null;
  }

  const onCardPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => endPointer(e, false);
  const onCardPointerCancel = (e: ReactPointerEvent<HTMLButtonElement>) => endPointer(e, true);

  const placedCount = map.size;
  const canLock = placedCount >= MIN_PLACE;

  const zoneRules: Record<string, string> = {
    cool: t.zoneCoolRule,
    party: t.zonePartyRule,
    energy: t.zoneEnergyRule,
  };

  interface ZoneView {
    foeCards: StripCard[];
    myCards: StripCard[];
    foeScore: number;
    myScore: number;
    leader: Player | null;
  }

  const views = new Map<string, ZoneView>();
  // Last completed round for the rail log (placing N -> N-1; reveal shows N).
  const lastRoundIdx = isRevealing ? displayRound - 1 : displayRound - 2;
  const lastLines: LastRoundLine[] = [];

  for (const z of ZONES) {
    const foeCards: StripCard[] = [];
    const myCards: StripCard[] = [];
    let myScore = 0;
    let foeScore = 0;

    match.boards.forEach((board, bi) => {
      const side = board[z.id];
      if (!side) return;
      const isCurrent = bi === match.round - 1;
      for (const c of side[player]) {
        const hc = match.hands[player][c.handIndex];
        const flavor = hc ? getFlavorById(hc.flavor) : undefined;
        if (!flavor || !hc) continue;
        myCards.push({
          key: `m-${bi}-${c.handIndex}`,
          handIndex: c.handIndex,
          flavorId: hc.flavor,
          power: hc.power,
          recallable: !isRevealing && isCurrent,
        });
        myScore += hc.power;
      }
      for (const c of side[foe]) {
        // Pass-and-play fairness: foe current-round picks stay fully hidden
        // during a placing turn — not even rendered, and never scored.
        if (!isRevealing && isCurrent) continue;
        const flavor = getFlavorById(c.flavor);
        if (!flavor) continue;
        foeCards.push({
          key: `f-${bi}-${c.handIndex}`,
          handIndex: c.handIndex,
          flavorId: c.flavor,
          power: c.power,
          recallable: false,
        });
        if (c.power != null) foeScore += c.power;
      }
    });

    const zResult = results?.find((r) => r.zoneId === z.id);
    if (zResult) {
      myScore = zResult.totals[player];
      foeScore = zResult.totals[foe];
    }
    views.set(z.id, {
      foeCards,
      myCards,
      foeScore,
      myScore,
      leader: myScore === foeScore ? null : myScore > foeScore ? player : foe,
    });
  }

  if (lastRoundIdx >= 0 && match.boards[lastRoundIdx]) {
    for (const z of ZONES) {
      const side = match.boards[lastRoundIdx][z.id];
      if (!side) continue;
      let mine = 0;
      let theirs = 0;
      for (const c of side[player]) mine += c.power ?? 0;
      for (const c of side[foe]) theirs += c.power ?? 0;
      lastLines.push({ zoneId: z.id, mine, foe: theirs });
    }
  }

  // Keep selection valid after recalls.
  const effectiveSelected = selected !== null && visibleCards.some((v) => v.index === selected) ? selected : null;

  // Drag ghost: portalled to document.body so it escapes the scaled stage
  // (fixed positioning breaks inside a transformed ancestor). Sized in
  // on-screen px (stage px × scale) to match the board cards.
  const ghostFlavor =
    drag !== null ? getFlavorById(hand[drag.handIndex]?.flavor ?? '') : undefined;

  return (
    <div className="board">
      <div className="match-main">
      <aside className="rail rail-left" aria-label={t.railStandings}>
        <div className="rail-block">
          <h3 className="rail-title">{t.railStandings}</h3>
          <div className="stand-row you">
            <strong>{names[player]}</strong>
            <span>
              {ZONES.filter((z) => views.get(z.id)?.leader === player).length} ◆
            </span>
          </div>
          <div className="stand-row opp">
            <strong>{names[foe]}</strong>
            <span>{ZONES.filter((z) => views.get(z.id)?.leader === foe).length} ◆</span>
          </div>
          <ul className="leader-dots">
            {ZONES.map((z) => {
              const lead = views.get(z.id)?.leader;
              return (
                <li key={z.id} className="leader-dot">
                  <ZoneIcon zoneId={z.id} size={16} />
                  <span>{lead ? names[lead] : '–'}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="rail-block">
          <h3 className="rail-title">
            {t.railLastRound}
            {lastRoundIdx >= 0 ? ` ${lastRoundIdx + 1}` : ''}
          </h3>
          {lastLines.length > 0 ? (
            <ul className="last-lines">
              {lastLines.map((l) => (
                <li key={l.zoneId}>
                  <ZoneIcon zoneId={l.zoneId} size={14} />
                  <span>
                    {l.mine}–{l.foe}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rail-muted">{t.noHistory}</p>
          )}
        </div>
      </aside>

      <div className="zones-row">
        {ZONES.map((z) => {
          const v = views.get(z.id);
          if (!v) return null;
          const zResult = results?.find((r) => r.zoneId === z.id);
          return (
            <ZoneColumn
              key={z.id}
              zoneId={z.id}
              zoneName={z.name}
              zoneRule={zoneRules[z.id] ?? ''}
              foeCards={v.foeCards}
              myCards={v.myCards}
              foeScore={v.foeScore}
              myScore={v.myScore}
              dropReady={!isRevealing && effectiveSelected !== null}
              dropTarget={!isRevealing && hoverZone === z.id}
              spotlight={false}
              dimmed={false}
              victory={zResult?.winner === player}
              tapPrompt={!isRevealing && effectiveSelected !== null ? t.tapZoneToPlace : null}
              onZoneClick={handleZoneClick}
              onRecall={(i) => onUnplace(i)}
            />
          );
        })}
      </div>

      <aside className="rail rail-right" aria-label={t.railRules}>
        <h3 className="rail-title">{t.railRules}</h3>
        <ul className="rule-lines">
          {ZONES.map((z) => (
            <li key={z.id} className={`rule-line rule-${z.id}`} title={`${z.name} ${zoneRules[z.id]}`}>
              <ZoneIcon zoneId={z.id} size={16} />
              <span>
                <strong>{z.name}</strong> {zoneRules[z.id]}
              </span>
            </li>
          ))}
        </ul>
        {!isRevealing ? (
          <p className="rail-muted">{t.scoresAtEnd}</p>
        ) : null}
        </aside>
      </div>

      {!isRevealing ? (
        <Hand
          visibleCards={visibleCards}
          selected={effectiveSelected}
          draggingIndex={drag?.handIndex ?? null}
          shakeKey={shakeKey}
          handTitle={`${t.yourHand} (${visibleCards.length})`}
          handTip={effectiveSelected !== null ? t.tapZoneToPlace : t.tapToPlaceHint}
          lockLabel={
            canLock ? fmt(t.lockInCount, { placed: placedCount }) : t.needOne
          }
          canLock={canLock}
          onCardPointerDown={onCardPointerDown}
          onCardPointerMove={onCardPointerMove}
          onCardPointerUp={onCardPointerUp}
          onCardPointerCancel={onCardPointerCancel}
          onLock={onLock}
        />
      ) : null}

      {drag !== null && ghostFlavor && hand[drag.handIndex]
        ? createPortal(
            <div
              className="drag-ghost-card"
              style={{
                left: `${drag.x}px`,
                top: `${drag.y}px`,
                width: `${88 * scale}px`,
              }}
              aria-hidden="true"
            >
              <GameCard
                flavor={ghostFlavor}
                power={hand[drag.handIndex].power}
                displayName={t.flavors[ghostFlavor.id] || ghostFlavor.name}
              />
            </div>,
            document.body
          )
        : null}

      {isRevealing ? (
        <div className="reveal-overlay-banner">
          {isMatchOver ? (
            <div className="reveal-content-card match-over-card">
              <div className="winner-crown">
                <CrownIcon size={36} />
              </div>
              <h3 className="winner-title">
                {winner ? fmt(t.wonMajority, { name: names[winner] }) : t.matchDrawn}
              </h3>
              <p className="winner-subtitle">{winner ? t.winsTheMatch : t.allTied}</p>
              <div className="reveal-actions-row">
                <button type="button" className="btn btn-primary btn-lg" onClick={onRematch}>
                  {t.rematch}
                </button>
                <button type="button" className="btn btn-secondary btn-lg" onClick={onReturnMenu}>
                  {t.returnToMenu}
                </button>
              </div>
            </div>
          ) : (
            <div className="reveal-content-card round-revealed-card">
              <h3 className="round-revealed-title">{t.roundRevealed}</h3>
              <p className="round-revealed-note">{t.scoresAtEnd}</p>
              <button
                type="button"
                className="btn btn-primary btn-lg lock-btn"
                onClick={onNextRound}
              >
                {t.nextRound} {match.round})
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

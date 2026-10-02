import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { getFlavorById } from '../../game/cards';
import { getCardGroups } from '../../game/effects';
import type { HandCard } from '../../game/hands';
import type { FlavorId } from '../../game/types';
import { MAX_PLACE, MIN_PLACE, type MatchState, type Player } from '../../game/match';
import type { ZoneExplanation, ZoneResult } from '../../game/scoring';
import { ZONES } from '../../game/zones';
import { fmt, useI18n } from '../../i18n';
import { GameCard } from '../GameCard';
import { useStageScale } from '../Stage';
import { allUsedIndices, buildZoneViews, placedMap, type StripCard } from './boardUtils';
import { Hand } from './Hand';
import { ResolutionOverlay } from './ResolutionOverlay';
import { ZoneColumn } from './ZoneColumn';
import { getSideHighlight, isCreamCancelled } from './comboHighlight';

/**
 * Landscape match board: 3 full-width zone columns + bottom hand + Lock In.
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
  explanations,
}: {
  match: MatchState;
  player: Player;
  names: Record<Player, string>;
  displayRound: number;
  isRevealing: boolean;
  isMatchOver?: boolean;
  results?: ZoneResult[] | null;
  winner?: Player | null;
  /** Match-over only: pure explainZone data drives the resolution sequence. */
  explanations?: readonly ZoneExplanation[] | null;
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
    // Window-level move/up: drop tracking must survive the pointer leaving
    // the card (and must not depend on setPointerCapture, which synthetic
    // and some mobile flows don't honor). Cleaned up on up/cancel.
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerCancel);
  }

  function detachWindowPointer() {
    window.removeEventListener('pointermove', onWindowPointerMove);
    window.removeEventListener('pointerup', onWindowPointerUp);
    window.removeEventListener('pointercancel', onWindowPointerCancel);
  }

  function onWindowPointerMove(e: PointerEvent) {
    const state = pointerState.current;
    if (!state || e.pointerId !== state.pointerId) return;
    const dist = Math.hypot(e.clientX - state.startX, e.clientY - state.startY);
    if (!state.isDragging && dist <= 7) return;
    state.isDragging = true;
    setDrag({ handIndex: state.handIndex, x: e.clientX, y: e.clientY });
    setHoverZone(zoneFromPoint(e.clientX, e.clientY));
  }

  function onWindowPointerUp(e: PointerEvent) {
    const state = pointerState.current;
    if (!state || e.pointerId !== state.pointerId) return;
    detachWindowPointer();
    pointerState.current = null;
    if (state.isDragging) {
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
    } else {
      handleCardTap(state.handIndex);
    }
  }

  function onWindowPointerCancel(e: PointerEvent) {
    const state = pointerState.current;
    if (!state || e.pointerId !== state.pointerId) return;
    detachWindowPointer();
    pointerState.current = null;
    setDrag(null);
    setHoverZone(null);
  }

  // Button-level move/up stay as no-op fallbacks (window owns the gesture).
  function onCardPointerMove() {}

  function onCardPointerUp() {}

  function onCardPointerCancel() {}

  // Never leak window listeners (or a stale press) across turns/unmount.
  useEffect(
    () => () => {
      detachWindowPointer();
      pointerState.current = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

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
  }

  const views = new Map<string, ZoneView>();

  // Shared strip builder (hidden-info rule inside): foe current-round
  // picks are skipped entirely unless revealing.
  const rawViews = buildZoneViews(match, player, foe, {
    foeVisible: isRevealing,
    recallable: !isRevealing,
  });
  for (const z of ZONES) {
    const raw = rawViews.get(z.id);
    if (!raw) continue;
    // If the match is over and scored, show official totals.
    const zResult = results?.find((r) => r.zoneId === z.id);
    const myScore = zResult ? zResult.totals[player] : raw.myBase;
    const foeScore = zResult ? zResult.totals[foe] : raw.foeBase;
    views.set(z.id, {
      foeCards: raw.foeCards,
      myCards: raw.myCards,
      foeScore,
      myScore,
    });
  }

  // Keep selection valid after recalls.
  const effectiveSelected =
    selected !== null && visibleCards.some((v) => v.index === selected) ? selected : null;

  // Drag ghost: portalled to document.body so it escapes the scaled stage
  // (fixed positioning breaks inside a transformed ancestor). Sized in
  // on-screen px (stage px × scale) to match the board cards.
  const ghostFlavor = drag !== null ? getFlavorById(hand[drag.handIndex]?.flavor ?? '') : undefined;

  // Match over: round-3 resolution animation and match review are ONE screen.
  // The overlay owns sequence → review → per-zone replay internally and stays
  // mounted on the same board; there is no separate match-over layout.
  if (isMatchOver && explanations && explanations.length > 0) {
    return (
      <div className="board">
        <div className="match-main resolution-main">
          <ResolutionOverlay
            match={match}
            player={player}
            names={names}
            explanations={explanations}
            winner={winner ?? null}
            onRematch={onRematch}
            onReturnMenu={onReturnMenu}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="board">
      {isRevealing && !isMatchOver ? (
        <div className="thin-banner" role="status">
          <span className="resolution-text">
            {fmt(t.roundN, { n: displayRound })} — {t.roundRevealed}
          </span>
        </div>
      ) : null}
      <div className="match-main zones-full">
        <div className="zones-row">
          {ZONES.map((z, zi) => {
            const v = views.get(z.id);
            if (!v) return null;
            const zResult = results?.find((r) => r.zoneId === z.id);
            const myHi = getSideHighlight(v.myCards.map((c) => c.flavorId as FlavorId));
            const foeHi = getSideHighlight(v.foeCards.map((c) => c.flavorId as FlavorId));
            const cancelled = isCreamCancelled(v.myCards.map((c) => c.flavorId as FlavorId), v.foeCards.map((c) => c.flavorId as FlavorId));
            const zoneEffectChips = cancelled ? [] : [
              ...myHi.completed.filter((e) => e.group !== 'citrus').map((e, i) => ({ key: `m-${e.group}-${i}`, side: 'mine' as const, label: e.chip })),
              ...foeHi.completed.filter((e) => e.group !== 'citrus').map((e, i) => ({ key: `f-${e.group}-${i}`, side: 'foe' as const, label: e.chip })),
            ];
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
                zoneEffectChips={zoneEffectChips}
                stagger={isRevealing && !isMatchOver ? zi * 120 : null}
                tapPrompt={!isRevealing && effectiveSelected !== null ? t.tapZoneToPlace : null}
                onZoneClick={handleZoneClick}
                onRecall={(i) => onUnplace(i)}
              />
            );
          })}
        </div>
      </div>

      {!isRevealing ? (
        <Hand
          visibleCards={visibleCards}
          selected={effectiveSelected}
          draggingIndex={drag?.handIndex ?? null}
          shakeKey={shakeKey}
          handTitle={`${t.yourHand} (${visibleCards.length})`}
          handTip={effectiveSelected !== null ? t.tapZoneToPlace : t.tapToPlaceHint}
          lockLabel={canLock ? fmt(t.lockInCount, { placed: placedCount }) : t.needOne}
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
                groups={getCardGroups(ghostFlavor.id as FlavorId)}
              />
            </div>,
            document.body
          )
        : null}

      {isRevealing && !isMatchOver ? (
        <div className="hand-row reveal-dock">
          <span className="dock-hint">{t.scoresAtEnd}</span>
          <button
            type="button"
            className="btn btn-primary lock-btn"
            onClick={onNextRound}
          >
            {t.nextRound} {match.round})
          </button>
        </div>
      ) : null}
    </div>
  );
}

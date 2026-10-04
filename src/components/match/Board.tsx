import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getFlavorById } from '../../game/cards';
import type { HandCard } from '../../game/hands';
import type { FlavorId } from '../../game/types';
import { MAX_PLACE, MIN_PLACE, type Player } from '../../game/match';
import type { PlayerView } from '../../game/controller';
import type { ZoneExplanation, ZoneResult } from '../../game/scoring';
import { ZONES } from '../../game/zones';
import { fmt, useI18n } from '../../i18n';
import { GameCard } from '../GameCard';
import { cardGroups } from '../comboTheme';
import { useStageScale } from '../Stage';
import {
  allUsedIndicesFromView,
  buildZoneViewsFromView,
  placedMapFromView,
  type StripCard,
} from './boardUtils';
import { Hand } from './Hand';
import { lockButton, nextRoundButton } from './lockLabels';
import { ResolutionOverlay } from './ResolutionOverlay';
import { ZoneColumn } from './ZoneColumn';
import { getSideHighlight, isCreamCancelled } from './comboHighlight';

/**
 * Button-level move/up stay as no-op fallbacks (window owns the gesture).
 * Module-stable so memoized Hand skips per-frame re-renders during drags.
 */
function noopPointerHandler(): void {}

/**
 * Landscape match board: 3 full-width zone columns + bottom hand + Lock In.
 * Owns tap-select + drag state; game rules stay in src/game via controller.
 *
 * Hidden-info rule: the view carries NOTHING about the opponent's current
 * round (no cards, no backs, no counts, no zone highlights, no lock status).
 */
export function Board({
  view,
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
  drawPileCount,
  drawsRemaining = 0,
  drawAnimKey = 0,
  drawnHandIndex = -1,
  drawAnimating = false,
  onDraw,
  onNextRound,
  awaitingOpponent = false,
  readyCountdown,
  onRematch,
  onReturnMenu,
  explanations,
}: {
  view: PlayerView;
  names: Record<Player, string>;
  displayRound: number;
  isRevealing: boolean;
  isMatchOver?: boolean;
  results?: readonly ZoneResult[] | null;
  winner?: Player | null;
  /** Match-over only: pure explainZone data drives the resolution sequence. */
  explanations?: readonly ZoneExplanation[] | null;
  shakeKey: number;
  onPlace: (handIndex: number, zone: string) => void;
  onUnplace: (handIndex: number) => void;
  onLock: () => void;
  onTooMany: () => void;
  drawPileCount?: number;
  drawsRemaining?: number;
  drawAnimKey?: number;
  drawnHandIndex?: number;
  drawAnimating?: boolean;
  onDraw?: () => void;
  onNextRound?: () => void;
  /** Ready latched, waiting for the opponent (reveal dock goes disabled). */
  awaitingOpponent?: boolean;
  /** Auto-advance countdown element shown beside the waiting button. */
  readyCountdown?: ReactNode;
  onRematch?: () => void;
  onReturnMenu?: () => void;
}) {
  const { t } = useI18n();
  const { scale } = useStageScale();
  const player: Player = view.seat;
  const foe: Player = player === 'A' ? 'B' : 'A';
  // Derived per render from the view: memoized on the view identity so
  // pointermove drag frames (same view, new drag state) reuse the same
  // array/set refs and memoized ZoneColumn/Hand skip reconciliation.
  const map = useMemo(() => placedMapFromView(view), [view]);
  const hand: readonly HandCard[] = view.hand;

  const allUsed = useMemo(() => allUsedIndicesFromView(view), [view]);
  const visibleCards = useMemo(
    () => hand.map((card, index) => ({ card, index })).filter(({ index }) => !allUsed.has(index)),
    [hand, allUsed]
  );

  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ handIndex: number; x: number; y: number } | null>(null);
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  const pointerState = useRef<{
    handIndex: number;
    startX: number;
    startY: number;
    pointerId: number;
    isDragging: boolean;
    longPressed: boolean;
  } | null>(null);
  const rafPending = useRef(false);
  const rafId = useRef(0);

  /** Drop a drag frame scheduled but not yet fired (release beat the frame). */
  const cancelDragFrame = useCallback(() => {
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = 0;
    }
    rafPending.current = false;
  }, []);
  // Latest game values for the window-level pointer handlers below. Those
  // handlers are stable ([]) so memoized Hand/ZoneColumn keep prop identity
  // across drag frames; they read the live game state through this ref
  // instead of closing over a stale render.
  const live = useRef({ view, onPlace, onTooMany, isRevealing, drawPileCount, drawsRemaining });
  live.current = { view, onPlace, onTooMany, isRevealing, drawPileCount, drawsRemaining };
  const detachRef = useRef<() => void>(() => {});

  function zoneFromPoint(x: number, y: number): string | null {
    // elementFromPoint takes viewport (client) coords, which are already
    // outside the scaled stage's transform — no scale division needed here.
    // Scale IS needed for ghost sizing (see portal below).
    const el = document.elementFromPoint(x, y)?.closest('[data-zone]');
    return el?.getAttribute('data-zone') ?? null;
  }

  // Stable prop identity for memoized ZoneColumn: without this every
  // pointermove drag frame re-renders all three columns (ResizeObserver
  // measurements + combo highlight recompute per column per frame).
  const handleZoneClick = useCallback(
    (zoneId: string) => {
      if (isRevealing || (drawPileCount !== undefined && drawsRemaining > 0)) return;
      if (selected === null) return;
      onPlace(selected, zoneId);
      setSelected(null);
    },
    [isRevealing, drawPileCount, drawsRemaining, selected, onPlace]
  );

  const onWindowPointerMove = useCallback((e: PointerEvent) => {
    const state = pointerState.current;
    if (!state || e.pointerId !== state.pointerId) return;
    const dist = Math.hypot(e.clientX - state.startX, e.clientY - state.startY);
    if (!state.isDragging && dist <= 7) return;
    state.isDragging = true;
    // rAF-throttle: pointermove can fire >60/s; one Board update per frame
    // is enough (also rate-limits the elementFromPoint layout per move).
    if (rafPending.current) return;
    rafPending.current = true;
    const x = e.clientX;
    const y = e.clientY;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0;
      rafPending.current = false;
      // Release (or a newer press) already ended this drag: never
      // resurrect the ghost after the drop cleared it.
      if (pointerState.current !== state) return;
      setDrag({ handIndex: state.handIndex, x, y });
      const zone = zoneFromPoint(x, y);
      // Only re-render when the hovered zone actually changes; the full
      // Board re-render triggers ResizeObserver work in every ZoneColumn.
      setHoverZone((prev) => (prev === zone ? prev : zone));
    });
  }, []);

  const onWindowPointerUp = useCallback(
    (e: PointerEvent) => {
      const state = pointerState.current;
      if (!state || e.pointerId !== state.pointerId) return;
      detachRef.current();
      cancelDragFrame();
      pointerState.current = null;
      const L = live.current;
      if (state.isDragging) {
        const targetZone = zoneFromPoint(e.clientX, e.clientY);
        if (targetZone) {
          // Third-card guard mirrors tap: shake + toast instead of placing.
          const alreadyPlaced = placedMapFromView(L.view);
          if (
            !alreadyPlaced.has(state.handIndex) &&
            alreadyPlaced.size >= (L.view.config.maxPlacedPerRound ?? MAX_PLACE)
          ) {
            L.onTooMany();
          } else {
            L.onPlace(state.handIndex, targetZone);
            setSelected(null);
          }
        }
        setDrag(null);
        setHoverZone(null);
      } else if (
        !state.longPressed &&
        !L.isRevealing &&
        !(L.drawPileCount !== undefined && L.drawsRemaining > 0)
      ) {
        const i = state.handIndex;
        setSelected((prev) => (prev === i ? null : i));
      }
    },
    [cancelDragFrame]
  );

  const onWindowPointerCancel = useCallback(
    (e: PointerEvent) => {
      const state = pointerState.current;
      if (!state || e.pointerId !== state.pointerId) return;
      detachRef.current();
      cancelDragFrame();
      pointerState.current = null;
      setDrag(null);
      setHoverZone(null);
    },
    [cancelDragFrame]
  );

  // Stable prop identity for memoized Hand: reads only refs + setState,
  // so it never goes stale and never breaks Hand's memo across frames.
  const onCardPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, i: number) => {
      const L = live.current;
      if (L.isRevealing || (L.drawPileCount !== undefined && L.drawsRemaining > 0)) return;
      pointerState.current = {
        handIndex: i,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        isDragging: false,
        longPressed: false,
      };
      // Window-level move/up: drop tracking must survive the pointer leaving
      // the card (and must not depend on setPointerCapture, which synthetic
      // and some mobile flows don't honor). Cleaned up on up/cancel.
      window.addEventListener('pointermove', onWindowPointerMove);
      window.addEventListener('pointerup', onWindowPointerUp);
      window.addEventListener('pointercancel', onWindowPointerCancel);
    },
    [onWindowPointerMove, onWindowPointerUp, onWindowPointerCancel]
  );

  // Assigned each commit (no cleanup): the stable handlers above never
  // change identity, so this just refreshes the same three references.
  useEffect(() => {
    detachRef.current = () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerCancel);
    };
  });

  // Never leak window listeners, a stale press, or a pending drag frame
  // across turns/unmount.
  useEffect(
    () => () => {
      detachRef.current();
      cancelDragFrame();
      pointerState.current = null;
    },
    [cancelDragFrame]
  );

  const placedCount = map.size;
  const drawingRequired = drawPileCount !== undefined && drawsRemaining > 0;
  // Empty hand (all cards spent in earlier rounds): the engine auto-locked
  // this seat — say so instead of "place at least 1".
  const nothingLeft = hand.length - allUsed.size <= 0;
  const canLock = placedCount >= MIN_PLACE && !drawingRequired;
  const maxPlaced = view.config.maxPlacedPerRound ?? MAX_PLACE;
  // Latched pressed state comes from the view (survives reload/reconnect).
  const lock = lockButton(t, {
    locked: view.locks[player],
    canLock,
    placedCount,
    maxPlaced,
    normalTip: '',
  });

  const zoneRules: Record<string, string> = {
    cool: t.zoneCoolRule,
    party: t.zonePartyRule,
    energy: t.zoneEnergyRule,
  };

  interface ZoneModel {
    zoneId: string;
    foeCards: StripCard[];
    myCards: StripCard[];
    foeScore: number;
    myScore: number;
    zoneEffectChips: readonly { key: string; side: 'mine' | 'foe'; label: string }[];
    victory: boolean;
    hasResult: boolean;
  }

  // Memoized per-zone models (cards, scores, chips): drag moves and other
  // parent updates reuse them, so memoized ZoneColumns skip reconciliation.
  const zoneModels: ZoneModel[] = useMemo(() => {
    const rawViews = buildZoneViewsFromView(view, {
      foeVisible: isRevealing,
      recallable: !isRevealing,
    });
    return ZONES.map((z) => {
      const raw = rawViews.get(z.id);
      const zResult = results?.find((r) => r.zoneId === z.id);
      const myScore = zResult ? zResult.totals[player] : (raw?.myBase ?? 0);
      const foeScore = zResult ? zResult.totals[foe] : (raw?.foeBase ?? 0);
      const myCards = raw?.myCards ?? [];
      const foeCards = raw?.foeCards ?? [];
      const myFlavors = myCards.map((c) => c.flavorId as FlavorId);
      const foeFlavors = foeCards.map((c) => c.flavorId as FlavorId);
      const myHi = getSideHighlight(myFlavors);
      const foeHi = getSideHighlight(foeFlavors);
      const cancelled = isCreamCancelled(myFlavors, foeFlavors);
      const zoneEffectChips = cancelled
        ? []
        : [
            ...myHi.completed
              .filter((e) => e.group !== 'citrus')
              .map((e, i) => ({
                key: `m-${e.group}-${i}`,
                side: 'mine' as const,
                label: e.chip,
              })),
            ...foeHi.completed
              .filter((e) => e.group !== 'citrus')
              .map((e, i) => ({
                key: `f-${e.group}-${i}`,
                side: 'foe' as const,
                label: e.chip,
              })),
          ];
      return {
        zoneId: z.id,
        foeCards,
        myCards,
        foeScore,
        myScore,
        zoneEffectChips,
        victory: zResult?.winner === player,
        hasResult: zResult !== undefined,
      };
    });
  }, [view, isRevealing, results, player, foe]);

  const handleRecall = useCallback((i: number) => onUnplace(i), [onUnplace]);

  // Stable prop identity for memoized Hand (hold-preview tap suppression).
  const handleLongPress = useCallback((i: number) => {
    if (pointerState.current?.handIndex === i) pointerState.current.longPressed = true;
  }, []);

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
            view={view}
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
          {zoneModels.map((v, zi) => {
            const z = ZONES[zi];
            if (!z) return null;
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
                dropReady={!isRevealing && !drawingRequired && effectiveSelected !== null}
                dropTarget={!isRevealing && !drawingRequired && hoverZone === z.id}
                spotlight={false}
                dimmed={false}
                victory={v.victory}
                zoneEffectChips={v.zoneEffectChips}
                stagger={isRevealing && !isMatchOver ? zi * 220 : null}
                onZoneClick={handleZoneClick}
                onRecall={handleRecall}
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
          handTip={
            view.locks[player] && lock.tip !== ''
              ? lock.tip
              : drawingRequired
                ? t.drawTapHint
                : nothingLeft
                  ? t.noCardsWaiting
                  : effectiveSelected !== null
                    ? t.tapZoneToPlace
                    : t.tapToPlaceHint
          }
          lockLabel={lock.label}
          canLock={!lock.disabled}
          drawPileCount={drawPileCount}
          drawsRemaining={drawsRemaining}
          drawAnimKey={drawAnimKey}
          drawnHandIndex={drawnHandIndex}
          drawAnimating={drawAnimating}
          onDraw={onDraw}
          onCardPointerDown={onCardPointerDown}
          onCardPointerMove={noopPointerHandler}
          onCardPointerUp={noopPointerHandler}
          onCardPointerCancel={noopPointerHandler}
          onLongPress={handleLongPress}
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
                groups={cardGroups(ghostFlavor.id as FlavorId)}
              />
            </div>,
            document.body
          )
        : null}

      {isRevealing && !isMatchOver
        ? (() => {
            const next = nextRoundButton(t, {
              awaitingOpponent,
              round: view.round,
              nextRoundPrefix: t.nextRound,
            });
            return (
              <div className="hand-row reveal-dock">
                <span className="dock-hint">{t.scoresAtEnd}</span>
                {awaitingOpponent && readyCountdown ? readyCountdown : null}
                <button
                  type="button"
                  className="btn btn-primary lock-btn"
                  disabled={next.disabled}
                  onClick={onNextRound}
                >
                  {next.label}
                </button>
              </div>
            );
          })()
        : null}
    </div>
  );
}

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getFlavorById } from '../game/cards';
import type { Collection } from '../game/collection';
import { buildQuickPlayHand, type HandCard } from '../game/hands';
import {
  autoPlaceForTimeout,
  bothLocked,
  createMatch,
  currentBoard,
  lockPlayer,
  revealRound,
  placeCards,
  MAX_PLACE,
  MIN_PLACE,
  TIMER_SECONDS,
  unplaceCard,
  type MatchState,
  type PlacedCard,
  type Player,
} from '../game/match';
import { matchWinner } from '../game/series';
import { scoreMatch, type ZoneResult } from '../game/scoring';
import type { Flavor } from '../game/types';
import type { Players } from '../storage/playersStore';
import { ZONES } from '../game/zones';
import { assetUrl } from '../components/assetPaths';
import { GameCard } from '../components/GameCard';
import { CoolIcon, CrownIcon, EnergyIcon, ExitIcon, PartyIcon } from '../components/icons';
import { fmt, useI18n } from '../i18n';

type Stage = 'idle' | 'passA' | 'placeA' | 'passB' | 'placeB' | 'roundReveal' | 'matchOver';

const activePlayer = (stage: Stage): Player | null =>
  stage === 'placeA' ? 'A' : stage === 'placeB' ? 'B' : null;

function placedMap(match: MatchState, player: Player): Map<number, string> {
  const map = new Map<number, string>();
  const board = currentBoard(match);
  for (const zoneId of Object.keys(board)) {
    for (const card of board[zoneId][player]) map.set(card.handIndex, zoneId);
  }
  return map;
}

/** All hand-indices used by a player across every round (including current). */
function allUsedIndices(match: MatchState, player: Player): Set<number> {
  const used = new Set<number>();
  for (const board of match.boards) {
    for (const zoneId of Object.keys(board)) {
      for (const card of board[zoneId][player]) used.add(card.handIndex);
    }
  }
  return used;
}

function flavorOf(flavorId: string): Flavor | undefined {
  return getFlavorById(flavorId);
}

function ZoneIcon({ zoneId, size = 18 }: { zoneId: string; size?: number }) {
  if (zoneId === 'cool') return <CoolIcon size={size} />;
  if (zoneId === 'party') return <PartyIcon size={size} />;
  return <EnergyIcon size={size} />;
}

/** Circular timer ring that drains as seconds run out. Red under 5s. */
function TimerRing({ seconds, total }: { seconds: number; total: number }) {
  const r = 11;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, seconds / total));
  const urgent = seconds <= 5;
  return (
    <span
      className={`timer-ring${urgent ? ' urgent' : ''}`}
      role="timer"
      aria-label={`${seconds}s`}
    >
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r={r} className="ring-track" />
        <circle
          cx="16"
          cy="16"
          r={r}
          className="ring-fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
        />
      </svg>
      <span className="ring-num">{seconds}</span>
    </span>
  );
}

/** Round pips: 3 dots, current lit. Takes the display round (reveal-safe). */
function RoundPips({ current, total = 3 }: { current: number; total?: number }) {
  return (
    <span className="round-pips" aria-label={`Round ${current} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`pip${i + 1 === current ? ' on' : ''}${i + 1 < current ? ' done' : ''}`}
        />
      ))}
    </span>
  );
}

export function QuickPlay({
  collection,
  players,
  onPlayersChange,
  onMatchActiveChange,
}: {
  collection: Collection;
  players: Players;
  onPlayersChange: (players: Players) => void;
  onMatchActiveChange?: (active: boolean) => void;
}) {
  const { t } = useI18n();
  const [match, setMatch] = useState<MatchState | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [seconds, setSeconds] = useState(TIMER_SECONDS);
  const [notice, setNotice] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [results, setResults] = useState<ZoneResult[] | null>(null);
  const [winner, setWinner] = useState<Player | null>(null);
  const timedOut = useRef(false);

  const player = activePlayer(stage);
  const names: Record<Player, string> = { A: players.p1, B: players.p2 };

  // Notify parent of active game to hide bottom nav
  useEffect(() => {
    const active = stage !== 'idle' && match !== null;
    onMatchActiveChange?.(active);
  }, [stage, match, onMatchActiveChange]);

  // Reset clock on turn or round changes
  useEffect(() => {
    timedOut.current = false;
    setSeconds(TIMER_SECONDS);
  }, [stage, match?.round]);

  // Turn timer with automatic placement on timeout
  useEffect(() => {
    if ((stage !== 'placeA' && stage !== 'placeB') || !match) return;
    if (seconds <= 0) {
      if (!timedOut.current) {
        timedOut.current = true;
        const p: Player = stage === 'placeA' ? 'A' : 'B';
        advance(autoPlaceForTimeout(match, p), p);
      }
      return;
    }
    const timer = window.setInterval(() => setSeconds((s) => s - 1), 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, seconds, match]);

  // Toast notices auto-dismiss so they never pile up over the board
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), 2200);
    return () => window.clearTimeout(id);
  }, [notice]);

  function advance(locked: MatchState, by: Player) {
    if (bothLocked(locked)) {
      reveal(locked);
      return;
    }
    setMatch(locked);
    setNotice('');
    setStage(by === 'A' ? 'passB' : 'placeB');
  }

  function reveal(locked: MatchState) {
    const revealed = revealRound(locked);
    setMatch(revealed);
    setNotice('');
    if (revealed.phase === 'complete') {
      const scored = scoreMatch(revealed);
      setResults(scored);
      setWinner(matchWinner(scored));
      setStage('matchOver');
    } else {
      setStage('roundReveal');
    }
  }

  function startQuickPlay() {
    try {
      setMatch(createMatch(buildQuickPlayHand(collection), buildQuickPlayHand(collection)));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not start match');
      return;
    }
    setResults(null);
    setWinner(null);
    setNotice('');
    setStage('passA');
  }

  function endMatch() {
    setMatch(null);
    setResults(null);
    setWinner(null);
    setNotice('');
    setStage('idle');
  }

  function lock(by: Player) {
    if (!match) return;
    try {
      advance(lockPlayer(match, by), by);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Cannot lock in yet');
    }
  }

  function placeOne(by: Player, handIndex: number, zone: string) {
    if (!match) return;
    const map = placedMap(match, by);
    if (map.has(handIndex)) {
      map.set(handIndex, zone);
    } else {
      if (map.size >= MAX_PLACE) {
        // Third placement: short shake on the hand + toast, not a paragraph
        setShakeKey((k) => k + 1);
        setNotice(t.onlyTwo);
        return;
      }
      map.set(handIndex, zone);
    }
    try {
      setMatch(
        placeCards(
          match,
          by,
          [...map.entries()].map(([i, z]) => ({ handIndex: i, zone: z }))
        )
      );
      setNotice('');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Invalid placement');
    }
  }

  function unplace(by: Player, handIndex: number) {
    if (!match) return;
    try {
      setMatch(unplaceCard(match, by, handIndex));
      setNotice('');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Cannot remove card');
    }
  }

  // match.round already advanced past the just-revealed round, so the
  // indicator must show round-1 during reveal / matchOver (logic untouched).
  const displayRound =
    !match || stage === 'idle'
      ? 1
      : stage === 'roundReveal' || stage === 'matchOver'
        ? Math.max(1, match.round - 1)
        : match.round;

  return (
    <section aria-label="Play" className="arena-section">
      {/* Slim top bar during match: round pips left, exit icon right */}
      {stage !== 'idle' && (
        <div className="game-topbar">
          <div className="game-topbar-info">
            <RoundPips current={displayRound} />
            <span className="game-round-indicator">{fmt(t.roundN, { n: displayRound })}</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={endMatch}
            aria-label={t.exitMatch}
            title={t.exitMatch}
          >
            <ExitIcon size={18} />
          </button>
        </div>
      )}

      {/* Main Arena Menu when Idle */}
      {!match || stage === 'idle' ? (
        <div className="mode-menu">
          <div className="arena-hero">
            <img
              src={assetUrl('assets/cards/v7-logo.png')}
              alt="V7 Logo"
              className="arena-hero-v7-logo"
            />
            <div className="arena-brand-badge">
              <span className="brand-origin">🇪🇬 من مصر للعالم</span>
              <span className="brand-dot">•</span>
              <span className="brand-claim">100% Natural • Vitamins & Taste</span>
            </div>
            <h2 className="arena-title">{t.arenaTitle}</h2>
            <p className="arena-subtitle">{t.arenaSubtitle}</p>
          </div>

          <div className="player-setup-card">
            <h3>{t.playerProfiles}</h3>
            <p className="demo-note">{t.playerProfilesNote}</p>
            <div className="name-row">
              <label>
                {t.player1Name}
                <input
                  value={players.p1}
                  maxLength={12}
                  onChange={(e) => onPlayersChange({ ...players, p1: e.target.value })}
                  placeholder="Player 1"
                />
              </label>
              <label>
                {t.player2Name}
                <input
                  value={players.p2}
                  maxLength={12}
                  onChange={(e) => onPlayersChange({ ...players, p2: e.target.value })}
                  placeholder="Player 2"
                />
              </label>
            </div>
          </div>

          <div className="mode-options-grid single-mode">
            {/* Quick Play Option (Main local pass-and-play) */}
            <div className="mode-card active-card quick-play-card">
              <div className="mode-card-header">
                <span className="mode-badge quick">{t.quickPlayBadge}</span>
                <h3>{t.quickPlayTitle}</h3>
              </div>
              <p className="mode-desc">{t.quickPlayDesc}</p>
              <button
                type="button"
                className="btn btn-primary btn-lg mode-action-btn"
                onClick={startQuickPlay}
              >
                ⚡ {t.quickPlayBtn}
              </button>
            </div>
          </div>

          <div className="online-pvp-hint">
            <span className="hint-pill">🌐 {t.comingPhase2}</span>
            <p className="hint-text">{t.rankedNote}</p>
          </div>
        </div>
      ) : null}

      {/* Lookaway Handoff Screen for Player A */}
      {match && stage === 'passA' ? (
        <div className="lookaway" role="alert">
          <div className="lookaway-icon">📱</div>
          <strong>
            {t.passTo} {names.A}
          </strong>
          <p>
            {names.B}, {t.lookAway} {names.A}.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={(e) => {
              e.stopPropagation();
              setStage('placeA');
            }}
          >
            {t.imPlayer} {names.A} — {t.showCards}
          </button>
        </div>
      ) : null}

      {/* In-Game Active Board (Placing View) */}
      {match && player ? (
        <SnapBattlefield
          key={`${player}-${match.round}`}
          match={match}
          player={player}
          names={names}
          seconds={seconds}
          isRevealing={false}
          shakeKey={shakeKey}
          onPlace={(i, z) => placeOne(player, i, z)}
          onUnplace={(i) => unplace(player, i)}
          onLock={() => lock(player)}
        />
      ) : null}

      {/* Lookaway Handoff Screen for Player B */}
      {match && stage === 'passB' ? (
        <div className="lookaway" role="alert">
          <div className="lookaway-icon">📱</div>
          <strong>
            {t.passTo} {names.B}
          </strong>
          <p>
            {names.A}, {t.lookAway} {names.B}.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={(e) => {
              e.stopPropagation();
              setStage('placeB');
            }}
          >
            {t.imPlayer} {names.B} — {t.showCards}
          </button>
        </div>
      ) : null}

      {/* In-Game Board Reveal Step & Final Results (ON THE SAME BATTLEFIELD!) */}
      {match && (stage === 'roundReveal' || stage === 'matchOver') ? (
        <SnapBattlefield
          key={`reveal-${match.round}`}
          match={match}
          player="A"
          names={names}
          seconds={0}
          isRevealing={true}
          isMatchOver={stage === 'matchOver'}
          results={results}
          winner={winner}
          onNextRound={() => {
            setNotice('');
            setStage('passA');
          }}
          onRematch={startQuickPlay}
          onReturnMenu={endMatch}
        />
      ) : null}

      {notice ? (
        <p className="toast-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Snap-style Battlefield:
 * 3 vertical lane columns in center.
 * Cards are laid out inside each lane (Opponent at top, Player at bottom).
 * Real-time power calculated on the central Zone pillar.
 * Hand at bottom shows ONLY UNPLACED cards.
 */
function SnapBattlefield({
  match,
  player,
  names,
  seconds,
  isRevealing,
  isMatchOver,
  results,
  winner,
  shakeKey,
  onPlace,
  onUnplace,
  onLock,
  onNextRound,
  onRematch,
  onReturnMenu,
}: {
  match: MatchState;
  player: Player;
  names: Record<Player, string>;
  seconds: number;
  isRevealing: boolean;
  isMatchOver?: boolean;
  results?: ZoneResult[] | null;
  winner?: Player | null;
  shakeKey?: number;
  onPlace?: (handIndex: number, zone: string) => void;
  onUnplace?: (handIndex: number) => void;
  onLock?: () => void;
  onNextRound?: () => void;
  onRematch?: () => void;
  onReturnMenu?: () => void;
}) {
  const { t } = useI18n();
  const foe: Player = player === 'A' ? 'B' : 'A';
  const map = placedMap(match, player);
  const hand: readonly HandCard[] = match.hands[player];

  // Visible hand cards = only cards NOT placed in ANY round.
  // Using allUsedIndices prevents round-1 cards from ghosting back into the
  // hand at the start of round 2.
  const allUsed = allUsedIndices(match, player);
  const visibleCards = hand
    .map((card, index) => ({ card, index }))
    .filter(({ index }) => !allUsed.has(index));

  // Tap-to-select state
  const [selected, setSelected] = useState<number | null>(null);

  // Drag & drop state
  const [drag, setDrag] = useState<{ handIndex: number; x: number; y: number } | null>(null);
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  const pointerState = useRef<{
    handIndex: number;
    startX: number;
    startY: number;
    pointerId: number;
    isDragging: boolean;
  } | null>(null);

  function handleZoneClick(zoneId: string) {
    if (isRevealing || !onPlace) return;
    if (selected === null) return;
    onPlace(selected, zoneId);
    setSelected(null);
  }

  function handleCardClick(i: number) {
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
        // Fallback
      }
    }

    if (state.isDragging) {
      setDrag({ handIndex: state.handIndex, x: e.clientX, y: e.clientY });
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-zone]');
      const zoneId = el?.getAttribute('data-zone') ?? null;
      setHoverZone(zoneId);
    }
  }

  function onCardPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const state = pointerState.current;
    if (!state) return;

    if (state.isDragging) {
      try {
        e.currentTarget.releasePointerCapture(state.pointerId);
      } catch {
        // Ignore
      }
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-zone]');
      const targetZone = el?.getAttribute('data-zone');
      if (targetZone && onPlace) {
        onPlace(state.handIndex, targetZone);
        setSelected(null);
      }
      setDrag(null);
      setHoverZone(null);
    } else {
      handleCardClick(state.handIndex);
    }
    pointerState.current = null;
  }

  function onCardPointerCancel(e: ReactPointerEvent<HTMLButtonElement>) {
    if (pointerState.current) {
      try {
        e.currentTarget.releasePointerCapture(pointerState.current.pointerId);
      } catch {
        // Ignore
      }
    }
    pointerState.current = null;
    setDrag(null);
    setHoverZone(null);
  }

  const placedCount = map.size;
  const canLock = placedCount >= MIN_PLACE;
  const armed = !isRevealing && (selected !== null || drag !== null);

  // Zone tips map for rules
  const zoneRules: Record<string, string> = {
    cool: t.zoneCoolRule,
    party: t.zonePartyRule,
    energy: t.zoneEnergyRule,
  };

  return (
    <div className={`battlefield-container${armed ? ' armed' : ''}`}>
      {/* Opponent strip: one line */}
      <div className="arena-player-plate opponent-plate">
        <div className="player-meta">
          <strong className="player-tag">{names[foe]}</strong>
          <span className="player-status">
            {isRevealing ? t.roundRevealed : fmt(t.oppStrip, { name: names[foe] })}
          </span>
        </div>
      </div>

      {/* The 3 Marvel Snap Battle Lanes */}
      <div className="snap-lanes-board">
        {ZONES.map((z) => {
          // Gather cards played in this zone
          const pCards: { card: PlacedCard; isCurrentRound: boolean }[] = [];
          const foeCards: { card: PlacedCard; isCurrentRound: boolean }[] = [];

          match.boards.forEach((board, bi) => {
            const side = board[z.id];
            if (!side) return;
            for (const c of side[player]) {
              pCards.push({ card: c, isCurrentRound: bi === match.round - 1 });
            }
            for (const c of side[foe]) {
              foeCards.push({ card: c, isCurrentRound: bi === match.round - 1 });
            }
          });

          // Calculate power score for this lane
          let pPower = 0;
          let foePower = 0;

          // For player, card.power is known in hand
          for (const item of pCards) {
            const fullCard = hand[item.card.handIndex];
            if (fullCard) pPower += fullCard.power;
          }

          // For opponent: only count cards that have been revealed (i.e. from a
          // previous round, or current round after both locked & reveal fired).
          // Current-round unrevealed cards must NEVER contribute to the displayed
          // score — that would leak info about what the opponent placed.
          for (const item of foeCards) {
            if ((isRevealing || !item.isCurrentRound) && item.card.power != null) {
              foePower += item.card.power;
            }
          }

          // If match is over and scored, use official totals
          const zResult = results?.find((r) => r.zoneId === z.id);
          if (zResult) {
            pPower = zResult.totals[player];
            foePower = zResult.totals[foe];
          }

          const isDropReady = !isRevealing && selected !== null && !map.has(selected);
          const isDropTarget = !isRevealing && hoverZone === z.id;
          const isWinning = pPower > foePower;
          const isLosing = foePower > pPower;
          const isTied = pPower === foePower && (pPower > 0 || foePower > 0);

          return (
            <div
              key={z.id}
              data-zone={z.id}
              className={`snap-lane-column zone-${z.id}${isDropReady ? ' drop-ready' : ''}${
                isDropTarget ? ' drop-target' : ''
              }${zResult?.winner === player ? ' lane-victory' : ''}`}
              onClick={() => handleZoneClick(z.id)}
            >
              {/* Opponent side of this lane (Top) */}
              <div className="lane-cards-strip foe-strip">
                {foeCards.map((item, idx) => {
                  // Pass-and-play fairness: during a placing turn the opponent's
                  // current-round picks stay fully hidden — not even a face-down
                  // "?" placeholder. Showing a placeholder would leak WHERE
                  // Player 1 placed, giving Player 2 a free read in the same
                  // round (online the reveal hasn't happened yet either).
                  // Cards appear here only after both lock + reveal fires
                  // (isRevealing=true) or from already-revealed earlier rounds.
                  if (!isRevealing && item.isCurrentRound) {
                    return null;
                  }
                  const flavor = flavorOf(item.card.flavor);
                  if (!flavor) return null;

                  return (
                    <div key={`foe-${idx}`} className="lane-mini-card animate-flip">
                      <GameCard
                        flavor={flavor}
                        power={item.card.power ?? undefined}
                        displayName={t.flavors[flavor.id] || flavor.name}
                        size="board"
                      />
                    </div>
                  );
                })}
              </div>

              {/* Center band: zone icon, name, rule, live scores */}
              <div
                className={`lane-zone-pillar${
                  isWinning ? ' p-leading' : isLosing ? ' foe-leading' : isTied ? ' lane-tied' : ''
                }`}
              >
                <div className="pillar-score foe-score">{foePower}</div>
                <div className="pillar-body">
                  <span className="pillar-icon">
                    <ZoneIcon zoneId={z.id} size={18} />
                  </span>
                  <strong className="pillar-name">{z.name}</strong>
                  <span className="pillar-rule">{zoneRules[z.id]}</span>
                </div>
                <div className="pillar-score player-score">{pPower}</div>
              </div>

              {/* Active Player side of this lane (Bottom) */}
              <div className="lane-cards-strip player-strip">
                {pCards.map((item, idx) => {
                  const hc = hand[item.card.handIndex];
                  const flavor = hc ? flavorOf(hc.flavor) : undefined;
                  if (!flavor || !hc) return null;
                  const canRecall = !isRevealing && item.isCurrentRound;
                  const displayName = t.flavors[flavor.id] || flavor.name;

                  if (!canRecall) {
                    return (
                      <div key={idx} className="lane-mini-card">
                        <GameCard
                          flavor={flavor}
                          power={hc.power}
                          displayName={displayName}
                          size="board"
                        />
                      </div>
                    );
                  }

                  return (
                    <button
                      key={idx}
                      type="button"
                      className="lane-mini-card pop-in recallable"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnplace?.(item.card.handIndex);
                      }}
                      title={t.recall}
                      aria-label={fmt(t.takeBack, { name: displayName })}
                    >
                      <GameCard
                        flavor={flavor}
                        power={hc.power}
                        displayName={displayName}
                        size="board"
                      />
                      <span className="recall-x" aria-hidden="true">
                        ×
                      </span>
                    </button>
                  );
                })}

                {isDropReady && <div className="lane-drop-prompt">+ {t.tapZoneToPlace}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Your bar: name + circular timer ring */}
      <div className="arena-player-plate player-plate">
        <div className="player-meta">
          <strong className="player-tag">{names[player]}</strong>
          <span className="player-status">
            {isRevealing ? '' : fmt(t.turnTitle, { name: names[player] })}
          </span>
        </div>
        {!isRevealing && <TimerRing seconds={seconds} total={TIMER_SECONDS} />}
      </div>

      {/* Hand: ONLY shows cards not currently placed! */}
      {!isRevealing ? (
        <div className="hand-wrapper">
          <div className="hand-header">
            <span className="hand-title">
              {t.yourHand} ({visibleCards.length})
            </span>
            <span className="hand-tip">
              {selected !== null ? t.tapZoneToPlace : t.tapToPlaceHint}
            </span>
          </div>

          <div
            key={shakeKey}
            className={`hand-fan${shakeKey > 0 ? ' shake-once' : ''}`}
            role="group"
            aria-label={t.yourHand}
          >
            {visibleCards.map(({ card: hc, index: i }) => {
              const flavor = flavorOf(hc.flavor);
              if (!flavor) return null;
              const isSelected = selected === i;
              const isDragging = drag?.handIndex === i;
              const displayName = t.flavors[flavor.id] || flavor.name;

              return (
                <button
                  key={i}
                  type="button"
                  className={`fan-card${isSelected ? ' selected' : ''}${isDragging ? ' dragging' : ''}`}
                  onPointerDown={(e) => onCardPointerDown(e, i)}
                  onPointerMove={onCardPointerMove}
                  onPointerUp={onCardPointerUp}
                  onPointerCancel={onCardPointerCancel}
                  aria-label={`${displayName}, power ${hc.power}`}
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

          {/* Action Lock In Button */}
          <button
            type="button"
            className={`btn btn-primary lock-btn${!canLock ? ' disabled' : ''}`}
            disabled={!canLock}
            onClick={onLock}
          >
            {canLock ? fmt(t.lockInCount, { placed: placedCount }) : t.needOne}
          </button>
        </div>
      ) : null}

      {/* Floating Reveal / Match End Banner RIGHT ON THE BOARD */}
      {isRevealing && (
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
      )}

      {/* Drag Ghost tracking cursor freely across whole viewport */}
      {drag && (
        <div
          className="drag-ghost-card"
          style={{
            left: `${drag.x}px`,
            top: `${drag.y}px`,
          }}
          aria-hidden="true"
        >
          <GameCard
            flavor={flavorOf(hand[drag.handIndex].flavor)!}
            power={hand[drag.handIndex].power}
            displayName={
              t.flavors[hand[drag.handIndex].flavor] || flavorOf(hand[drag.handIndex].flavor)!.name
            }
          />
        </div>
      )}
    </div>
  );
}

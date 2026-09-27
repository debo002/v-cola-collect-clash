import { useEffect, useRef, useState } from 'react';
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
  TIMER_SECONDS,
  unplaceCard,
  type MatchState,
  type PlacedCard,
  type Player,
} from '../game/match';
import { matchWinner } from '../game/series';
import { scoreMatch, type ZoneResult } from '../game/scoring';
import type { Flavor } from '../game/types';
import { ZONES } from '../game/zones';
import { flavorImageUrl } from '../components/assetPaths';
import { FlavorCard } from '../components/FlavorCard';

type Stage = 'idle' | 'placeA' | 'passB' | 'placeB' | 'roundResult' | 'matchOver';

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

function flavorOf(flavorId: string): Flavor | undefined {
  return getFlavorById(flavorId);
}

export function QuickPlay({ collection }: { collection: Collection }) {
  const [match, setMatch] = useState<MatchState | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [seconds, setSeconds] = useState(TIMER_SECONDS);
  const [notice, setNotice] = useState('');
  const [results, setResults] = useState<ZoneResult[] | null>(null);
  const [winner, setWinner] = useState<Player | null>(null);
  const timedOut = useRef(false);

  const player = activePlayer(stage);

  // Reset the clock every turn; fire the timeout exactly once.
  useEffect(() => {
    timedOut.current = false;
    setSeconds(TIMER_SECONDS);
  }, [stage, match?.round]);

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
      setStage('roundResult');
    }
  }

  function start() {
    const handA = buildQuickPlayHand(collection);
    const handB = buildQuickPlayHand(collection);
    setMatch(createMatch(handA, handB));
    setResults(null);
    setWinner(null);
    setNotice('');
    setStage('placeA');
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

  function place(by: Player, handIndex: number, zone: string) {
    if (!match) return;
    const map = placedMap(match, by);
    map.set(handIndex, zone);
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

  return (
    <section aria-label="Quick Play">
      <div className="section-head">
        <h2>Quick Play</h2>
        {stage === 'idle' || stage === 'matchOver' ? (
          <button type="button" className="btn btn-primary" onClick={start}>
            {stage === 'matchOver' ? 'Rematch' : 'Start match'}
          </button>
        ) : (
          <button type="button" className="btn" onClick={endMatch}>
            End match
          </button>
        )}
      </div>

      {!match || stage === 'idle' ? (
        <p className="demo-note">
          One phone, two players. Hands are drawn from this device&apos;s collection (loaners fill
          gaps). 3 rounds, 1–2 cards each, {TIMER_SECONDS}s per turn.
        </p>
      ) : null}

      {match && player ? (
        <PlacingView
          match={match}
          player={player}
          seconds={seconds}
          onPlace={(i, z) => place(player, i, z)}
          onUnplace={(i) => unplace(player, i)}
          onLock={() => lock(player)}
        />
      ) : null}

      {match && stage === 'passB' ? (
        <div className="lookaway" role="alert">
          <strong>Pass the phone to Player B</strong>
          <p>Player A, look away!</p>
          <button type="button" className="btn btn-primary" onClick={() => setStage('placeB')}>
            I&apos;m Player B — start my turn
          </button>
        </div>
      ) : null}

      {match && (stage === 'roundResult' || stage === 'matchOver') ? (
        <ResultView
          match={match}
          results={results}
          winner={winner}
          finished={stage === 'matchOver'}
          onNext={() => {
            setNotice('');
            setStage('placeA');
          }}
        />
      ) : null}

      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function PlacingView({
  match,
  player,
  seconds,
  onPlace,
  onUnplace,
  onLock,
}: {
  match: MatchState;
  player: Player;
  seconds: number;
  onPlace: (handIndex: number, zone: string) => void;
  onUnplace: (handIndex: number) => void;
  onLock: () => void;
}) {
  const map = placedMap(match, player);
  const hand: readonly HandCard[] = match.hands[player];
  const foe: Player = player === 'A' ? 'B' : 'A';
  const foePlaced = placedMap(match, foe).size;

  return (
    <div>
      <div className="turn-head">
        <strong>
          Player {player} — Round {match.round} of 3
        </strong>
        <span className={seconds <= 3 ? 'timer urgent' : 'timer'} aria-live="polite">
          {seconds}s
        </span>
      </div>
      <p className="demo-note">
        Opponent has placed {foePlaced} card{foePlaced === 1 ? '' : 's'} (hidden).
      </p>
      <div className="hand-list">
        {hand.map((hc, i) => {
          const flavor = flavorOf(hc.flavor);
          if (!flavor) return null;
          const zone = map.get(i);
          return (
            <div key={i} className="hand-row">
              <div className="hand-card">
                <FlavorCard flavor={flavor} power={hc.power} selected={zone !== undefined} />
              </div>
              <div className="hand-actions">
                {zone ? (
                  <div className="placed-tag">
                    <span>
                      in {ZONES.find((z) => z.id === zone)?.name ?? zone} · P{hc.power}
                    </span>
                    <button
                      type="button"
                      className="btn step"
                      onClick={() => onUnplace(i)}
                      aria-label={`Remove ${flavor.name} from ${zone}`}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="zone-btns" role="group" aria-label={`Place ${flavor.name}`}>
                    {ZONES.map((z) => (
                      <button
                        key={z.id}
                        type="button"
                        className="btn zone-btn"
                        onClick={() => onPlace(i, z.id)}
                      >
                        {z.name}
                      </button>
                    ))}
                  </div>
                )}
                {hc.loaner ? <span className="loaner-tag">loaner</span> : null}
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" className="btn btn-primary lock-btn" onClick={onLock}>
        Lock in ({map.size} placed)
      </button>
    </div>
  );
}

interface OwnedCard extends PlacedCard {
  owner: Player;
}

function ResultView({
  match,
  results,
  winner,
  finished,
  onNext,
}: {
  match: MatchState;
  results: ZoneResult[] | null;
  winner: Player | null;
  finished: boolean;
  onNext: () => void;
}) {
  return (
    <div>
      {finished ? (
        <div className="result-banner" role="status">
          {winner ? `Player ${winner} wins the match!` : 'Match drawn!'}
        </div>
      ) : (
        <div className="result-banner round" role="status">
          Round {match.round - 1} revealed — no scores until round 3
        </div>
      )}
      {ZONES.map((zone) => {
        const r = results?.find((x) => x.zoneId === zone.id);
        const cards: OwnedCard[] = [];
        // Future boards are empty, so this only ever shows revealed cards.
        for (const board of match.boards) {
          const side = board[zone.id];
          if (!side) continue;
          for (const owner of ['A', 'B'] as const) {
            for (const card of side[owner]) cards.push({ ...card, owner });
          }
        }
        return (
          <div key={zone.id} className={`zone zone-${zone.id} result-zone`}>
            <div className="result-zone-head">
              <strong>{zone.name}</strong>
              <span>
                {r
                  ? `A ${r.totals.A} — B ${r.totals.B}${r.winner ? ` → Player ${r.winner}` : ' → drawn'}`
                  : `${cards.length} card${cards.length === 1 ? '' : 's'} revealed`}
              </span>
            </div>
            <div className="reveal-grid">
              {cards.map((card, i) => (
                <RevealChip key={`${card.owner}-${card.handIndex}-${i}`} card={card} />
              ))}
            </div>
          </div>
        );
      })}
      {!finished ? (
        <button type="button" className="btn btn-primary lock-btn" onClick={onNext}>
          Next round
        </button>
      ) : null}
    </div>
  );
}

function RevealChip({ card }: { card: OwnedCard }) {
  const flavor = flavorOf(card.flavor);
  if (!flavor) return null;
  return (
    <span className={`reveal-chip owner-${card.owner}`}>
      <img src={flavorImageUrl(flavor)} alt="" aria-hidden="true" />
      <strong>{card.power ?? '?'}</strong>
      <em>
        {card.owner} · {flavor.name}
      </em>
    </span>
  );
}

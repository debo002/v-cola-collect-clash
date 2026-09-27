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
  MAX_PLACE,
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

  function placeMany(by: Player, list: { handIndex: number; zone: string }[]) {
    if (!match) return;
    const map = placedMap(match, by);
    for (const p of list) map.set(p.handIndex, p.zone);
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
          onPlaceMany={(list) => placeMany(player, list)}
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
  onPlaceMany,
  onUnplace,
  onLock,
}: {
  match: MatchState;
  player: Player;
  seconds: number;
  onPlaceMany: (list: { handIndex: number; zone: string }[]) => void;
  onUnplace: (handIndex: number) => void;
  onLock: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const map = placedMap(match, player);
  const hand: readonly HandCard[] = match.hands[player];
  const usable = new Set([...selected].filter((i) => !map.has(i) && i < hand.length));

  function toggle(i: number) {
    if (map.has(i)) {
      onUnplace(i);
      return;
    }
    const next = new Set(usable);
    if (next.has(i)) next.delete(i);
    else if (next.size < MAX_PLACE) next.add(i);
    setSelected(next);
  }

  function drop(zone: string) {
    if (usable.size === 0) return;
    onPlaceMany([...usable].map((handIndex) => ({ handIndex, zone })));
    setSelected(new Set());
  }

  return (
    <div>
      <div className="turn-banner" role="status">
        <strong>
          Player {player} · Round {match.round} of 3
        </strong>
        <span>place up to 2 — tap cards, then a zone</span>
        <span className={seconds <= 5 ? 'timer urgent' : 'timer'} aria-live="polite">
          {seconds}s
        </span>
      </div>

      <div className="board-zones">
        {ZONES.map((z) => {
          const mine = [...map.entries()].filter(([, zid]) => zid === z.id);
          return (
            <button
              key={z.id}
              type="button"
              className={`zone zone-${z.id} zone-slot${usable.size > 0 ? ' drop-ready' : ''}`}
              onClick={() => drop(z.id)}
              aria-label={`Place selected cards in ${z.name}`}
            >
              <span className="zone-slot-head">
                <strong>{z.name}</strong>
                <em>{z.tagline}</em>
              </span>
              <span className="zone-minis">
                {mine.length === 0 ? (
                  <span className="zone-hint">
                    {usable.size > 0 ? 'tap to drop here' : 'your cards land here'}
                  </span>
                ) : (
                  mine.map(([i]) => {
                    const hc = hand[i];
                    const flavor = hc ? flavorOf(hc.flavor) : undefined;
                    if (!flavor || !hc) return null;
                    return (
                      <MiniCard
                        key={i}
                        flavorId={flavor.id}
                        name={flavor.name}
                        power={hc.power}
                        onRemove={() => onUnplace(i)}
                      />
                    );
                  })
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="demo-note">Opponent cards stay hidden until both players lock in.</p>

      <div className="hand-fan" role="group" aria-label="Your hand — tap to select">
        {hand.map((hc, i) => {
          const flavor = flavorOf(hc.flavor);
          if (!flavor) return null;
          const placed = map.has(i);
          return (
            <button
              key={i}
              type="button"
              className={`fan-card${usable.has(i) ? ' picked' : ''}${placed ? ' placed' : ''}`}
              onClick={() => toggle(i)}
              aria-pressed={usable.has(i)}
              aria-label={`${flavor.name}, power ${hc.power}${placed ? ', placed' : ''}`}
            >
              <FlavorCard
                flavor={flavor}
                power={hc.power}
                selected={usable.has(i)}
                dimmed={placed}
              />
              {hc.loaner ? <span className="loaner-tag">loaner</span> : null}
            </button>
          );
        })}
      </div>
      <button type="button" className="btn btn-primary lock-btn" onClick={onLock}>
        Lock in ({map.size}/2 placed)
      </button>
    </div>
  );
}

function MiniCard({
  flavorId,
  name,
  power,
  onRemove,
}: {
  flavorId: string;
  name: string;
  power: number;
  onRemove: () => void;
}) {
  const flavor = flavorOf(flavorId);
  if (!flavor) return null;
  return (
    <span className="mini">
      <img src={flavorImageUrl(flavor)} alt="" aria-hidden="true" />
      <strong>{power}</strong>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ✕
      </button>
    </span>
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

import { useEffect, useRef, useState } from 'react';
import type { Collection } from '../game/collection';
import { buildQuickPlayHand } from '../game/hands';
import {
  autoPlaceForTimeout,
  bothLocked,
  createMatch,
  lockPlayer,
  revealRound,
  placeCards,
  MAX_PLACE,
  TIMER_SECONDS,
  unplaceCard,
  type MatchState,
  type Player,
} from '../game/match';
import { matchWinner } from '../game/series';
import { explainMatch, scoreMatch, type ZoneExplanation, type ZoneResult } from '../game/scoring';
import type { Players } from '../storage/playersStore';
import { Stage } from '../components/Stage';
import { Board } from '../components/match/Board';
import { placedMap } from '../components/match/boardUtils';
import { PassScreen } from '../components/match/PassScreen';
import { TitleScreen } from '../components/match/TitleScreen';
import { TopBar } from '../components/match/TopBar';
import { useI18n } from '../i18n';

type Stage_ = 'idle' | 'passA' | 'placeA' | 'passB' | 'placeB' | 'roundReveal' | 'matchOver';

const activePlayer = (stage: Stage_): Player | null =>
  stage === 'placeA' ? 'A' : stage === 'placeB' ? 'B' : null;

export function QuickPlay({
  collection,
  players,
  onPlayersChange,
  onMatchActiveChange,
  onOpenDeck,
}: {
  collection: Collection;
  players: Players;
  onPlayersChange: (players: Players) => void;
  onMatchActiveChange?: (active: boolean) => void;
  onOpenDeck: () => void;
}) {
  const { t } = useI18n();
  const [match, setMatch] = useState<MatchState | null>(null);
  const [stage, setStage] = useState<Stage_>('idle');
  const [seconds, setSeconds] = useState(TIMER_SECONDS);
  const [notice, setNotice] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [results, setResults] = useState<ZoneResult[] | null>(null);
  const [winner, setWinner] = useState<Player | null>(null);
  const [explanations, setExplanations] = useState<ZoneExplanation[] | null>(null);
  const timedOut = useRef(false);

  const player = activePlayer(stage);
  const names: Record<Player, string> = { A: players.p1, B: players.p2 };

  // Notify parent of active game (title screen vs. match chrome).
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
      setExplanations(explainMatch(revealed));
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
    setExplanations(null);
    setNotice('');
    setStage('passA');
  }

  function endMatch() {
    setMatch(null);
    setResults(null);
    setWinner(null);
    setExplanations(null);
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

  function tooMany() {
    setShakeKey((k) => k + 1);
    setNotice(t.onlyTwo);
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
  // indicator shows round-1 during round reveal. At match over the round
  // does NOT advance (stays 3), so it shows match.round (logic untouched).
  const displayRound =
    !match || stage === 'idle'
      ? 1
      : stage === 'roundReveal'
        ? Math.max(1, match.round - 1)
        : match.round;

  if (!match || stage === 'idle') {
    return (
      <Stage>
        <TitleScreen
          players={players}
          onPlayersChange={onPlayersChange}
          onPlay={startQuickPlay}
          onOpenDeck={onOpenDeck}
        />
        {notice ? (
          <p className="toast-notice" role="status">
            {notice}
          </p>
        ) : null}
      </Stage>
    );
  }

  const placing = player !== null;

  return (
    <Stage>
      <div className="match-screen">
        <TopBar
          displayRound={displayRound}
          seconds={seconds}
          showTimer={placing}
          onMenu={endMatch}
        />

        {stage === 'passA' ? (
          <PassScreen
            passerName={names.B}
            receiverName={names.A}
            lookAway={t.lookAway}
            passTo={t.passTo}
            imPlayer={t.imPlayer}
            showCards={t.showCards}
            onReveal={() => setStage('placeA')}
          />
        ) : null}

        {player ? (
          <Board
            key={`${player}-${match.round}`}
            match={match}
            player={player}
            names={names}
            displayRound={displayRound}
            isRevealing={false}
            shakeKey={shakeKey}
            onPlace={(i, z) => placeOne(player, i, z)}
            onUnplace={(i) => unplace(player, i)}
            onLock={() => lock(player)}
            onTooMany={tooMany}
          />
        ) : null}

        {stage === 'passB' ? (
          <PassScreen
            passerName={names.A}
            receiverName={names.B}
            lookAway={t.lookAway}
            passTo={t.passTo}
            imPlayer={t.imPlayer}
            showCards={t.showCards}
            onReveal={() => setStage('placeB')}
          />
        ) : null}

        {stage === 'roundReveal' || stage === 'matchOver' ? (
          <Board
            key={`reveal-${match.round}`}
            match={match}
            player="A"
            names={names}
            displayRound={displayRound}
            isRevealing={true}
            isMatchOver={stage === 'matchOver'}
            results={results}
            winner={winner}
            explanations={explanations}
            shakeKey={0}
            onPlace={() => {}}
            onUnplace={() => {}}
            onLock={() => {}}
            onTooMany={() => {}}
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
      </div>
    </Stage>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Collection } from '../game/collection';
import type { GameConfig } from '../game/config';
import type { PlayerView } from '../game/controller';
import { LocalController } from '../game/localController';
import type { Player } from '../game/match';
import type { Players } from '../storage/playersStore';
import { Stage } from '../components/Stage';
import { Board } from '../components/match/Board';
import { PassScreen } from '../components/match/PassScreen';
import { TitleScreen } from '../components/match/TitleScreen';
import { TopBar } from '../components/match/TopBar';
import { TimerCountdown } from '../components/match/TimerCountdown';
import { CustomGameSetup } from './CustomGameSetup';
import { fmt, useI18n } from '../i18n';

type ScreenStage =
  'idle' | 'customSetup' | 'passA' | 'passB' | 'playing' | 'roundReveal' | 'complete';

const emptyView: PlayerView = {
  seat: 'A',
  phase: 'idle',
  round: 1,
  config: {
    mode: 'quick',
    deck: { kind: 'normal' },
    dealing: 'reveal-all',
    drawPerRound: 2,
    maxPlacedPerRound: 2,
    power: 'random',
    fixedPower: {},
    effectsEnabled: true,
  },
  hand: [],
  boards: [],
  locks: { A: false, B: false },
  ready: { me: false, opponent: false },
  opponentHandCount: 0,
  deadlineMs: null,
  drawsRemaining: 0,
  results: null,
  winner: null,
  explanations: null,
};

export function QuickPlay({
  collection,
  players,
  onPlayersChange,
  onMatchActiveChange,
  onOpenDeck,
  onPlayOnline,
}: {
  collection: Collection;
  players: Players;
  onPlayersChange: (players: Players) => void;
  onMatchActiveChange?: (active: boolean) => void;
  onOpenDeck: () => void;
  onPlayOnline?: () => void;
}) {
  const { t } = useI18n();
  const controllerRef = useRef<LocalController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new LocalController(collection);
  }
  const controller = controllerRef.current;
  const [view, setView] = useState<PlayerView>(emptyView);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [stage, setStage] = useState<ScreenStage>('idle');
  const [notice, setNotice] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [drawAnimKey, setDrawAnimKey] = useState(0);
  const [drawnHandIndex, setDrawnHandIndex] = useState(-1);
  const [drawAnimating, setDrawAnimating] = useState(false);
  const names: Record<Player, string> = { A: players.p1, B: players.p2 };

  useEffect(() => controller.subscribe(setView), [controller]);
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => onMatchActiveChange?.(stage !== 'idle'), [stage, onMatchActiveChange]);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), 2200);
    return () => window.clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    return controller.onReject((reason) => {
      if (reason.startsWith('Place at most')) {
        setShakeKey((key) => key + 1);
        setNotice(fmt(t.maxPlacedNotice, { max: viewRef.current.config.maxPlacedPerRound }));
      } else {
        setNotice(reason);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);
  // Local clock for the memoized countdown (ticks internally; this screen
  // never re-renders per tick, so Board stays still between moves).
  const localNow = useCallback(() => Date.now(), []);
  useEffect(() => {
    if (view.phase === 'roundReveal') setStage('roundReveal');
    if (view.phase === 'complete') setStage('complete');
  }, [view.phase]);

  function startQuickPlay() {
    controller.startQuickPlay();
    setStage('passA');
  }
  function startCustomGame(config: GameConfig) {
    controller.startCustomGame(config);
    setStage('passA');
  }
  function beginSeat(seat: Player) {
    controller.setSeat(seat);
    // Empty-hand auto-lock may have revealed already (both locked).
    if (controller.phase() !== 'placing') return;
    // Skip an empty seat's turn entirely: nothing to place, hand straight on.
    if (seat === 'A' && controller.isSeatEmpty('A')) {
      setStage('passB');
      return;
    }
    setStage('playing');
  }
  function lock() {
    controller.send({ type: 'lock' });
    // B auto-locked-empty (or a reveal already fired): no pass screen.
    if (controller.phase() !== 'placing') return;
    if (view.seat === 'A' && !controller.isSeatEmpty('B')) setStage('passB');
  }
  function draw() {
    setDrawnHandIndex(view.hand.length);
    setDrawAnimKey((key) => key + 1);
    setDrawAnimating(true);
    window.setTimeout(() => setDrawAnimating(false), 720);
    controller.send({ type: 'draw' });
  }
  function endMatch() {
    controller.endMatch();
    setStage('idle');
    setNotice('');
  }

  const displayRound = stage === 'roundReveal' ? Math.max(1, view.round - 1) : view.round;
  if (stage === 'idle' || stage === 'customSetup') {
    return (
      <Stage>
        {stage === 'customSetup' ? (
          <CustomGameSetup onBack={() => setStage('idle')} onStart={startCustomGame} />
        ) : (
          <TitleScreen
            players={players}
            onPlayersChange={onPlayersChange}
            onPlay={startQuickPlay}
            onOpenDeck={onOpenDeck}
            onCustomGame={() => setStage('customSetup')}
            onPlayOnline={onPlayOnline}
          />
        )}
        {notice ? (
          <p className="toast-notice" role="status">
            {notice}
          </p>
        ) : null}
      </Stage>
    );
  }

  return (
    <Stage>
      <div className="match-screen">
        <TopBar
          displayRound={displayRound}
          timer={
            stage === 'playing' && view.deadlineMs !== null ? (
              <TimerCountdown deadlineMs={view.deadlineMs} nowFn={localNow} />
            ) : undefined
          }
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
            onReveal={() => beginSeat('A')}
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
            onReveal={() => beginSeat('B')}
          />
        ) : null}
        {stage === 'playing' || stage === 'roundReveal' || stage === 'complete' ? (
          <Board
            key={`${view.seat}-${view.round}-${stage}`}
            view={view}
            names={names}
            displayRound={displayRound}
            isRevealing={stage !== 'playing'}
            isMatchOver={stage === 'complete'}
            results={view.results}
            winner={view.winner}
            explanations={view.explanations}
            shakeKey={shakeKey}
            onPlace={(handIndex, zone) => controller.send({ type: 'place', handIndex, zone })}
            onUnplace={(handIndex) => controller.send({ type: 'unplace', handIndex })}
            onLock={lock}
            onTooMany={() => {
              setShakeKey((key) => key + 1);
              setNotice(fmt(t.maxPlacedNotice, { max: view.config.maxPlacedPerRound }));
            }}
            drawPileCount={view.drawPileCount}
            drawsRemaining={view.drawsRemaining}
            drawAnimKey={drawAnimKey}
            drawnHandIndex={drawnHandIndex}
            drawAnimating={drawAnimating}
            onDraw={draw}
            onNextRound={() => {
              controller.nextRound();
              // Both-empty rounds auto-reveal; the phase effect sets the stage.
              if (controller.phase() !== 'placing') return;
              setStage(controller.isSeatEmpty('A') ? 'passB' : 'passA');
            }}
            onRematch={() => {
              controller.send({ type: 'rematch' });
              setStage('passA');
            }}
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

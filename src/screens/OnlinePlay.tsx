import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_GAME_CONFIG, validateGameConfig, type GameConfig } from '../game/config';
import type { PlayerView } from '../game/controller';
import { type Player } from '../game/match';
import type { Players } from '../storage/playersStore';
import { Stage } from '../components/Stage';
import { Board } from '../components/match/Board';
import { TopBar } from '../components/match/TopBar';
import { ReadyCountdown, TimerCountdown } from '../components/match/TimerCountdown';
import { CustomGameSetup } from './CustomGameSetup';
import { fmt, useI18n } from '../i18n';
import {
  createOnlineRoom,
  joinOnlineRoom,
  previewOnlineRoom,
  OnlineHttpError,
  serverBaseUrl,
} from '../net/http';
import { OnlineController, type OnlineMeta } from '../net/onlineController';
import { clearSession, saveSession, type OnlineSession } from '../net/sessionStore';

type OnlineStage =
  | 'lobby'
  | 'customSetup'
  | 'preview'
  | 'waiting'
  | 'playing'
  | 'roundReveal'
  | 'complete'
  | 'ended';

const emptyView: PlayerView = {
  seat: 'A',
  phase: 'idle',
  round: 1,
  config: DEFAULT_GAME_CONFIG,
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

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((ch) => CODE_CHARS.includes(ch))
    .join('')
    .slice(0, 6);
}

export function OnlinePlay({
  players,
  resumeSession,
  onExit,
}: {
  players: Players;
  resumeSession?: OnlineSession | null;
  onExit: () => void;
}) {
  const { t } = useI18n();
  const [stage, setStage] = useState<OnlineStage>('lobby');
  const [name, setName] = useState(players.p1);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'idle' | 'creating' | 'joining'>('idle');
  const [view, setView] = useState<PlayerView>(emptyView);
  const [meta, setMeta] = useState<OnlineMeta>({
    connection: 'connecting',
    opponentConnected: false,
    readyDeadlineMs: null,
    closeReason: null,
    names: { me: '', opponent: '' },
    needsRefresh: false,
  });
  const [notice, setNotice] = useState('');
  const [endedKind, setEndedKind] = useState<'forfeit' | 'ended'>('ended');
  const [shakeKey, setShakeKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [pendingRematch, setPendingRematch] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [previewData, setPreviewData] = useState<{
    code: string;
    config: GameConfig;
    hostName: string;
  } | null>(null);
  const [drawAnimKey, setDrawAnimKey] = useState(0);
  const [drawnHandIndex, setDrawnHandIndex] = useState(-1);
  const [drawAnimating, setDrawAnimating] = useState(false);
  const controllerRef = useRef<OnlineController | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [seat, setSeat] = useState<Player>(resumeSession?.seat ?? 'A');
  const baseUrl = serverBaseUrl();

  function attach(controller: OnlineController, roomCode: string) {
    controllerRef.current?.dispose();
    controllerRef.current = controller;
    setSeat(controller.mySeat);
    setCode(roomCode);
    controller.subscribe(setView);
    controller.onConnection(setMeta);
    controller.onReject((reason) => {
      if (reason.startsWith('Place at most')) {
        setShakeKey((key) => key + 1);
        setNotice(fmt(t.maxPlacedNotice, { max: viewRef.current.config.maxPlacedPerRound }));
      } else if (reason === 'not-connected') {
        setNotice(t.onlineReconnecting);
      } else {
        setNotice(reason);
      }
    });
    controller.connect();
  }

  const handleSessionGone = () => {
    clearSession().catch(() => {});
    setEndedKind('ended');
    setStage('ended');
    setNotice(t.onlineMatchEnded);
  };

  useEffect(() => {
    if (resumeSession) {
      const controller = new OnlineController(
        resumeSession.seat,
        resumeSession.code,
        resumeSession.token,
        baseUrl,
        { onSessionGone: handleSessionGone }
      );
      attach(controller, resumeSession.code);
      setStage('waiting');
    }
    return () => controllerRef.current?.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => controllerRef.current?.dispose(), []);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    if (stage === 'lobby' || stage === 'customSetup' || stage === 'preview' || stage === 'ended')
      return;
    if (view.phase === 'roundReveal') {
      setStage('roundReveal');
    } else if (view.phase === 'complete') {
      setStage('complete');
      setPendingRematch(false);
    } else if (view.phase === 'placing') {
      setStage(meta.opponentConnected ? 'playing' : 'waiting');
    }
  }, [view.phase, meta.opponentConnected, stage]);
  useEffect(() => {
    if (meta.connection === 'closed') {
      setEndedKind(meta.closeReason === 'forfeit' ? 'forfeit' : 'ended');
      setStage('ended');
      if (meta.closeReason === 'gone' || meta.closeReason === 'bad-token') {
        setNotice(t.onlineMatchEnded);
      }
    }
  }, [meta.connection, meta.closeReason, t]);

  // Skew-corrected server clock for the memoized countdowns (they tick
  // internally once per second; this screen never re-renders per tick).
  const serverNow = useCallback(() => controllerRef.current?.serverNowMs() ?? Date.now(), []);

  async function create(config: GameConfig = DEFAULT_GAME_CONFIG) {
    const trimmed = name.trim();
    if (!trimmed || busy !== 'idle') return;
    // Validate before calling the server; UI should already block this but
    // the check is cheap and gives a clear notice if somehow bypassed.
    const configError = validateGameConfig(config);
    if (configError) {
      setNotice(configError);
      return;
    }
    setBusy('creating');
    try {
      const room = await createOnlineRoom(baseUrl, trimmed, config);
      await saveSession({ code: room.code, token: room.token, seat: room.seat });
      const controller = new OnlineController(room.seat, room.code, room.token, baseUrl, {
        onSessionGone: handleSessionGone,
      });
      attach(controller, room.code);
      setStage('waiting');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy('idle');
    }
  }

  async function startJoin() {
    const trimmed = name.trim();
    const clean = normalizeCode(code);
    if (!trimmed || clean.length !== 6 || busy !== 'idle') return;
    setBusy('joining');
    try {
      const preview = await previewOnlineRoom(baseUrl, clean);
      setPreviewData({ code: clean, config: preview.config, hostName: preview.hostName });
      setStage('preview');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy('idle');
    }
  }

  async function confirmJoin(roomCode: string) {
    const trimmed = name.trim();
    if (!trimmed || busy !== 'idle') return;
    setBusy('joining');
    try {
      const room = await joinOnlineRoom(baseUrl, roomCode, trimmed);
      await saveSession({ code: roomCode, token: room.token, seat: room.seat });
      const controller = new OnlineController(room.seat, roomCode, room.token, baseUrl, {
        onSessionGone: handleSessionGone,
      });
      attach(controller, roomCode);
      setStage('waiting');
    } catch (error) {
      // Room disappeared between preview and join: give a clear, specific message.
      if (error instanceof OnlineHttpError) {
        const k = error.failure.kind;
        setNotice(k === 'gone' || k === 'full' ? t.onlineRoomGone : errorMessage(error));
      } else {
        setNotice(errorMessage(error));
      }
      setStage('lobby');
    } finally {
      setBusy('idle');
      setPreviewData(null);
    }
  }

  function errorMessage(error: unknown): string {
    if (error instanceof OnlineHttpError) {
      if (error.failure.kind === 'busy') return t.onlineBusy;
      if (error.failure.kind === 'unreachable') return t.onlineUnreachable;
      if (error.failure.kind === 'gone') return t.onlineMatchEnded;
      if (error.failure.kind === 'full') return t.onlineBusy;
      return error.failure.kind === 'bad' ? error.failure.message : t.onlineBusy;
    }
    return t.onlineBusy;
  }

  function send(intent: Parameters<OnlineController['send']>[0]) {
    controllerRef.current?.send(intent);
  }

  function leave() {
    controllerRef.current?.dispose();
    controllerRef.current = null;
    clearSession().catch(() => {});
    onExit();
  }

  function requestLeave() {
    if (stage === 'playing' || stage === 'roundReveal' || stage === 'waiting') {
      if (window.confirm(t.onlineLeaveSure)) {
        leave();
      }
    } else {
      leave();
    }
  }

  function copyCode() {
    const text = code;
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      done();
    }
  }

  const me = name.trim() || players.p1;
  // Server envelope names (sanitized, max 20 code points); local name until
  // the first frame arrives. Rendered as plain text inside <bdi> only.
  const myName = meta.names.me || me;
  const foeName = meta.names.opponent || (seat === 'A' ? 'Player B' : 'Player A');
  const names: Record<Player, string> =
    seat === 'A' ? { A: myName, B: foeName } : { A: foeName, B: myName };
  const displayRound = stage === 'roundReveal' ? Math.max(1, view.round - 1) : view.round;
  const showTimer = stage === 'playing' && view.deadlineMs !== null;
  // ── customSetup: host customises config before creating the room ──────────
  if (stage === 'customSetup') {
    return (
      <Stage>
        <CustomGameSetup
          onBack={() => setStage('lobby')}
          onStart={(cfg) => {
            setStage('lobby');
            create(cfg);
          }}
        />
      </Stage>
    );
  }

  if (stage === 'lobby') {
    return (
      <Stage>
        <section className="online-lobby" aria-label={t.onlineTitle}>
          <h2>{t.onlineTitle}</h2>
          <label>
            {t.onlineName}
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="online-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!name.trim() || busy !== 'idle'}
              onClick={() => create()}
            >
              {busy === 'creating' ? t.onlineCreating : t.onlineCreateQuick}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!name.trim() || busy !== 'idle'}
              onClick={() => setStage('customSetup')}
            >
              {t.onlineCreateCustom}
            </button>
          </div>
          <div className="online-join">
            <label>
              {t.onlineCode}
              <input
                value={code}
                maxLength={6}
                autoCapitalize="characters"
                autoCorrect="off"
                onChange={(e) => setCode(normalizeCode(e.target.value))}
                placeholder="ABCDEF"
              />
            </label>
            <span className="online-hint">{t.onlineCodeHint}</span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!name.trim() || normalizeCode(code).length !== 6 || busy !== 'idle'}
              onClick={startJoin}
            >
              {busy === 'joining' ? t.onlineJoining : t.onlineJoin}
            </button>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onExit}>
            {t.setupBack}
          </button>
          {notice ? (
            <p className="toast-notice" role="status">
              {notice}
            </p>
          ) : null}
        </section>
      </Stage>
    );
  }

  if (stage === 'preview' && previewData) {
    const cfg = previewData.config;
    const isCustom = cfg.mode === 'custom';
    const flavors = cfg.deck.kind === 'custom' ? cfg.deck.flavors : null;
    return (
      <Stage>
        <div className="match-screen">
          <TopBar
            displayRound={1}
            onMenu={() => {
              setPreviewData(null);
              setStage('lobby');
            }}
          />
          <section className="online-waiting settings-review" aria-label={t.onlineMatchSettings}>
            <h3>{t.onlineMatchSettings}</h3>
            <p className="settings-review-hint">
              {isCustom ? t.onlineRulesHeading : t.quickPlayTitle}
            </p>
            <ul className="settings-review-list">
              {flavors ? (
                <li>
                  {t.customDeck}: {flavors.map((id) => t.flavors[id] || id).join(', ')}
                </li>
              ) : null}
              <li>
                {t.maxPlaced}: {cfg.maxPlacedPerRound}
              </li>
              {cfg.dealing === 'draw-per-round' ? (
                <li>
                  {t.drawPerRound}: {cfg.drawPerRound}
                </li>
              ) : null}
              {!cfg.effectsEnabled ? <li>{t.effectsOff}</li> : null}
              {cfg.power === 'fixed' ? <li>{t.fixedPower}</li> : null}
            </ul>
            <div className="online-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== 'idle'}
                onClick={() => confirmJoin(previewData.code)}
              >
                {busy === 'joining' ? t.onlineJoining : t.onlineAcceptSettings}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy !== 'idle'}
                onClick={() => {
                  setPreviewData(null);
                  setStage('lobby');
                }}
              >
                {t.onlineLeave}
              </button>
            </div>
          </section>
        </div>
      </Stage>
    );
  }

  if (stage === 'waiting' && !meta.opponentConnected && view.phase !== 'complete') {
    return (
      <Stage>
        <div className="match-screen">
          <TopBar displayRound={1} onMenu={requestLeave} />
          <section className="online-waiting" aria-label={t.onlineWaiting}>
            <p className="online-room-code">{code || view.seat}</p>
            <button type="button" className="btn btn-secondary" onClick={copyCode}>
              {copied ? t.onlineCopied : t.onlineCopy}
            </button>
            <p role="status">{t.onlineWaiting}</p>
            {meta.connection === 'reconnecting' || meta.connection === 'connecting' ? (
              <p role="status">{t.onlineReconnecting}</p>
            ) : null}
            {notice ? (
              <p className="toast-notice" role="status">
                {notice}
              </p>
            ) : null}
          </section>
        </div>
      </Stage>
    );
  }

  if (stage === 'ended') {
    return (
      <Stage>
        <div className="match-screen">
          <section className="online-ended" aria-label={t.onlineMatchEnded}>
            <p role="status">
              {endedKind === 'forfeit' ? t.onlineYouWinForfeit : t.onlineMatchEnded}
            </p>
            <button type="button" className="btn btn-primary" onClick={leave}>
              {t.returnToMenu}
            </button>
          </section>
        </div>
      </Stage>
    );
  }

  return (
    <Stage>
      <div className="match-screen">
        <TopBar
          displayRound={displayRound}
          timer={
            showTimer && view.deadlineMs !== null ? (
              <TimerCountdown deadlineMs={view.deadlineMs} nowFn={serverNow} />
            ) : undefined
          }
          onMenu={requestLeave}
          names={{ me: myName, opponent: foeName }}
        />
        {meta.needsRefresh ? (
          <div className="thin-banner" role="alert">
            <span className="resolution-text">{t.onlineUpdateReload}</span>
          </div>
        ) : null}
        {meta.connection === 'reconnecting' || meta.connection === 'connecting' ? (
          <div className="thin-banner" role="status">
            <span className="resolution-text">
              {t.onlineReconnecting} <bdi>{foeName}</bdi>
            </span>
          </div>
        ) : null}
        {meta.connection === 'opponent-disconnected' ? (
          <div className="thin-banner" role="status">
            <span className="resolution-text">
              {t.onlineOppGone} <bdi>{foeName}</bdi>
            </span>
          </div>
        ) : null}
        {meta.connection === 'unreachable' ? (
          <div className="thin-banner" role="alert">
            <span className="resolution-text">{t.onlineUnreachable}</span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => controllerRef.current?.retry()}
            >
              {t.onlineRetry}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => (confirmLeave ? leave() : setConfirmLeave(true))}
            >
              {confirmLeave ? t.onlineLeaveSure : t.onlineLeave}
            </button>
          </div>
        ) : null}
        {stage === 'roundReveal' && meta.readyDeadlineMs !== null ? (
          <div className="thin-banner" role="status">
            <ReadyCountdown readyDeadlineMs={meta.readyDeadlineMs} nowFn={serverNow} />
          </div>
        ) : null}
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
          onPlace={(handIndex, zone) => send({ type: 'place', handIndex, zone })}
          onUnplace={(handIndex) => send({ type: 'unplace', handIndex })}
          onLock={() => send({ type: 'lock' })}
          onTooMany={() => {
            setShakeKey((key) => key + 1);
            setNotice(fmt(t.maxPlacedNotice, { max: view.config.maxPlacedPerRound }));
          }}
          drawPileCount={view.drawPileCount}
          drawsRemaining={view.drawsRemaining}
          drawAnimKey={drawAnimKey}
          drawnHandIndex={drawnHandIndex}
          drawAnimating={drawAnimating}
          onDraw={() => {
            setDrawnHandIndex(view.hand.length);
            setDrawAnimKey((key) => key + 1);
            setDrawAnimating(true);
            window.setTimeout(() => setDrawAnimating(false), 720);
            send({ type: 'draw' });
          }}
          onNextRound={() => send({ type: 'ready' })}
          awaitingOpponent={view.ready.me}
          readyCountdown={
            meta.readyDeadlineMs !== null ? (
              <ReadyCountdown readyDeadlineMs={meta.readyDeadlineMs} nowFn={serverNow} />
            ) : undefined
          }
          onRematch={() => {
            send({ type: 'rematch' });
            setPendingRematch(true);
          }}
          onReturnMenu={leave}
        />
        {pendingRematch && stage === 'complete' ? (
          <p className="toast-notice" role="status">
            {t.onlineWaitingRematch}
          </p>
        ) : null}
        {notice && !pendingRematch ? (
          <p className="toast-notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>
    </Stage>
  );
}

import { fmt, useI18n } from '../../i18n';
import { QuickGuide } from '../QuickGuide';
import { ExitIcon } from '../icons';
import type { ReactNode } from 'react';

/** Round pips: 3 dots, current lit. */
export function RoundPips({ current, total = 3 }: { current: number; total?: number }) {
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

/** Circular timer ring with the whole-second count BESIDE it (never over it). */
export function TimerRing({ seconds, total }: { seconds: number; total: number }) {
  const r = 11;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, seconds / total));
  const urgent = seconds <= 10;
  return (
    <span
      className={`timer-ring${urgent ? ' urgent' : ''}`}
      role="timer"
      aria-label={`${seconds}s`}
    >
      <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
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

/** Slim match top bar: menu left, round pips + timer + guide right. */
export function TopBar({
  displayRound,
  timer,
  onMenu,
  names,
}: {
  displayRound: number;
  /** Memoized countdown element (ticks internally; never re-renders the bar). */
  timer?: ReactNode;
  onMenu: () => void;
  /** Optional "me · opponent" names (plain text, bidi-isolated). */
  names?: { readonly me: string; readonly opponent: string };
}) {
  const { t } = useI18n();
  return (
    <div className="game-topbar">
      <button
        type="button"
        className="icon-btn"
        onClick={onMenu}
        aria-label={t.exitMatch}
        title={t.exitMatch}
      >
        <ExitIcon size={20} />
      </button>
      <div className="game-topbar-info">
        <RoundPips current={displayRound} />
        <span className="game-round-indicator">{fmt(t.roundN, { n: displayRound })}</span>
        {names ? (
          <span className="topbar-names" aria-label={`${names.me} vs ${names.opponent}`}>
            <bdi>{names.me}</bdi>
            <span aria-hidden="true"> · </span>
            <bdi>{names.opponent}</bdi>
          </span>
        ) : null}
        {timer}
        <div className="legend-pop-wrap">
          <QuickGuide />
        </div>
      </div>
    </div>
  );
}

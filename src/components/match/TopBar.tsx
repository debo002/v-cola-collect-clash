import { fmt, useI18n } from '../../i18n';
import { QuickGuide } from '../QuickGuide';
import { ExitIcon } from '../icons';
import { requestAppFullscreen, useFullscreenUI } from '../FullscreenFab';
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

/** Compact, non-overlapping whole-second countdown. */
export function TimerReadout({ seconds }: { seconds: number }) {
  const urgent = seconds <= 10;
  return (
    <span
      className={`timer-readout${urgent ? ' urgent' : ''}`}
      role="timer"
      aria-label={`${seconds} seconds remaining`}
    >
      {seconds}
    </span>
  );
}

/** In-match fullscreen toggle: lives in the top bar (inside the stage) so
 * the floating button never has to compete with it for the corner. */
function TopBarFullscreen() {
  const { t } = useI18n();
  const { supported, hidden } = useFullscreenUI();
  if (!supported || hidden) return null;
  return (
    <button
      type="button"
      className="icon-btn topbar-fs-btn"
      onClick={requestAppFullscreen}
      aria-label={t.fullscreen}
      title={t.fullscreen}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M3.5 7V3.5H7M13 3.5h3.5V7M16.5 13v3.5H13M7 16.5H3.5V13"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
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
        <TopBarFullscreen />
        <div className="legend-pop-wrap">
          <QuickGuide />
        </div>
      </div>
    </div>
  );
}

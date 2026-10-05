import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { tryLockLandscape } from './Stage';

const DISMISS_KEY = 'vcola-fs-hint-dismissed';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // Private mode / blocked storage: treat as not dismissed.
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Private mode / blocked storage: dismissal just won't persist.
  }
}

function installedAsPwa(): boolean {
  try {
    const mq = (q: string) => window.matchMedia?.(q)?.matches === true;
    if (mq('(display-mode: fullscreen)') || mq('(display-mode: standalone)')) return true;
  } catch {
    // matchMedia unavailable — fall through to the iOS check.
  }
  try {
    if ((window.navigator as { standalone?: boolean }).standalone === true) return true;
  } catch {
    // Ignore — not installed.
  }
  return false;
}

/** Fullscreen available and meaningful (not already fullscreen / installed). */
export function useFullscreenUI(): {
  supported: boolean;
  hidden: boolean;
  inMatch: boolean;
} {
  const [fsActive, setFsActive] = useState(false);
  const [pwa, setPwa] = useState(false);
  const [inMatch, setInMatch] = useState(false);
  useEffect(() => {
    const update = () => {
      setFsActive(document.fullscreenElement != null);
      setPwa(installedAsPwa());
      // The match owns the top-right corner (top bar); the floating button
      // hides there and the top bar hosts its own fullscreen toggle.
      setInMatch(document.querySelector('.match-screen, .game-topbar') != null);
    };
    update();
    document.addEventListener('fullscreenchange', update);
    window.addEventListener('resize', update);
    let mq1: MediaQueryList | null = null;
    let mq2: MediaQueryList | null = null;
    try {
      mq1 = window.matchMedia('(display-mode: fullscreen)');
      mq2 = window.matchMedia('(display-mode: standalone)');
      mq1?.addEventListener?.('change', update);
      mq2?.addEventListener?.('change', update);
    } catch {
      // Media queries unsupported — fullscreenchange + resize cover it.
    }
    let mo: MutationObserver | null = null;
    try {
      mo = new MutationObserver(update);
      mo.observe(document.body, { childList: true, subtree: true });
    } catch {
      // MutationObserver unavailable — update on fullscreen/resize events only.
    }
    return () => {
      document.removeEventListener('fullscreenchange', update);
      window.removeEventListener('resize', update);
      try {
        mq1?.removeEventListener?.('change', update);
        mq2?.removeEventListener?.('change', update);
      } catch {
        // Ignore listener cleanup failures.
      }
      try {
        mo?.disconnect();
      } catch {
        // Ignore disconnect failures.
      }
    };
  }, []);
  const supported =
    typeof document !== 'undefined' &&
    (document.fullscreenEnabled === true ||
      typeof document.documentElement?.requestFullscreen === 'function');
  return { supported, hidden: fsActive || pwa, inMatch };
}

/** Fullscreen enter (user gesture): fullscreen first, then landscape lock. */
export function requestAppFullscreen(): void {
  try {
    const p = document.documentElement.requestFullscreen?.() as Promise<void> | undefined;
    p?.catch?.(() => {});
  } catch {
    // Unsupported — the iOS hint path renders instead of this button.
  }
  tryLockLandscape();
}

/**
 * Viewport-pinned fullscreen toggle (outside the scaled stage, so short
 * viewports can never crop it). Renders on menu screens only — during a
 * match the top bar hosts its own toggle (see TopBar).
 */
export function FullscreenFab() {
  const { t } = useI18n();
  const { supported, hidden, inMatch } = useFullscreenUI();
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(readDismissed());
  }, []);
  if (hidden || inMatch) return null;
  if (!supported) {
    if (dismissed) return null;
    return (
      <div className="fs-hint" role="status">
        <span>{t.addToHomeHint}</span>
        <button
          type="button"
          className="fs-hint-close"
          aria-label="Dismiss"
          onClick={() => {
            setDismissed(true);
            writeDismissed();
          }}
        >
          ✕
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="btn btn-secondary fs-fab"
      aria-label={t.fullscreen}
      title={t.fullscreen}
      onClick={requestAppFullscreen}
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

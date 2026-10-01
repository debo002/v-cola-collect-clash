import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';

/**
 * Landscape stage shell (MASTER.md spacing/motion; brand tokens untouched).
 *
 * Fixed design height (STAGE_H) with flexible design width (MIN_W–MAX_W).
 * Scaled by HEIGHT ONLY: scale = max(viewportH / STAGE_H, MIN_SCALE), so the
 * board looks identical on phone, laptop and projector. On-screen pixels =
 * stage px × scale, so 44px touch targets need >= 55 stage px at min scale.
 */
export const STAGE_H = 480;
export const STAGE_MIN_W = 720;
export const STAGE_MAX_W = 1100;
export const STAGE_MIN_SCALE = 0.8;

interface ScaleInfo {
  scale: number;
  stageW: number;
}

const ScaleContext = createContext<ScaleInfo>({ scale: 1, stageW: STAGE_MIN_W });

export function useStageScale(): ScaleInfo {
  return useContext(ScaleContext);
}

function viewportSize(): { w: number; h: number } {
  return { w: window.innerWidth, h: window.innerHeight };
}

/** Best-effort landscape lock; must run in a user gesture. Never throws. */
export function tryLockLandscape(): void {
  try {
    const orient = window.screen?.orientation as
      { lock?: (o: string) => Promise<void> } | undefined;
    orient?.lock?.('landscape')?.catch(() => {});
  } catch {
    // Silently ignore — unsupported browsers just stay unlocked.
  }
}

export function Stage({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [{ w, h }, setSize] = useState(viewportSize);

  useEffect(() => {
    const onResize = () => setSize(viewportSize());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  const portrait = h > w;
  const scale = Math.max(h / STAGE_H, STAGE_MIN_SCALE);
  const stageW = Math.min(STAGE_MAX_W, Math.max(STAGE_MIN_W, w / scale));
  const [lockTried, setLockTried] = useState(false);

  // Nudge the OS toward landscape on first landscape paint (no gesture, may fail silently).
  useEffect(() => {
    if (!portrait && !lockTried) {
      setLockTried(true);
      tryLockLandscape();
    }
  }, [portrait, lockTried]);

  // Portrait: full-screen rotate gate instead of a squeezed layout.
  if (portrait) {
    return (
      <div className="viewport">
        <div className="rotate-gate" role="alert">
          <RotateIcon />
          <strong>{t.rotateTitle}</strong>
          <p>{t.rotateDesc}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="viewport">
      <ScaleContext.Provider value={{ scale, stageW }}>
        <div
          className="stage"
          style={{ width: `${stageW}px`, height: `${STAGE_H}px`, transform: `scale(${scale})` }}
        >
          {children}
        </div>
      </ScaleContext.Provider>
    </div>
  );
}

function RotateIcon() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 18.5h2" />
      <path d="M3 8a9 9 0 0 1 3-3" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

/** Re-lock hook for buttons that start immersive play (call in onClick). */
export function useLandscapeLock(): () => void {
  return useCallback(() => tryLockLandscape(), []);
}

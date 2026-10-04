import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * Match stage shell (MASTER.md spacing/motion; brand tokens untouched).
 *
 * Landscape uses a fixed design height and scales to the viewport. Portrait
 * uses the available viewport directly and adapts its layout in CSS.
 */
export const STAGE_H = 480;
export const STAGE_MIN_W = 720;
export const STAGE_MAX_W = 1100;
/** Absolute floor so targets never shrink past usability in landscape. */
export const STAGE_MIN_SCALE = 0.75;

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
  // Portrait uses a responsive layout; landscape retains the fixed design stage.
  const scale = portrait ? 1 : Math.max(Math.min(h / STAGE_H, w / STAGE_MIN_W), STAGE_MIN_SCALE);
  const stageW = portrait ? w : Math.min(STAGE_MAX_W, Math.max(STAGE_MIN_W, w / scale));
  const stageH = portrait ? h : STAGE_H;
  const [lockTried, setLockTried] = useState(false);

  // Nudge the OS toward landscape on first landscape paint (no gesture, may fail silently).
  useEffect(() => {
    if (!portrait && !lockTried) {
      setLockTried(true);
      tryLockLandscape();
    }
  }, [portrait, lockTried]);

  return (
    <div className="viewport">
      <ScaleContext.Provider value={{ scale, stageW }}>
        <div
          className={`stage${portrait ? ' stage-portrait' : ''}`}
          style={{ width: `${stageW}px`, height: `${stageH}px`, transform: `scale(${scale})` }}
        >
          {children}
        </div>
      </ScaleContext.Provider>
    </div>
  );
}

/** Re-lock hook for buttons that start immersive play (call in onClick). */
export function useLandscapeLock(): () => void {
  return useCallback(() => tryLockLandscape(), []);
}

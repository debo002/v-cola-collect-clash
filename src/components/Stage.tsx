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
/** Floor so the stage never crops: scale always fits height AND width. */
export const STAGE_MIN_SCALE = 0.5;
/** Below this scale the stage gets .stage-compact (short-screen CSS). */
export const STAGE_COMPACT_SCALE = 0.7;

interface ScaleInfo {
  scale: number;
  stageW: number;
}

const ScaleContext = createContext<ScaleInfo>({ scale: 1, stageW: STAGE_MIN_W });

export function useStageScale(): ScaleInfo {
  return useContext(ScaleContext);
}

function viewportSize(): { w: number; h: number } {
  // visualViewport excludes the mobile URL bar / keyboard when present;
  // fall back to innerWidth/innerHeight where unsupported.
  try {
    const vv = window.visualViewport;
    if (vv && vv.width > 0 && vv.height > 0) return { w: vv.width, h: vv.height };
  } catch {
    // Ignore and fall through to innerWidth/innerHeight.
  }
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
    try {
      window.visualViewport?.addEventListener('resize', onResize);
    } catch {
      // visualViewport listeners unsupported — window resize covers it.
    }
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      try {
        window.visualViewport?.removeEventListener('resize', onResize);
      } catch {
        // Ignore cleanup failures for unsupported visualViewport.
      }
    };
  }, []);

  const portrait = h > w;
  // Portrait uses a responsive layout; landscape retains the fixed design stage.
  // Scale is never clamped above what fits, so the stage letterboxes
  // (centered with margins) instead of cropping on short viewports.
  const scale = portrait ? 1 : Math.max(Math.min(h / STAGE_H, w / STAGE_MIN_W), STAGE_MIN_SCALE);
  const compact = !portrait && scale < STAGE_COMPACT_SCALE;
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
          className={`stage${portrait ? ' stage-portrait' : ''}${compact ? ' stage-compact' : ''}`}
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

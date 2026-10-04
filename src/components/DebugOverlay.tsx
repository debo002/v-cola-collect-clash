import { useEffect, useRef, useState } from 'react';
import { lastIntentViewRtt } from '../net/perfProbe';

/**
 * ?debug=1 overlay (off by default): FPS, p95 frame time over the last 5s,
 * last intent→view round trip, viewport, DPR and safe-area insets. Read it
 * on a real phone; zero cost when the query param is absent.
 */
export function DebugOverlay() {
  const [text, setText] = useState('debug…');
  const frames = useRef<number[]>([]);
  const probeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frames.current.push(now - last);
      last = now;
      // Keep ~6s of frames.
      if (frames.current.length > 600) frames.current.splice(0, frames.current.length - 600);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const id = window.setInterval(() => {
      const deltas = frames.current.slice(-300);
      const sorted = [...deltas].sort((a, b) => a - b);
      const p95 = sorted.length > 0 ? (sorted[Math.floor(sorted.length * 0.95)] ?? 0) : 0;
      // FPS over the last ~1s window.
      const recent = deltas.slice(-60);
      const span = recent.reduce((a, b) => a + b, 0);
      const fps = span > 0 ? Math.round((recent.length / span) * 1000) : 0;
      const rtt = lastIntentViewRtt();
      let insets = 'n/a';
      const probe = probeRef.current;
      if (probe) {
        const cs = getComputedStyle(probe);
        insets = `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`;
      }
      setText(
        `fps ${fps} · p95 ${p95.toFixed(1)}ms · rtt ${rtt === null ? '—' : `${Math.round(rtt)}ms`} · ` +
          `${window.innerWidth}x${window.innerHeight} · dpr ${window.devicePixelRatio} · safe ${insets}`
      );
    }, 500);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(id);
    };
  }, []);

  return (
    <>
      <div
        ref={probeRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          pointerEvents: 'none',
          visibility: 'hidden',
        }}
      />
      <div
        role="status"
        style={{
          position: 'fixed',
          left: 4,
          bottom: 4,
          zIndex: 9999,
          fontFamily: 'monospace',
          fontSize: 10,
          lineHeight: 1.4,
          color: '#0f0',
          background: 'rgba(0,0,0,0.75)',
          padding: '2px 6px',
          borderRadius: 4,
          pointerEvents: 'none',
          maxWidth: '96vw',
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </div>
    </>
  );
}

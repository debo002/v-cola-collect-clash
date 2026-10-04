import { memo, useEffect, useState } from 'react';
import { fmt, useI18n } from '../../i18n';
import { TimerReadout } from './TopBar';

/**
 * Whole-second countdowns that tick once per second WITHOUT re-rendering
 * their parents (Board stays untouched by ticks). Seconds are
 * Math.ceil(remaining/1000) — "37", never "36.886".
 */
function useWholeSeconds(deadlineMs: number | null, nowFn: () => number): number | null {
  const [now, setNow] = useState(nowFn);
  useEffect(() => {
    if (deadlineMs === null) return;
    setNow(nowFn());
    // Align the first tick to the next whole-second boundary so the number
    // flips exactly when the second flips.
    const toBoundary = 1000 - (nowFn() % 1000);
    let interval = 0;
    const timeout = window.setTimeout(() => {
      setNow(nowFn());
      interval = window.setInterval(() => setNow(nowFn()), 1000);
    }, toBoundary);
    return () => {
      window.clearTimeout(timeout);
      if (interval !== 0) window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineMs]);
  if (deadlineMs === null) return null;
  return Math.max(0, Math.ceil((deadlineMs - now) / 1000));
}

export const TimerCountdown = memo(function TimerCountdown({
  deadlineMs,
  nowFn,
}: {
  deadlineMs: number;
  nowFn: () => number;
}) {
  const seconds = useWholeSeconds(deadlineMs, nowFn);
  if (seconds === null) return null;
  return <TimerReadout seconds={seconds} />;
});

export const ReadyCountdown = memo(function ReadyCountdown({
  readyDeadlineMs,
  nowFn,
}: {
  readyDeadlineMs: number;
  nowFn: () => number;
}) {
  const { t } = useI18n();
  const seconds = useWholeSeconds(readyDeadlineMs, nowFn);
  if (seconds === null || seconds <= 0) return null;
  return <span className="resolution-text">{fmt(t.onlineReadyIn, { n: seconds })}</span>;
});

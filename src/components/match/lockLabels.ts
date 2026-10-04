import { fmt, type Translations } from '../../i18n';

/**
 * Pure lock/waiting label decisions (no DOM): the pressed state latches from
 * the view (`locks` / `ready`), so it survives reload and reconnect. Unit
 * tested in lockLabels.test.ts; Hand/Board only render the result.
 */
export interface LockButton {
  readonly label: string;
  readonly disabled: boolean;
  /** Status line; empty when the button label already says it. */
  readonly tip: string;
}

export function lockButton(
  t: Translations,
  opts: {
    locked: boolean;
    canLock: boolean;
    placedCount: number;
    maxPlaced: number;
    normalTip: string;
  }
): LockButton {
  if (opts.locked) {
    return {
      label: t.lockedWaiting,
      disabled: true,
      tip: '',
    };
  }
  return {
    label: opts.canLock
      ? fmt(t.lockInCount, { placed: opts.placedCount, max: opts.maxPlaced })
      : t.needOne,
    disabled: !opts.canLock,
    tip: opts.normalTip,
  };
}

export interface NextRoundButton {
  readonly label: string;
  readonly disabled: boolean;
}

export function nextRoundButton(
  t: Translations,
  opts: { awaitingOpponent: boolean; round: number; nextRoundPrefix: string }
): NextRoundButton {
  if (opts.awaitingOpponent) return { label: t.waitingOpp, disabled: true };
  return { label: `${opts.nextRoundPrefix} ${opts.round})`, disabled: false };
}

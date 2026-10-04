import { describe, expect, it } from 'vitest';
import { TRANSLATIONS } from '../../i18n';
import { lockButton, nextRoundButton } from './lockLabels';

const t = TRANSLATIONS.en;
const ar = TRANSLATIONS.ar;

describe('lockLabels', () => {
  it('unpressed: count label when placeable, need-one otherwise', () => {
    expect(
      lockButton(t, {
        locked: false,
        canLock: true,
        placedCount: 1,
        maxPlaced: 2,
        normalTip: 'tip',
      })
    ).toEqual({ label: 'Lock in (1/2)', disabled: false, tip: 'tip' });
    expect(
      lockButton(t, {
        locked: false,
        canLock: false,
        placedCount: 0,
        maxPlaced: 2,
        normalTip: 'tip',
      })
    ).toEqual({ label: t.needOne, disabled: true, tip: 'tip' });
  });

  it('pressed lock latches disabled waiting text (EN + AR)', () => {
    expect(
      lockButton(t, {
        locked: true,
        canLock: false,
        placedCount: 1,
        maxPlaced: 2,
        normalTip: 'tip',
      }).label
    ).toBe('Locked — waiting for opponent…');
    expect(
      lockButton(ar, {
        locked: true,
        canLock: false,
        placedCount: 1,
        maxPlaced: 2,
        normalTip: 'tip',
      }).label
    ).toBe('تم التأكيد — بانتظار الخصم…');
  });

  it('locked state has no extra tip', () => {
    const waiting = lockButton(t, {
      locked: true,
      canLock: false,
      placedCount: 1,
      maxPlaced: 2,
      normalTip: '',
    });
    expect(waiting.disabled).toBe(true);
    expect(waiting.tip).toBe('');
  });

  it('reload while waiting: same view flags recompute the same labels', () => {
    // A reloaded client rebuilds labels from the persisted view only.
    const before = lockButton(t, {
      locked: true,
      canLock: false,
      placedCount: 2,
      maxPlaced: 2,
      normalTip: '',
    });
    const reloaded = JSON.parse(JSON.stringify(before)) as typeof before;
    expect(
      lockButton(t, {
        locked: true,
        canLock: false,
        placedCount: 2,
        maxPlaced: 2,
        normalTip: '',
      })
    ).toEqual(reloaded);
    expect(
      nextRoundButton(t, { awaitingOpponent: true, round: 2, nextRoundPrefix: t.nextRound })
    ).toEqual({ label: t.waitingOpp, disabled: true });
  });

  it('next round waits with countdown slot when ready is latched', () => {
    expect(
      nextRoundButton(t, { awaitingOpponent: false, round: 2, nextRoundPrefix: t.nextRound })
        .disabled
    ).toBe(false);
    expect(
      nextRoundButton(ar, { awaitingOpponent: true, round: 2, nextRoundPrefix: ar.nextRound }).label
    ).toBe('بانتظار الخصم…');
  });
});

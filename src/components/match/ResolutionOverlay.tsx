import { useEffect, useMemo, useState } from 'react';
import type { Player } from '../../game/match';
import type { PlayerView } from '../../game/controller';
import type { ZoneExplanation } from '../../game/scoring';
import { ZONES } from '../../game/zones';
import { fmt, useI18n } from '../../i18n';
import { CrownIcon } from '../icons';
import { buildZoneViewsFromView, type StripCard } from './boardUtils';
import { ZoneColumn } from './ZoneColumn';
import { getSideHighlight, isCreamCancelled } from './comboHighlight';

type Phase = 'count' | 'reason' | 'apply' | 'verdict';

/** sequence: full Cool → Party → Energy run. review: finals + replay dock.
 *  replay: single-zone re-run of the same animation, then back to review. */
type View = { kind: 'sequence' } | { kind: 'review' } | { kind: 'replay'; zone: number };

const DUR: Record<Phase, number> = { count: 800, reason: 1100, apply: 1200, verdict: 950 };
const NEXT: Record<Phase, Phase | null> = {
  count: 'reason',
  reason: 'apply',
  apply: 'verdict',
  verdict: null,
};

function keyOf(player: Player, owner: Player, round: number, handIndex: number): string {
  return `${owner === player ? 'm' : 'f'}-${round}-${handIndex}`;
}

/**
 * Round-3 resolution + match review on ONE board (UI renders pure
 * explainZone data; no scoring logic here). Sequence plays Cool → Party →
 * Energy, then stays in review mode: finals + winner banner + Rematch/Back
 * dock. Tapping a zone replays its resolution animation, then returns to
 * review. Tap speeds up, Skip jumps to review. Reduced motion jumps to end
 * states with a short fade.
 */
export function ResolutionOverlay({
  view: matchView,
  player,
  names,
  explanations,
  winner,
  onRematch,
  onReturnMenu,
}: {
  view: PlayerView;
  player: Player;
  names: Record<Player, string>;
  explanations: readonly ZoneExplanation[];
  winner: Player | null;
  onRematch?: () => void;
  onReturnMenu?: () => void;
}) {
  const { t } = useI18n();
  const foe: Player = player === 'A' ? 'B' : 'A';
  const reduced = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  const views = useMemo(
    () => buildZoneViewsFromView(matchView, { foeVisible: true, recallable: false }),
    [matchView]
  );

  const [view, setView] = useState<View>({ kind: reduced ? 'review' : 'sequence' });
  const [zoneIdx, setZoneIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('count');
  const [counted, setCounted] = useState({ mine: 0, foe: 0 });

  const inReview = view.kind === 'review';
  // Replay runs the same machine scoped to one zone (others show finals).
  const focusIdx = view.kind === 'replay' ? view.zone : view.kind === 'sequence' ? zoneIdx : -1;
  const active =
    view.kind === 'review' ? undefined : explanations[focusIdx >= 0 ? focusIdx : zoneIdx];
  const zoneRules: Record<string, string> = {
    cool: t.zoneCoolRule,
    party: t.zonePartyRule,
    energy: t.zoneEnergyRule,
  };

  // Raw bases for the count-up.
  const baseOf = (id: string) => ({
    mine: views.get(id)?.myBase ?? 0,
    foe: views.get(id)?.foeBase ?? 0,
  });

  // Count-up ticker for the animated zone.
  useEffect(() => {
    if (reduced || inReview || phase !== 'count' || !active) return;
    const target = baseOf(active.zoneId);
    setCounted({ mine: 0, foe: 0 });
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / DUR.count);
      setCounted({ mine: Math.round(target.mine * k), foe: Math.round(target.foe * k) });
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, zoneIdx, phase, reduced]);

  // Phase auto-advance.
  useEffect(() => {
    if (inReview) return;
    if (reduced) {
      if (view.kind !== 'replay') return;
      const id = window.setTimeout(() => setView({ kind: 'review' }), 700);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => advance(), DUR[phase]);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, zoneIdx, phase, reduced]);

  function advance() {
    const next = NEXT[phase];
    if (next) {
      setPhase(next);
      return;
    }
    if (view.kind === 'sequence' && zoneIdx + 1 < explanations.length) {
      setZoneIdx((i) => i + 1);
      setPhase('count');
      return;
    }
    // Sequence finished or single-zone replay finished → review mode.
    setView({ kind: 'review' });
  }

  function startReplay(i: number) {
    setZoneIdx(i);
    // Replay the selected zone with the same count → reason → apply → verdict
    // sequence used by its tile in the opening resolution run.
    setCounted({ mine: 0, foe: 0 });
    setPhase('count');
    setView({ kind: 'replay', zone: i });
  }

  function bannerFor(ex: ZoneExplanation): string | null {
    if (phase === 'count') return null;
    if (ex.noBonus) {
      if (ex.noBonus === 'none-empty') return t.resEmpty;
      if (ex.noBonus === 'none-tied-lowest') return t.resCoolNone;
      return ex.zoneId === 'party' ? t.resPartyNone : t.resEnergyNone;
    }
    const first = ex.adjustments[0];
    const owner = first?.owner;
    if (!owner) return null;
    const other: Player = owner === 'A' ? 'B' : 'A';
    const counts = first?.counts ?? { A: 0, B: 0 };
    if (first?.reason === 'stay-frosty') {
      return fmt(t.resCool, { name: names[owner], power: first.from });
    }
    if (first?.reason === 'more-merrier') {
      return fmt(t.resParty, { name: names[owner], a: counts[owner], b: counts[other] });
    }
    return fmt(t.resEnergy, { name: names[owner], a: counts[owner], b: counts[other] });
  }

  function verdictFor(ex: ZoneExplanation): string | null {
    if (ex.winner === null) return t.resTiedZone;
    return fmt(t.resTakesZone, { name: names[ex.winner], zone: ex.zoneId.toUpperCase() });
  }

  // Displayed scores per zone: past → finals, animated → ticking, future → base.
  // Reduced motion jumps straight to finals (no count-up).
  const scoreOf = (ex: ZoneExplanation | undefined): { mine: number; foe: number } => {
    if (!ex) return { mine: 0, foe: 0 };
    if (inReview || reduced) return { mine: ex.totals[player], foe: ex.totals[foe] };
    const idx = explanations.indexOf(ex);
    if (idx < focusIdx) return { mine: ex.totals[player], foe: ex.totals[foe] };
    if (idx > focusIdx) return { mine: ex.base[player], foe: ex.base[foe] };
    if (phase === 'count') return counted;
    if (phase === 'reason') return { mine: ex.base[player], foe: ex.base[foe] };
    return { mine: ex.totals[player], foe: ex.totals[foe] };
  };

  // Card power ticks + pulse/chip keys for the animated zone in apply/verdict.
  const tick = new Map<string, number>();
  const pulse = new Set<string>();
  const chips = new Set<string>();
  const zoneChipsFor = (ex: ZoneExplanation) => {
    const effects = ex.adjustments.flatMap((a, i) => {
      if ((a.target.kind !== 'zone' && a.reason !== 'stay-frosty') || !a.owner) return [];
      const delta = a.to - a.from;
      return [
        {
          key: `${a.owner}-${a.reason}-${i}`,
          side: a.owner === player ? ('mine' as const) : ('foe' as const),
          label: `${delta > 0 ? '+' : ''}${delta}`,
        },
      ];
    });
    const zoneView = views.get(ex.zoneId);
    if (zoneView) {
      const mine = getSideHighlight(
        zoneView.myCards.map((c) => c.flavorId as import('../../game/types').FlavorId)
      );
      const theirs = getSideHighlight(
        zoneView.foeCards.map((c) => c.flavorId as import('../../game/types').FlavorId)
      );
      if (
        !isCreamCancelled(
          zoneView.myCards.map((c) => c.flavorId as import('../../game/types').FlavorId),
          zoneView.foeCards.map((c) => c.flavorId as import('../../game/types').FlavorId)
        )
      ) {
        if (mine.completed.some((c) => c.group === 'berry'))
          effects.push({ key: 'mine-berry', side: 'mine' as const, label: 'WIN' });
        if (theirs.completed.some((c) => c.group === 'berry'))
          effects.push({ key: 'foe-berry', side: 'foe' as const, label: 'WIN' });
      }
    }
    return effects;
  };
  if (active && (phase === 'apply' || phase === 'verdict')) {
    for (const a of active.adjustments) {
      if (a.target.kind === 'card') {
        const k = keyOf(player, a.target.ref.owner, a.target.ref.round, a.target.ref.handIndex);
        tick.set(k, a.to);
        pulse.add(k);
        if (a.reason !== 'stay-frosty') chips.add(k);
      }
    }
  }

  const withTick = (cards: StripCard[]): StripCard[] =>
    tick.size === 0
      ? cards
      : cards.map((c) => (tick.has(c.key) ? { ...c, power: tick.get(c.key) } : c));

  const banner = active ? bannerFor(active) : null;

  const onZoneTap = (i: number) => {
    if (inReview) startReplay(i);
    else advance();
  };

  // Review banner: crown + majority winner (same slot as the sequence banner).
  // Names render inside <bdi> (bidi-isolated plain text).
  const reviewBanner = (
    <div className="resolution-banner review-banner" role="status">
      <span className="winner-crown" aria-hidden="true">
        <CrownIcon size={28} />
      </span>
      <span className="resolution-text">
        <bdi>
          {winner ? fmt(t.wonMajority, { name: names[winner] }) : t.matchDrawn}{' '}
          {winner ? t.winsTheMatch : t.allTied}
        </bdi>
      </span>
    </div>
  );

  return (
    <div
      className="resolution-panel"
      onClick={() => {
        if (!inReview) advance();
      }}
      role="status"
      aria-live="polite"
    >
      {inReview ? (
        reviewBanner
      ) : (
        <div className="resolution-banner" onClick={(e) => e.stopPropagation()}>
          <span className="resolution-text">
            <bdi>{banner ?? t.resTapFaster}</bdi>
          </span>
          <button
            type="button"
            className="btn btn-secondary skip-btn"
            onClick={(e) => {
              e.stopPropagation();
              setView({ kind: 'review' });
            }}
          >
            {t.resSkip}
          </button>
        </div>
      )}
      <div className="zones-row">
        {ZONES.map((z, i) => {
          const v = views.get(z.id);
          const ex = explanations.find((e) => e.zoneId === z.id);
          if (!v || !ex) return null;
          const s = scoreOf(ex);
          const citrusKeys = new Set(
            ex.adjustments.flatMap((a) => {
              if (a.reason !== 'citrus-trio-double-lowest' || a.target.kind !== 'card') return [];
              const ref = a.target.ref;
              return [keyOf(player, ref.owner, ref.round, ref.handIndex)];
            })
          );
          const isActive = !inReview && i === focusIdx;
          const done =
            inReview || i < focusIdx || (isActive && (phase === 'apply' || phase === 'verdict'));
          return (
            <ZoneColumn
              key={z.id}
              zoneId={z.id}
              zoneName={z.name}
              zoneRule={zoneRules[z.id] ?? ''}
              foeCards={isActive ? withTick(v.foeCards) : v.foeCards}
              myCards={isActive ? withTick(v.myCards) : v.myCards}
              foeScore={s.foe}
              myScore={s.mine}
              dropReady={false}
              dropTarget={false}
              spotlight={isActive}
              dimmed={!inReview && !isActive}
              victory={done && ex.winner === player}
              verdict={done || (isActive && phase === 'verdict') ? verdictFor(ex) : null}
              pulseKeys={isActive ? pulse : undefined}
              chipKeys={isActive ? chips : undefined}
              citrusKeys={citrusKeys}
              zoneEffectChips={zoneChipsFor(ex)}
              mini={true}
              onZoneClick={() => onZoneTap(i)}
              onRecall={() => {}}
            />
          );
        })}
      </div>
      <div className={`resolution-footer${inReview ? ' review-mode' : ''}`}>
        {inReview ? (
          <div className="review-dock">
            <span className="dock-hint">{t.resReplayHint}</span>
            <div className="review-actions">
              <button type="button" className="btn btn-primary" onClick={onRematch}>
                {t.rematch}
              </button>
              <button type="button" className="btn btn-secondary" onClick={onReturnMenu}>
                {t.returnToMenu}
              </button>
            </div>
          </div>
        ) : (
          <p className="resolution-hint">{t.resTapFaster}</p>
        )}
      </div>
    </div>
  );
}

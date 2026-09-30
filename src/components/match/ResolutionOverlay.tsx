import { useEffect, useMemo, useState } from 'react';
import type { MatchState, Player } from '../../game/match';
import type { ZoneExplanation } from '../../game/scoring';
import { ZONES } from '../../game/zones';
import { fmt, useI18n } from '../../i18n';
import { buildZoneViews, type StripCard } from './boardUtils';
import { ZoneColumn } from './ZoneColumn';

type Phase = 'count' | 'reason' | 'apply' | 'verdict';

const DUR: Record<Phase, number> = { count: 600, reason: 1000, apply: 1000, verdict: 700 };
const NEXT: Record<Phase, Phase | null> = { count: 'reason', reason: 'apply', apply: 'verdict', verdict: null };

function keyOf(player: Player, owner: Player, round: number, handIndex: number): string {
  return `${owner === player ? 'm' : 'f'}-${round}-${handIndex}`;
}

/**
 * Timed effect-resolution sequence, Cool → Party → Energy (UI renders pure
 * explainZone data; no scoring logic here). Tap speeds up, Skip jumps to
 * the match-result screen. Total ≈ 8.7s. Reduced motion jumps to end
 * states with a short fade.
 */
export function ResolutionOverlay({
  match,
  player,
  names,
  explanations,
  onDone,
}: {
  match: MatchState;
  player: Player;
  names: Record<Player, string>;
  explanations: readonly ZoneExplanation[];
  onDone: () => void;
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
    () => buildZoneViews(match, player, foe, { foeVisible: true, recallable: false }),
    [match, player, foe]
  );

  const [zoneIdx, setZoneIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('count');
  const [counted, setCounted] = useState({ mine: 0, foe: 0 });

  const active = explanations[zoneIdx];
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

  // Count-up ticker for the active zone.
  useEffect(() => {
    if (reduced || phase !== 'count' || !active) return;
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
  }, [zoneIdx, phase, reduced]);

  // Phase auto-advance.
  useEffect(() => {
    if (reduced) return;
    const id = window.setTimeout(() => advance(), DUR[phase]);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneIdx, phase, reduced]);

  function advance() {
    const next = NEXT[phase];
    if (next) {
      setPhase(next);
      return;
    }
    if (zoneIdx + 1 < explanations.length) {
      setZoneIdx((i) => i + 1);
      setPhase('count');
    } else {
      onDone();
    }
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

  if (reduced) {
    return (
      <div className="resolution-panel" role="status">
        <div className="resolution-banner">
          <span className="resolution-text">{t.resTapFaster}</span>
          <button type="button" className="btn btn-secondary skip-btn" onClick={onDone}>
            {t.resSkip}
          </button>
        </div>
        <div className="zones-row">
          {explanations.map((ex) => {
            const v = views.get(ex.zoneId);
            if (!v) return null;
            return (
              <ZoneColumn
                key={ex.zoneId}
                zoneId={ex.zoneId}
                zoneName={ex.zoneId.toUpperCase()}
                zoneRule={zoneRules[ex.zoneId] ?? ''}
                foeCards={v.foeCards}
                myCards={v.myCards}
                foeScore={ex.totals[foe]}
                myScore={ex.totals[player]}
                dropReady={false}
                dropTarget={false}
                spotlight={false}
                dimmed={false}
                victory={ex.winner === player}
                verdict={verdictFor(ex)}
                mini={true}
                tapPrompt={null}
                onZoneClick={() => {}}
                onRecall={() => {}}
              />
            );
          })}
        </div>
      </div>
    );
  }

  function verdictFor(ex: ZoneExplanation): string | null {
    if (ex.winner === null) return t.resTiedZone;
    return fmt(t.resTakesZone, { name: names[ex.winner], zone: ex.zoneId.toUpperCase() });
  }

  // Displayed scores per zone: past → finals, active → animated, future → base.
  const scoreOf = (ex: ZoneExplanation | undefined): { mine: number; foe: number } => {
    if (!ex) return { mine: 0, foe: 0 };
    const idx = explanations.indexOf(ex);
    if (idx < zoneIdx) return { mine: ex.totals[player], foe: ex.totals[foe] };
    if (idx > zoneIdx) return { mine: ex.base[player], foe: ex.base[foe] };
    if (phase === 'count') return counted;
    if (phase === 'reason') return { mine: ex.base[player], foe: ex.base[foe] };
    return { mine: ex.totals[player], foe: ex.totals[foe] };
  };

  // Card power ticks + pulse/chip keys for the active zone in apply/verdict.
  const tick = new Map<string, number>();
  const pulse = new Set<string>();
  const chips = new Set<string>();
  let zoneChip: 'mine' | 'foe' | null = null;
  if (active && (phase === 'apply' || phase === 'verdict')) {
    for (const a of active.adjustments) {
      if (a.target.kind === 'card') {
        const k = keyOf(player, a.target.ref.owner, a.target.ref.round, a.target.ref.handIndex);
        tick.set(k, a.to);
        pulse.add(k);
        chips.add(k);
      } else if (a.owner) {
        zoneChip = a.owner === player ? 'mine' : 'foe';
      }
    }
  }

  const withTick = (cards: StripCard[]): StripCard[] =>
    tick.size === 0 ? cards : cards.map((c) => (tick.has(c.key) ? { ...c, power: tick.get(c.key) } : c));

  const banner = active ? bannerFor(active) : null;

  return (
    <div className="resolution-panel" onClick={advance} role="status" aria-live="polite">
      <div className="resolution-banner" onClick={(e) => e.stopPropagation()}>
        <span className="resolution-text">{banner ?? t.resTapFaster}</span>
        <button
          type="button"
          className="btn btn-secondary skip-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDone();
          }}
        >
          {t.resSkip}
        </button>
      </div>
      <div className="zones-row">
        {ZONES.map((z, i) => {
          const v = views.get(z.id);
          const ex = explanations.find((e) => e.zoneId === z.id);
          if (!v || !ex) return null;
          const s = scoreOf(ex);
          const isActive = i === zoneIdx;
          const done = i < zoneIdx || (isActive && (phase === 'apply' || phase === 'verdict'));
          return (
            <ZoneColumn
              key={z.id}
              zoneId={z.id}
              zoneName={z.name}
              zoneRule={zoneRules[z.id] ?? ''}
              foeCards={withTick(v.foeCards)}
              myCards={withTick(v.myCards)}
              foeScore={s.foe}
              myScore={s.mine}
              dropReady={false}
              dropTarget={false}
              spotlight={isActive}
              dimmed={!isActive}
              victory={done && ex.winner === player}
              verdict={done || (isActive && phase === 'verdict') ? verdictFor(ex) : null}
              pulseKeys={isActive ? pulse : undefined}
              chipKeys={isActive ? chips : undefined}
              zoneChip={isActive ? zoneChip : undefined}
              mini={true}
              tapPrompt={null}
              onZoneClick={() => advance()}
              onRecall={() => {}}
            />
          );
        })}
      </div>
      <p className="resolution-hint">{t.resTapFaster}</p>
    </div>
  );
}

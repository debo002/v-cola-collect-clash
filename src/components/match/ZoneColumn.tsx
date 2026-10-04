import { useEffect, useRef, useState } from 'react';
import { getFlavorById } from '../../game/cards';
import { getCardGroups } from '../../game/effects';
import type { FlavorId } from '../../game/types';
import { fmt, useI18n } from '../../i18n';
import { COMBO_COLORS } from '../comboTheme';
import { GameCard } from '../GameCard';
import { CardHoldPreview } from '../CardHoldPreview';
import { CoolIcon, EnergyIcon, PartyIcon } from '../icons';
import type { StripCard } from './boardUtils';
import { getSideHighlight, isCreamCancelled } from './comboHighlight';
import type { CSSProperties } from 'react';

export function ZoneIcon({ zoneId, size = 20 }: { zoneId: string; size?: number }) {
  if (zoneId === 'cool') return <CoolIcon size={size} />;
  if (zoneId === 'party') return <PartyIcon size={size} />;
  return <EnergyIcon size={size} />;
}

const STRIP_GAP = 6;

/**
 * Measures a strip and fits N cards side by side with no overlap or clip.
 * The ResizeObserver reports the strip content box (padding is already
 * excluded), so use all of it and only shrink when the row width is limiting.
 */
function useStripFit(count: number): {
  ref: React.RefObject<HTMLDivElement | null>;
  style: CSSProperties;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  let cardW = 64;
  if (box.w > 0 && count > 0) {
    const byWidth = (box.w - STRIP_GAP * (count - 1)) / count;
    const byHeight = (box.h * 5) / 8;
    cardW = Math.max(1, Math.floor(Math.min(byWidth, byHeight)));
  }
  const nameFs = Math.max(9, Math.min(13, Math.floor(cardW * 0.22)));
  return {
    ref,
    style: { '--card-w': `${cardW}px`, '--name-fs': `${nameFs}px` } as CSSProperties,
  };
}

/**
 * One zone column: foe strip (top) / info pillar (middle: name, rule,
 * both scores, winner pill) / mine strip (bottom). Three non-overlapping
 * areas; strips reserve space even when empty so reveals never shift
 * layout. Cards shrink to fit side by side — never stacked, never clipped.
 *
 * Resolution hooks (all optional, inert during placing):
 * - pulseKeys/chipKeys: StripCard keys getting the bonus pulse / card-status chip
 * - verdict: winner pill rendered inside the pillar (null hides it)
 * - stagger: reveal stagger delay base ms (index × 60ms added per card)
 * - mini: compact pillar text for the resolution panel
 * - zoneEffectChips: one badge per zone-total adjustment
 */
export function ZoneColumn({
  zoneId,
  zoneName,
  zoneRule,
  foeCards,
  myCards,
  foeScore,
  myScore,
  dropReady,
  dropTarget,
  spotlight,
  dimmed,
  victory,
  verdict,
  pulseKeys,
  chipKeys,
  citrusKeys,
  stagger,
  mini,
  zoneEffectChips,
  onZoneClick,
  onRecall,
}: {
  zoneId: string;
  zoneName: string;
  zoneRule: string;
  foeCards: readonly StripCard[];
  myCards: readonly StripCard[];
  foeScore: number;
  myScore: number;
  dropReady: boolean;
  dropTarget: boolean;
  spotlight: boolean;
  dimmed: boolean;
  victory: boolean;
  verdict?: string | null;
  pulseKeys?: ReadonlySet<string>;
  chipKeys?: ReadonlySet<string>;
  citrusKeys?: ReadonlySet<string>;
  stagger?: number | null;
  mini?: boolean;
  zoneEffectChips?: readonly { key: string; side: 'mine' | 'foe'; label: string }[];
  onZoneClick: (zoneId: string) => void;
  onRecall: (handIndex: number) => void;
}) {
  const { t } = useI18n();
  const leading: 'mine' | 'foe' | 'tied' | 'none' =
    myScore === 0 && foeScore === 0
      ? 'none'
      : myScore > foeScore
        ? 'mine'
        : foeScore > myScore
          ? 'foe'
          : 'tied';

  const foeFit = useStripFit(foeCards.length);
  const myFit = useStripFit(myCards.length);

  // Visual-only combo state (same predicates as the resolver, no logic fork).
  const myFlavors = myCards.map((c) => c.flavorId as FlavorId);
  const foeFlavors = foeCards.map((c) => c.flavorId as FlavorId);
  const creamCancelled = isCreamCancelled(myFlavors, foeFlavors);
  const myHi = getSideHighlight(myFlavors);
  const foeHi = getSideHighlight(foeFlavors);

  const comboFor = (c: StripCard, side: 'foe' | 'mine') => {
    const hi = side === 'mine' ? myHi : foeHi;
    const fid = c.flavorId as FlavorId;
    const completion = hi.completed.find((k) => (k.involved as readonly string[]).includes(fid));
    const partial = completion
      ? undefined
      : hi.partials.find((p) => (p.involved as readonly string[]).includes(fid));
    return { completion, partial };
  };

  const renderMini = (c: StripCard, side: 'foe' | 'mine', idx: number) => {
    const flavor = getFlavorById(c.flavorId);
    if (!flavor) return null;
    const displayName = t.flavors[flavor.id] || flavor.name;
    const pulsed = pulseKeys?.has(c.key) ?? false;
    const chipped = chipKeys?.has(c.key) ?? false;
    const staggerMs = stagger != null ? stagger + idx * 90 : null;
    const delay =
      staggerMs != null
        ? ({ animationDelay: `${staggerMs}ms`, '--pop-delay': `${staggerMs}ms` } as CSSProperties)
        : undefined;
    const groups = getCardGroups(flavor.id as FlavorId);
    const { completion, partial } = comboFor(c, side);
    const citrus = (side === 'mine' ? myHi : foeHi).completed.find(
      (item) => item.group === 'citrus'
    );
    const sideCards = side === 'mine' ? myCards : foeCards;
    const lowestCard = sideCards.reduce<StripCard | null>(
      (best, card) =>
        card.power != null && (best === null || best.power == null || card.power < best.power)
          ? card
          : best,
      null
    );
    const citrusTarget = citrusKeys ? citrusKeys.has(c.key) : lowestCard?.key === c.key;
    const cardEffect = Boolean(
      citrus && citrus.involved.includes(c.flavorId as FlavorId) && citrusTarget
    );
    const visualCompletion = cardEffect ? citrus : completion;
    const inner = (
      <CardHoldPreview flavorId={flavor.id as FlavorId}>
        <GameCard
          flavor={flavor}
          power={c.power ?? undefined}
          displayName={displayName}
          size="board"
          groups={groups}
          greyed={creamCancelled}
          highlightColor={visualCompletion ? COMBO_COLORS[visualCompletion.group] : undefined}
          effectChips={[...(cardEffect ? [citrus?.chip ?? 'x2'] : []), ...(chipped ? ['+1'] : [])]}
          progress={partial?.text}
        />
      </CardHoldPreview>
    );
    const cls = `strip-mini${pulsed ? ' bonus-pulse' : ''}${staggerMs != null ? (side === 'foe' ? ' animate-flip reveal-pop' : ' pop-in reveal-pop') : ''}`;
    if (side === 'mine' && c.recallable) {
      return (
        <button
          key={c.key}
          type="button"
          className={`${cls} recallable pop-in`}
          style={delay}
          onClick={(e) => {
            e.stopPropagation();
            onRecall(c.handIndex);
          }}
          onDragStart={(e) => e.preventDefault()}
          title={t.recall}
          aria-label={fmt(t.takeBack, { name: displayName })}
        >
          {inner}
        </button>
      );
    }
    return (
      <div key={c.key} className={cls} style={delay}>
        {inner}
      </div>
    );
  };

  return (
    <div
      data-zone={zoneId}
      className={
        `zone-col zone-${zoneId}` +
        (mini ? ' mini-col' : '') +
        (dropReady ? ' drop-ready' : '') +
        (dropTarget ? ' drop-target' : '') +
        (spotlight ? ' spotlight' : '') +
        (dimmed ? ' dimmed-zone' : '') +
        (victory ? ' lane-victory' : '') +
        (creamCancelled ? ' combo-cancelled' : '')
      }
      onClick={() => onZoneClick(zoneId)}
      role="button"
      tabIndex={0}
      aria-label={`${zoneName}: you ${myScore}, foe ${foeScore}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onZoneClick(zoneId);
        }
      }}
    >
      <div ref={foeFit.ref} className="strip foe-strip" style={foeFit.style}>
        {foeCards.map((c, i) => renderMini(c, 'foe', i))}
      </div>

      <div className={`zone-pillar lead-${leading}`}>
        <div className="pillar-score-line player-score-line" aria-label={t.helpChips}>
          <span className="pillar-score player-score" key={`m-${myScore}`}>
            {myScore}
          </span>
          {zoneEffectChips
            ?.filter((chip) => chip.side === 'mine')
            .map((chip) => (
              <span className="zone-effect-chip mine" key={chip.key}>
                {chip.label}
              </span>
            ))}
        </div>
        <div className="pillar-body">
          <span className="pillar-icon">
            <ZoneIcon zoneId={zoneId} size={20} />
          </span>
          <strong className="pillar-name">{zoneName}</strong>
          <span className="pillar-rule">{zoneRule}</span>
          {verdict ? (
            <span className="pillar-verdict" role="status">
              <bdi>{verdict}</bdi>
            </span>
          ) : null}
        </div>
        <div className="pillar-score-line foe-score-line" aria-label={t.helpChips}>
          <span className="pillar-score foe-score" key={`f-${foeScore}`}>
            {foeScore}
          </span>
          {zoneEffectChips
            ?.filter((chip) => chip.side === 'foe')
            .map((chip) => (
              <span className="zone-effect-chip foe" key={chip.key}>
                {chip.label}
              </span>
            ))}
        </div>
      </div>

      <div ref={myFit.ref} className="strip my-strip" style={myFit.style}>
        {myCards.map((c, i) => renderMini(c, 'mine', i))}
      </div>
    </div>
  );
}

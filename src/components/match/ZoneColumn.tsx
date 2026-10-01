import { getFlavorById } from '../../game/cards';
import { fmt, useI18n } from '../../i18n';
import { GameCard } from '../GameCard';
import { CoolIcon, EnergyIcon, PartyIcon } from '../icons';
import type { StripCard } from './boardUtils';
import type { CSSProperties } from 'react';

export function ZoneIcon({ zoneId, size = 20 }: { zoneId: string; size?: number }) {
  if (zoneId === 'cool') return <CoolIcon size={size} />;
  if (zoneId === 'party') return <PartyIcon size={size} />;
  return <EnergyIcon size={size} />;
}

/**
 * One zone column: foe strip (top) / header + scores (middle) /
 * mine strip (bottom). Strips are horizontal overlap rows so 6 cards
 * per side fit with no scrolling. Density shrinks cards when crowded.
 *
 * Resolution hooks (all optional, inert during placing):
 * - pulseKeys/chipKeys: StripCard keys getting the bonus pulse / +1 chip
 * - verdict: winner badge pinned to the column corner (null hides it)
 * - stagger: reveal stagger delay base ms (index × 60ms added per card)
 * - mini: compact density for the resolution panel
 * - zoneChip: floating +1 on a pillar score (zone-level Party bonus)
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
  stagger,
  mini,
  zoneChip,
  tapPrompt,
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
  stagger?: number | null;
  mini?: boolean;
  zoneChip?: 'mine' | 'foe' | null;
  tapPrompt: string | null;
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
  const density = (n: number) => (n <= 2 ? 'roomy' : n <= 4 ? 'snug' : 'crowded');

  const renderMini = (c: StripCard, side: 'foe' | 'mine', idx: number) => {
    const flavor = getFlavorById(c.flavorId);
    if (!flavor) return null;
    const displayName = t.flavors[flavor.id] || flavor.name;
    const pulsed = pulseKeys?.has(c.key) ?? false;
    const chipped = chipKeys?.has(c.key) ?? false;
    const staggerMs = stagger != null ? stagger + idx * 60 : null;
    const delay =
      staggerMs != null
        ? ({ animationDelay: `${staggerMs}ms`, '--pop-delay': `${staggerMs}ms` } as CSSProperties)
        : undefined;
    const inner = (
      <GameCard
        flavor={flavor}
        power={c.power ?? undefined}
        displayName={displayName}
        size="board"
      />
    );
    const cls = `strip-mini${pulsed ? ' bonus-pulse' : ''}${staggerMs != null ? (side === 'foe' ? ' animate-flip reveal-pop' : ' pop-in reveal-pop') : ''}`;
    const chip = chipped ? (
      <span className="plus-chip" aria-hidden="true">
        +1
      </span>
    ) : null;
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
          title={t.recall}
          aria-label={fmt(t.takeBack, { name: displayName })}
        >
          {inner}
          {chip}
          <span className="recall-x" aria-hidden="true">
            ×
          </span>
        </button>
      );
    }
    return (
      <div key={c.key} className={cls} style={delay}>
        {inner}
        {chip}
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
        (victory ? ' lane-victory' : '')
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
      <div className={`strip foe-strip density-${density(foeCards.length)}`}>
        {foeCards.map((c, i) => renderMini(c, 'foe', i))}
      </div>

      <div className={`zone-pillar lead-${leading}`}>
        <span className="pillar-score foe-score">
          {foeScore}
          {zoneChip === 'foe' ? (
            <span className="plus-chip" aria-hidden="true">
              +1
            </span>
          ) : null}
        </span>
        <div className="pillar-body">
          <span className="pillar-icon">
            <ZoneIcon zoneId={zoneId} size={20} />
          </span>
          <strong className="pillar-name">{zoneName}</strong>
          <span className="pillar-rule">{zoneRule}</span>
        </div>
        <span className="pillar-score player-score">
          {myScore}
          {zoneChip === 'mine' ? (
            <span className="plus-chip" aria-hidden="true">
              +1
            </span>
          ) : null}
        </span>
      </div>
      {verdict ? (
        <div className="verdict-badge" role="status">
          {verdict}
        </div>
      ) : null}

      <div className={`strip my-strip density-${density(myCards.length)}`}>
        {myCards.map((c, i) => renderMini(c, 'mine', i))}
      </div>

      {tapPrompt ? <div className="lane-drop-prompt">+ {tapPrompt}</div> : null}
    </div>
  );
}

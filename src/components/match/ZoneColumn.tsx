import { getFlavorById } from '../../game/cards';
import { fmt, useI18n } from '../../i18n';
import { GameCard } from '../GameCard';
import { CoolIcon, EnergyIcon, PartyIcon } from '../icons';

export function ZoneIcon({ zoneId, size = 20 }: { zoneId: string; size?: number }) {
  if (zoneId === 'cool') return <CoolIcon size={size} />;
  if (zoneId === 'party') return <PartyIcon size={size} />;
  return <EnergyIcon size={size} />;
}

export interface StripCard {
  key: string;
  handIndex: number;
  flavorId: string;
  /** Null = hidden (never rendered with a value). */
  power: number | null;
  recallable: boolean;
}

/**
 * One zone column: foe strip (top) / header + live scores (middle) /
 * mine strip (bottom). Strips are horizontal overlap rows so 6 cards
 * per side fit with no scrolling. Density shrinks cards when crowded.
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

  return (
    <div
      data-zone={zoneId}
      className={
        `zone-col zone-${zoneId}` +
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
        {foeCards.map((c) => (
          <StripMini key={c.key} card={c} />
        ))}
      </div>

      <div className={`zone-pillar lead-${leading}`}>
        <span className="pillar-score foe-score">{foeScore}</span>
        <div className="pillar-body">
          <span className="pillar-icon">
            <ZoneIcon zoneId={zoneId} size={20} />
          </span>
          <strong className="pillar-name">{zoneName}</strong>
          <span className="pillar-rule">{zoneRule}</span>
        </div>
        <span className="pillar-score player-score">{myScore}</span>
      </div>

      <div className={`strip my-strip density-${density(myCards.length)}`}>
        {myCards.map((c) => (
          <StripMini key={c.key} card={c} onRecall={c.recallable ? onRecall : undefined} />
        ))}
      </div>

      {tapPrompt ? <div className="lane-drop-prompt">+ {tapPrompt}</div> : null}
    </div>
  );

  function StripMini({
    card,
    onRecall,
  }: {
    card: StripCard;
    onRecall?: (handIndex: number) => void;
  }) {
    const flavor = getFlavorById(card.flavorId);
    if (!flavor) return null;
    const displayName = t.flavors[flavor.id] || flavor.name;
    const inner = (
      <GameCard
        flavor={flavor}
        power={card.power ?? undefined}
        displayName={displayName}
        size="board"
      />
    );
    if (onRecall) {
      return (
        <button
          type="button"
          className="strip-mini recallable pop-in"
          onClick={(e) => {
            e.stopPropagation();
            onRecall(card.handIndex);
          }}
          title={t.recall}
          aria-label={fmt(t.takeBack, { name: displayName })}
        >
          {inner}
          <span className="recall-x" aria-hidden="true">
            ×
          </span>
        </button>
      );
    }
    return <div className="strip-mini">{inner}</div>;
  }
}

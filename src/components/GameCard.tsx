import type { CSSProperties } from 'react';
import type { ComboGroup } from '../game/effects';
import type { Flavor } from '../game/types';
import { flavorImageUrl } from './assetPaths';
import { comboArtBackground, comboBackground, comboGlow } from './comboTheme';

/**
 * Snap-like battle card: can art, power gem top-right,
 * name plate at the bottom. All labels are HTML —
 * nothing is baked into images.
 *
 * Combo identification (visual only, derived from getCardGroups):
 * border + dark art wash + glow carry the group color, or a gradient
 * mixing the colors when the card belongs to 2+ groups (or solo + group).
 * Cream Soda (solo only) gets the distinct solo color. Optional highlight
 * outline + effect/progress chips are driven by zone combo state; greyed
 * dims group colors in Cream zones.
 */
export function GameCard({
  flavor,
  power,
  displayName,
  selected,
  dimmed,
  size,
  groups,
  greyed,
  highlightColor,
  effectChip,
  effectWarning,
  progress,
}: {
  flavor: Flavor;
  power?: number;
  displayName?: string;
  selected?: boolean;
  dimmed?: boolean;
  size?: 'hand' | 'board';
  groups?: readonly ComboGroup[];
  greyed?: boolean;
  highlightColor?: string;
  effectChip?: string;
  effectWarning?: boolean;
  progress?: string;
}) {
  const classes = ['game-card', `flavor-${flavor.id}`, `line-${flavor.line}`];
  if (selected) classes.push('selected');
  if (dimmed) classes.push('dimmed');
  if (size) classes.push(`card-${size}`);
  if (groups && groups.length > 0) classes.push('has-combo');
  if (greyed) classes.push('combo-greyed');
  if (highlightColor && !greyed) classes.push('combo-hit');

  const label = displayName || flavor.name;

  const frame = groups && groups.length > 0 ? comboBackground(groups) : undefined;
  const art = groups && groups.length > 0 ? comboArtBackground(groups) : undefined;
  const glow = groups && groups.length > 0 ? comboGlow(groups) : undefined;

  const style = {
    ...(highlightColor && !greyed
      ? { outline: `2px solid ${highlightColor}`, outlineOffset: '1px' }
      : undefined),
    ...(frame && !greyed ? ({ '--combo-frame': frame } as CSSProperties) : undefined),
    ...(art && !greyed ? ({ '--combo-art': art } as CSSProperties) : undefined),
    ...(glow && !greyed ? ({ '--combo-glow': glow } as CSSProperties) : undefined),
  } as CSSProperties;

  return (
    <article className={classes.join(' ')} aria-label={label} style={style}>
      {power !== undefined ? (
        <span className="power-gem" title="Power — rolled fresh every match">
          <span className="power-val">{power}</span>
        </span>
      ) : null}
      <div className="game-art">
        <img
          src={flavorImageUrl(flavor)}
          alt={label}
          loading="lazy"
          draggable={false}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
      <div className="name-plate">
        <span>{label}</span>
      </div>
      {size === 'board' ? <div className="board-status-row">
      {greyed ? <span className="cancelled-mark" aria-hidden="true">×</span> : null}
      {effectChip && !greyed ? (
        <span className={`combo-effect${effectWarning ? ' combo-warn' : ''}`}>{effectChip}</span>
      ) : null}
      {progress && !greyed ? <span className="combo-progress">{progress}</span> : null}
      </div> : null}
      {size !== 'board' && effectChip && !greyed ? (
        <span className={`combo-effect${effectWarning ? ' combo-warn' : ''}`}>{effectChip}</span>
      ) : null}
      {size !== 'board' && progress && !greyed ? <span className="combo-progress">{progress}</span> : null}
    </article>
  );
}

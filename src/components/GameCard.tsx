import type { Flavor } from '../game/types';
import { flavorImageUrl } from './assetPaths';

/**
 * Snap-like battle card: can art, power gem top-right,
 * name plate at the bottom, product-line frame. All labels are HTML —
 * nothing is baked into images.
 */
export function GameCard({
  flavor,
  power,
  displayName,
  selected,
  dimmed,
  placed,
}: {
  flavor: Flavor;
  power?: number;
  displayName?: string;
  selected?: boolean;
  dimmed?: boolean;
  placed?: boolean;
}) {
  const classes = ['game-card', `flavor-${flavor.id}`, `line-${flavor.line}`];
  if (selected) classes.push('selected');
  if (dimmed) classes.push('dimmed');
  if (placed) classes.push('is-placed');

  const label = displayName || flavor.name;

  return (
    <article className={classes.join(' ')} aria-label={label}>
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
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      </div>
      <div className="name-plate">
        <span>{label}</span>
      </div>
      {placed ? (
        <div className="placed-overlay">
          <span>PLACED</span>
        </div>
      ) : null}
    </article>
  );
}

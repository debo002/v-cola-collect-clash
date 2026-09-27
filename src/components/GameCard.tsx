import type { Flavor } from '../game/types';
import { flavorImageUrl } from './assetPaths';

/**
 * Snap-like battle card, simplified: can art, power gem top-right,
 * name plate at the bottom, product-line frame. All labels are HTML —
 * nothing is baked into images.
 */
export function GameCard({
  flavor,
  power,
  selected,
  dimmed,
  loaner,
}: {
  flavor: Flavor;
  power?: number;
  selected?: boolean;
  dimmed?: boolean;
  loaner?: boolean;
}) {
  const classes = ['game-card', `line-${flavor.line}`];
  if (selected) classes.push('selected');
  if (dimmed) classes.push('dimmed');
  return (
    <article className={classes.join(' ')} aria-label={flavor.name}>
      <span className="power-gem" title="Power — rolled fresh every match">
        {power ?? '?'}
      </span>
      {loaner ? <span className="loaner-ribbon">loaner</span> : null}
      <div className="game-art">
        <img src={flavorImageUrl(flavor)} alt={`${flavor.name} can`} loading="lazy" />
      </div>
      <div className="name-plate">
        <span>{flavor.name}</span>
      </div>
    </article>
  );
}

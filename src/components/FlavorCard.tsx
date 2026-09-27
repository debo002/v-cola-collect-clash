import type { Flavor } from '../game/types';
import { flavorImageUrl } from './assetPaths';

export function FlavorCard({
  flavor,
  power,
  selected,
  dimmed,
}: {
  flavor: Flavor;
  power?: number;
  selected?: boolean;
  dimmed?: boolean;
}) {
  const classes = ['card', `line-${flavor.line}`];
  if (selected) classes.push('selected');
  if (dimmed) classes.push('dimmed');
  return (
    <article className={classes.join(' ')} aria-label={flavor.name}>
      <div className="card-art">
        <img src={flavorImageUrl(flavor)} alt={`${flavor.name} can`} loading="lazy" />
      </div>
      <div className="card-foot">
        <span className="card-name">{flavor.name}</span>
        <span className="card-power" title="Power is rolled fresh 1–5 every match">
          {power ?? '?'}
        </span>
      </div>
    </article>
  );
}

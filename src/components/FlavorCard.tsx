import type { Flavor } from '../game/types';
import { flavorImageUrl } from './assetPaths';

export function FlavorCard({ flavor, power }: { flavor: Flavor; power?: number }) {
  return (
    <article className={`card line-${flavor.line}`} aria-label={flavor.name}>
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

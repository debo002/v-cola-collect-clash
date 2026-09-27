import type { Flavor } from '../game/types';

const BASE = import.meta.env.BASE_URL;

/** File under public/ — e.g. assetUrl('assets/cards/v7-logo.png'). */
export function assetUrl(path: string): string {
  return `${BASE}${path}`;
}

/** Demo image path by convention: public/assets/cards/<flavor-id>.webp */
export function flavorImageUrl(flavor: Pick<Flavor, 'id'>): string {
  return assetUrl(`assets/cards/${flavor.id}.webp`);
}

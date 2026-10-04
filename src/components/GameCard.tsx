import type { CSSProperties } from 'react';
import { useLayoutEffect, useRef } from 'react';
import type { ComboGroup } from '../game/effects';
import type { Flavor } from '../game/types';
import { flavorImageUrl } from './assetPaths';
import { comboArtBackground, comboBackground, comboGlow } from './comboTheme';

/** Floor for name shrink-to-fit (~8px per item 5; never below). */
const NAME_FLOOR_PX = 8;

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
  effectChips,
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
  effectChips?: readonly string[];
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

  // Shrink-to-fit for flavor names (item 5): CSS wraps to 2 lines, but a
  // long name at a narrow width can still need 3 lines — step the font down
  // to the 8px floor until it fits, so the line-clamp ellipsis never fires.
  const nameRef = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const el = nameRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const fit = () => {
      el.style.fontSize = '';
      const base = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(base)) return;
      let fs = base;
      while (
        fs - 0.5 >= NAME_FLOOR_PX &&
        (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      ) {
        fs -= 0.5;
        el.style.fontSize = `${fs}px`;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    let cancelled = false;
    fonts?.ready.then(() => {
      if (!cancelled) fit();
    });
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [label]);
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
        <span ref={nameRef}>{label}</span>
      </div>
      {size === 'board' ? (
        <div className="board-status-row">
          {greyed ? (
            <span className="cancelled-mark" aria-hidden="true">
              ×
            </span>
          ) : null}
          {effectChips?.map((effect, i) =>
            !greyed ? (
              <span className="combo-effect" key={`${effect}-${i}`}>
                {effect}
              </span>
            ) : null
          )}
          {progress && !greyed ? <span className="combo-progress">{progress}</span> : null}
        </div>
      ) : null}
      {size !== 'board' && progress && !greyed ? (
        <span className="combo-progress">{progress}</span>
      ) : null}
    </article>
  );
}

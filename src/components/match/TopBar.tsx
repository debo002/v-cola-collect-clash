import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FLAVORS, getFlavorById } from '../../game/cards';
import { COMBO_GROUP_MEMBERS, getCardGroups, type ComboGroup } from '../../game/effects';
import { TIMER_SECONDS } from '../../game/match';
import type { FlavorId } from '../../game/types';
import { comboDescription, fmt, useI18n } from '../../i18n';
import { comboBackground, COMBO_COLORS } from '../comboTheme';
import { ExitIcon } from '../icons';

const LEGEND_ORDER: readonly ComboGroup[] = ['cola', 'citrus', 'ingredient', 'berry', 'solo'];

/** Round pips: 3 dots, current lit. */
export function RoundPips({ current, total = 3 }: { current: number; total?: number }) {
  return (
    <span className="round-pips" aria-label={`Round ${current} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`pip${i + 1 === current ? ' on' : ''}${i + 1 < current ? ' done' : ''}`}
        />
      ))}
    </span>
  );
}

/** Circular timer ring that drains as seconds run out. Red under 10s. */
export function TimerRing({ seconds, total }: { seconds: number; total: number }) {
  const r = 11;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, seconds / total));
  const urgent = seconds <= 10;
  return (
    <span
      className={`timer-ring${urgent ? ' urgent' : ''}`}
      role="timer"
      aria-label={`${seconds}s`}
    >
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r={r} className="ring-track" />
        <circle
          cx="16"
          cy="16"
          r={r}
          className="ring-fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
        />
      </svg>
      <span className="ring-num">{seconds}</span>
    </span>
  );
}

/** Slim match top bar: menu left, round pips + timer + combo legend (?) right. */
export function TopBar({
  displayRound,
  seconds,
  showTimer,
  onMenu,
}: {
  displayRound: number;
  seconds: number;
  showTimer: boolean;
  onMenu: () => void;
}) {
  const { t } = useI18n();
  const [legendOpen, setLegendOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!legendOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLegendOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.help-sheet')) setLegendOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [legendOpen]);

  const groupName: Record<ComboGroup, string> = {
    cola: t.comboGroupCola,
    citrus: t.comboGroupCitrus,
    ingredient: t.comboGroupIngredient,
    berry: t.comboGroupBerry,
    solo: t.comboGroupSolo,
  };
  const groupDesc: Record<ComboGroup, string> = {
    cola: comboDescription(t, 'cola'),
    citrus: comboDescription(t, 'citrus'),
    ingredient: comboDescription(t, 'ingredient'),
    berry: comboDescription(t, 'berry'),
    solo: comboDescription(t, 'solo'),
  };

  return (
    <div className="game-topbar">
      <button
        type="button"
        className="icon-btn"
        onClick={onMenu}
        aria-label={t.exitMatch}
        title={t.exitMatch}
      >
        <ExitIcon size={20} />
      </button>
      <div className="game-topbar-info">
        <RoundPips current={displayRound} />
        <span className="game-round-indicator">{fmt(t.roundN, { n: displayRound })}</span>
        {showTimer ? <TimerRing seconds={seconds} total={TIMER_SECONDS} /> : null}
        <div className="legend-pop-wrap" ref={popRef}>
          <button
            type="button"
            className="icon-btn legend-btn"
            onClick={() => setLegendOpen((v) => !v)}
            aria-label={t.comboLegendTitle}
            aria-expanded={legendOpen}
            title={t.comboLegendTitle}
          >
            ?
          </button>
          {legendOpen ? createPortal(
            <div className="help-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) setLegendOpen(false); }}>
              <section className="help-sheet" ref={popRef} role="dialog" aria-modal="true" aria-label={t.comboLegendTitle}>
                <header className="help-header">
                  <h2>{t.comboLegendTitle}</h2>
                  <button type="button" className="icon-btn" onClick={() => setLegendOpen(false)} aria-label={t.helpClose}>×</button>
                </header>
                <div className="help-scroll">
                  <section className="help-section"><h3>{t.helpMatchTitle}</h3><p>{t.helpMatchBody}</p></section>
                  <section className="help-section"><h3>{t.helpZonesTitle}</h3>
                    {[['cool', t.zoneCoolRule], ['party', t.zonePartyRule], ['energy', t.zoneEnergyRule]].map(([id, rule]) => <p className="help-zone-line" key={id}><b>{id.toUpperCase()}</b><span>{rule}</span></p>)}
                  </section>
                  <section className="help-section"><h3>{t.helpCombosTitle}</h3><ul className="help-combos">
                    {LEGEND_ORDER.map((g) => <li key={g}><span className="combo-dot" style={{ background: COMBO_COLORS[g] }} aria-hidden="true"/><div><strong>{groupName[g]}</strong><span className="legend-cards">{COMBO_GROUP_MEMBERS[g].map((id) => t.flavors[id] || getFlavorById(id)?.name || id).join(' · ')}</span><p>{groupDesc[g]}</p></div></li>)}
                  </ul></section>
                  <section className="help-section"><h3>{t.helpCardsTitle}</h3><ul className="help-cards">
                    {FLAVORS.map((flavor) => { const groups = getCardGroups(flavor.id as FlavorId); const tags = flavor.tags.map((tag) => tag === 'apple' ? t.tagApple : tag === 'malt' ? t.tagMalt : t.tagPineapple); return <li key={flavor.id}><span className="frame-swatch" style={{ background: comboBackground(groups) || '#293247' }} aria-hidden="true"/><strong>{t.flavors[flavor.id] || flavor.name}</strong><span>{t.cardEffects[flavor.id]}{tags.length ? <small className="help-card-tags">{t.helpTags}: {tags.join(' · ')}</small> : null}</span></li>; })}
                  </ul></section>
                  <section className="help-section"><h3>{t.helpBoardTitle}</h3><ul className="help-reading">{[t.helpPower, t.helpProgress, t.helpChips, t.helpCancelled, t.helpColors].map((s) => <li key={s}>{s}</li>)}</ul></section>
                </div>
              </section>
            </div>, document.body) : null}
        </div>
      </div>
    </div>
  );
}

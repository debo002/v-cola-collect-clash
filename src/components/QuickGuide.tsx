import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { FLAVORS, getFlavorById } from '../game/cards';
import { COMBO_GROUP_MEMBERS, getCardGroups, type ComboGroup } from '../game/effects';
import type { FlavorId } from '../game/types';
import { comboDescription, useI18n } from '../i18n';
import { flavorImageUrl } from './assetPaths';
import { comboBackground, COMBO_COLORS } from './comboTheme';
import { CoolIcon, EnergyIcon, PartyIcon } from './icons';

const GROUPS: readonly ComboGroup[] = ['cola', 'citrus', 'ingredient', 'berry', 'solo'];
type GuideTab = 'match' | 'combos' | 'cards' | 'board';

function ZoneIconMini({ id }: { id: string }) {
  if (id === 'cool') return <CoolIcon size={24} />;
  if (id === 'party') return <PartyIcon size={24} />;
  return <EnergyIcon size={24} />;
}

export function QuickGuide({ menu = false }: { menu?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<GuideTab>('match');
  const [cardId, setCardId] = useState<string>('v-cola');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: PointerEvent) => { if (!(e.target as Element).closest('.help-sheet')) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [open]);

  const groupName: Record<ComboGroup, string> = { cola: t.comboGroupCola, citrus: t.comboGroupCitrus, ingredient: t.comboGroupIngredient, berry: t.comboGroupBerry, solo: t.comboGroupSolo };
  const groupDesc: Record<ComboGroup, string> = { cola: comboDescription(t, 'cola'), citrus: comboDescription(t, 'citrus'), ingredient: comboDescription(t, 'ingredient'), berry: comboDescription(t, 'berry'), solo: comboDescription(t, 'solo') };

  return <>
    <button type="button" className={menu ? 'btn btn-secondary btn-xl menu-guide-btn' : 'icon-btn legend-btn'} onClick={() => setOpen((v) => !v)} aria-label={t.comboLegendTitle} aria-expanded={open} title={t.comboLegendTitle}>{menu ? <>{t.guideMenuLabel}</> : '?'}</button>
    {open ? createPortal(<div className="help-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section className="help-sheet" role="dialog" aria-modal="true" aria-label={t.comboLegendTitle}>
        <header className="help-header"><h2>{t.comboLegendTitle}</h2><button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label={t.helpClose}>×</button></header>
        <nav className="guide-tabs" aria-label={t.comboLegendTitle}>{([['match', t.helpTabMatch], ['combos', t.helpTabCombos], ['cards', t.helpTabCards], ['board', t.helpTabBoard]] as const).map(([id, label]) => <button type="button" key={id} className={tab === id ? 'active' : ''} aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>
        <div className="help-scroll">
          {tab === 'match' ? <div className="guide-match"><h3>{t.helpMatchTitle}</h3><div className="match-steps">{[t.helpStepPlan, t.helpStepLock, t.helpStepReveal, t.helpStepScore].map((step, i) => <div className="match-step" key={step}><b>{i + 1}</b><span>{step}</span></div>)}</div><p className="match-goal">🏆 {t.helpMostZones}</p><h3>{t.helpZonesTitle}</h3><div className="guide-zones">{[['cool', t.zoneCoolRule], ['party', t.zonePartyRule], ['energy', t.zoneEnergyRule]].map(([id, rule]) => <div className={`guide-zone zone-${id}`} key={id}><ZoneIconMini id={id}/><b>{id.toUpperCase()}</b><span>{rule}</span></div>)}</div></div> : null}
          {tab === 'combos' ? <div className="guide-combos">{GROUPS.map((g) => <article className="guide-combo" key={g} style={{ '--guide-color': COMBO_COLORS[g] } as CSSProperties}><header><span className="combo-dot" style={{ background: COMBO_COLORS[g] }}/><strong>{groupName[g]}</strong></header><div className="guide-combo-cards">{COMBO_GROUP_MEMBERS[g].map((id) => { const flavor = getFlavorById(id); return flavor ? <span className="guide-mini-card" key={id}><img src={flavorImageUrl(flavor)} alt=""/><small>{t.flavors[id] || flavor.name}</small></span> : null; })}</div><p>{groupDesc[g]}</p></article>)}</div> : null}
          {tab === 'cards' ? <div className="guide-card-view"><div className="guide-card-grid">{FLAVORS.map((flavor) => { const groups = getCardGroups(flavor.id as FlavorId); return <button type="button" className={`guide-card-tile${cardId === flavor.id ? ' active' : ''}`} key={flavor.id} onClick={() => setCardId(flavor.id)} aria-pressed={cardId === flavor.id}><span className="guide-card-art" style={{ background: comboBackground(groups) || '#293247' }}><img src={flavorImageUrl(flavor)} alt=""/></span><b>{t.flavors[flavor.id] || flavor.name}</b></button>; })}</div>{(() => { const flavor = getFlavorById(cardId); if (!flavor) return null; const groups = getCardGroups(flavor.id as FlavorId); const tags = flavor.tags.map((tag) => tag === 'apple' ? t.tagApple : tag === 'malt' ? t.tagMalt : t.tagPineapple); return <article className="guide-card-detail"><span className="guide-detail-art" style={{ background: comboBackground(groups) || '#293247' }}><img src={flavorImageUrl(flavor)} alt=""/></span><div><h3>{t.flavors[flavor.id] || flavor.name}</h3><p>{t.cardEffects[flavor.id]}</p>{tags.length ? <small>{t.helpTags}: {tags.join(' · ')}</small> : null}</div></article>; })()}</div> : null}
          {tab === 'board' ? <div className="guide-board"><div className="guide-board-card"><span className="guide-power">3</span><span className="guide-board-can"><img src={flavorImageUrl(getFlavorById('v-cola')!)} alt=""/></span><b>V COLA</b><span className="guide-progress">1/3</span></div><ul className="help-reading">{[t.helpPower, t.helpProgress, t.helpChips, t.helpCancelled, t.helpColors].map((s) => <li key={s}>{s}</li>)}</ul><div className="guide-chip-examples"><span>+1</span><span>-1</span><span>x2</span><span>WIN</span><span className="cancelled-mark">×</span></div></div> : null}
        </div>
      </section>
    </div>, document.body) : null}
  </>;
}

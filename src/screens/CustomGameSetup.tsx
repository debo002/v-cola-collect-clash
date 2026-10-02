import { useState } from 'react';
import { FLAVORS } from '../game/cards';
import { getCardGroups } from '../game/effects';
import { DEFAULT_CUSTOM_CONFIG, DEFAULT_FIXED_POWER, validateGameConfig, type GameConfig } from '../game/config';
import type { FlavorId } from '../game/types';
import { GameCard } from '../components/GameCard';
import { fmt, useI18n } from '../i18n';

type Choice<T extends string> = { value: T; label: string };

function Segments<T extends string>({ value, choices, onChange, label }: {
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  return <div className="custom-segments" role="group" aria-label={label}>
    {choices.map((choice) => <button key={choice.value} type="button" className={value === choice.value ? 'active' : ''} aria-pressed={value === choice.value} onClick={() => onChange(choice.value)}>{choice.label}</button>)}
  </div>;
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (value: number) => void; label: string }) {
  return <div className="custom-stepper" aria-label={label}>
    <button type="button" aria-label={`${label} −`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
    <output aria-live="polite">{value}</output>
    <button type="button" aria-label={`${label} +`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
  </div>;
}

export function CustomGameSetup({ onBack, onStart }: { onBack: () => void; onStart: (config: GameConfig) => void }) {
  const { t } = useI18n();
  const [config, setConfig] = useState<GameConfig>({ ...DEFAULT_CUSTOM_CONFIG, fixedPower: DEFAULT_FIXED_POWER });
  const error = validateGameConfig(config);
  const update = (next: Partial<GameConfig>) => setConfig((old) => ({ ...old, ...next }));
  const chosen = config.deck.kind === 'custom' ? config.deck.flavors : [];
  const setPower = (id: FlavorId, power: number) => update({ fixedPower: { ...config.fixedPower, [id]: power } });
  const deckChoices: readonly Choice<GameConfig['deck']['kind']>[] = [
    { value: 'normal', label: t.normalDeck },
    { value: 'custom', label: t.customDeck },
  ];

  return <section className="custom-setup" aria-label={t.customGameSetup}>
    <header className="custom-setup-head">
      <div><h2>{t.customGameSetup}</h2><p>{t.setupDeckLabel}</p></div>
      <div className="custom-setup-head-actions">
        {config.deck.kind === 'custom' ? <span className="custom-selected-count">{fmt(t.selectedCans, { count: chosen.length })}</span> : null}
        <button type="button" className="btn btn-secondary custom-back" onClick={onBack}>{t.setupBack}</button>
      </div>
    </header>

    <div className="custom-deck-mode">
      <span>{t.setupDeckLabel}</span>
      <Segments value={config.deck.kind} choices={deckChoices} label={t.setupDeckLabel} onChange={(kind) => update({ deck: kind === 'normal' ? { kind: 'normal' } : { kind: 'custom', flavors: chosen.length ? [...chosen] : FLAVORS.slice(0, 6).map((flavor) => flavor.id) } })} />
    </div>

    {config.deck.kind === 'custom' ? (
      <div className={`custom-roster-cards${config.power === 'fixed' ? ' with-power' : ''}`} aria-label={t.customDeckLabel}>
        {FLAVORS.map((flavor) => {
          const selected = chosen.includes(flavor.id);
          const displayName = t.flavors[flavor.id] || flavor.name;
          return <article key={flavor.id} className={`custom-can${selected ? ' selected' : ''}`}>
            <button type="button" className="custom-can-select" aria-pressed={selected} aria-label={displayName} onClick={() => update({ deck: { kind: 'custom', flavors: selected ? chosen.filter((id) => id !== flavor.id) : [...chosen, flavor.id] } })}>
              <GameCard flavor={flavor} displayName={displayName} selected={selected} groups={getCardGroups(flavor.id as FlavorId)} />
              <span className="custom-can-check" aria-hidden="true">{selected ? '✓' : '+'}</span>
            </button>
            {config.power === 'fixed' ? <div className="custom-can-power">
              <span>{fmt(t.powerValue, { power: config.fixedPower[flavor.id] ?? DEFAULT_FIXED_POWER[flavor.id] })}</span>
              <Stepper value={config.fixedPower[flavor.id] ?? DEFAULT_FIXED_POWER[flavor.id]} min={1} max={5} onChange={(value) => setPower(flavor.id, value)} label={displayName} />
            </div> : null}
          </article>;
        })}
      </div>
    ) : <div className="normal-deck-note"><span className="normal-deck-mark">V7</span><span>{t.normalDeckDesc}</span></div>}

    <div className="custom-rules-panel">
      <div className="custom-setting">
        <span>{t.dealing}</span>
        <Segments value={config.dealing} choices={[
          { value: 'reveal-all', label: t.revealAll },
          { value: 'draw-per-round', label: t.drawPerRound },
        ]} label={t.dealing} onChange={(dealing) => update({ dealing })} />
      </div>
      {config.dealing === 'draw-per-round' ? <div className="custom-setting compact-setting">
        <span>{t.drawCount}</span><Stepper value={config.drawPerRound} min={1} max={3} onChange={(drawPerRound) => update({ drawPerRound })} label={t.drawCount} />
      </div> : null}
      <div className="custom-setting compact-setting">
        <span>{t.maxPlaced}</span><Stepper value={config.maxPlacedPerRound} min={1} max={11} onChange={(maxPlacedPerRound) => update({ maxPlacedPerRound })} label={t.maxPlaced} />
      </div>
      <div className="custom-setting">
        <span>{t.powerMode}</span>
        <Segments value={config.power} choices={[{ value: 'random', label: t.randomPower }, { value: 'fixed', label: t.fixedPower }]} label={t.powerMode} onChange={(power) => update({ power })} />
      </div>
      <div className="custom-setting">
        <span>{t.effectsEnabled}</span>
        <Segments value={config.effectsEnabled ? 'on' : 'off'} choices={[{ value: 'on', label: t.effectsOn }, { value: 'off', label: t.effectsOff }]} label={t.effectsEnabled} onChange={(value) => update({ effectsEnabled: value === 'on' })} />
      </div>
    </div>

    <footer className="custom-setup-footer">
      {error ? <p className="setup-error" role="alert">{t.setupInvalid}</p> : <span className="custom-ready-mark">{t.customGame}</span>}
      <button type="button" className="btn btn-primary custom-start" disabled={!!error} onClick={() => onStart(config)}>{t.startCustom}</button>
    </footer>
  </section>;
}

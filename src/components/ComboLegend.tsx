import { getFlavorById } from '../game/cards';
import type { ComboGroup } from '../game/effects';
import { COMBO_GROUP_MEMBERS } from '../game/effects';
import { comboDescription, useI18n } from '../i18n';
import { COMBO_COLORS } from './comboTheme';

const ORDER: readonly ComboGroup[] = ['cola', 'citrus', 'ingredient', 'berry', 'solo'];

/** Collapsible legend: group colors + member cards + what each group's combo does. */
export function ComboLegend() {
  const { t } = useI18n();
  const names: Record<ComboGroup, string> = {
    cola: t.comboGroupCola,
    citrus: t.comboGroupCitrus,
    ingredient: t.comboGroupIngredient,
    berry: t.comboGroupBerry,
    solo: t.comboGroupSolo,
  };
  return (
    <details className="combo-legend">
      <summary>{t.comboLegendTitle}</summary>
      <ul>
        {ORDER.map((g) => (
          <li key={g}>
            <span
              className="combo-dot"
              style={{ background: COMBO_COLORS[g] }}
              aria-hidden="true"
            />
            <span>
              <strong>{names[g]}</strong>
              <span className="legend-cards">
                {COMBO_GROUP_MEMBERS[g]
                  .map((id) => t.flavors[id] || getFlavorById(id)?.name || id)
                  .join(' · ')}
              </span>
              {' — '}
              {comboDescription(t, g)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

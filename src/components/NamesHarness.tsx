import { FLAVORS } from '../game/cards';
import type { FlavorId } from '../game/types';
import { Stage } from './Stage';
import { Hand } from './match/Hand';
import { ZoneColumn } from './match/ZoneColumn';
import type { StripCard } from './match/boardUtils';

/**
 * Test-only harness for the card-names Playwright script (?harness=names).
 * Renders every flavor through the REAL Hand + ZoneColumn components (real
 * CSS, real Stage scaling) in hand size and board size, so overflow
 * assertions measure production layout. Never linked from the UI.
 */
export function NamesHarness() {
  const noop = () => {};
  const cards = FLAVORS.map((flavor, index) => ({
    card: { flavor: flavor.id as FlavorId, power: 3, loaner: false as const },
    index,
  }));
  const zones: StripCard[][] = [[], [], [], []];
  FLAVORS.forEach((flavor, i) => {
    zones[Math.floor(i / 3)]?.push({
      key: `harness-${flavor.id}`,
      handIndex: i,
      flavorId: flavor.id,
      power: 3,
      recallable: false,
    });
  });
  // Real hands never show more than ~6 unplaced cards side by side; split
  // 6+5 so plate widths match production (an 11-card fan would squeeze
  // narrower than any real layout and prove nothing).
  const handA = cards.slice(0, 6);
  const handB = cards.slice(6);
  const handProps = (visible: typeof cards, title: string) => ({
    visibleCards: visible,
    selected: null as number | null,
    draggingIndex: null as number | null,
    shakeKey: 0,
    handTitle: title,
    handTip: 'harness',
    lockLabel: 'harness',
    canLock: false,
    onCardPointerDown: noop,
    onCardPointerMove: noop,
    onCardPointerUp: noop,
    onCardPointerCancel: noop,
    onLongPress: noop,
    onLock: noop,
  });
  return (
    <Stage>
      <div className="names-harness" aria-label="card names harness">
        <Hand {...handProps(handA, 'harness hand 6')} />
        <Hand {...handProps(handB, 'harness hand 5')} />
        <div className="zones-row">
          {zones.map((mine, zi) => (
            <ZoneColumn
              key={zi}
              zoneId={['cool', 'party', 'energy'][zi] ?? 'cool'}
              zoneName={`z${zi}`}
              zoneRule=""
              foeCards={[]}
              myCards={mine}
              foeScore={0}
              myScore={mine.length * 3}
              dropReady={false}
              dropTarget={false}
              spotlight={false}
              dimmed={false}
              victory={false}
              onZoneClick={noop}
              onRecall={noop}
            />
          ))}
        </div>
      </div>
    </Stage>
  );
}

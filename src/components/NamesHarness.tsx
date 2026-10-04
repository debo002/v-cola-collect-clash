import { FLAVORS } from '../game/cards';
import { DEFAULT_GAME_CONFIG } from '../game/config';
import type { PlayerView, VisiblePlacedCard } from '../game/controller';
import type { HandCard } from '../game/hands';
import type { Player } from '../game/match';
import type { ZoneExplanation, ZoneResult } from '../game/scoring';
import type { FlavorId } from '../game/types';
import { Stage } from './Stage';
import { Board } from './match/Board';
import { TopBar } from './match/TopBar';
import { TimerCountdown } from './match/TimerCountdown';
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

const BOARD_FLAVORS: FlavorId[] = [
  'v-cola',
  'v7-pineapple-malt',
  'pink-lemonade',
  'pomegranate',
  'blueberry',
  'lemon-mint',
  'v-lemon',
  'pina-colada',
  'cream-soda',
];

function placedCards(count: number, power: number): VisiblePlacedCard[] {
  return BOARD_FLAVORS.slice(0, count).map((flavor, i) => ({
    handIndex: 100 + i,
    flavor,
    power,
    loaner: false,
  }));
}

const FLAVOR_IDS_11 = FLAVORS.map((f) => f.id);

function syntheticHand(count: number): HandCard[] {
  return Array.from({ length: count }, (_, i) => ({
    flavor: FLAVOR_IDS_11[i % FLAVOR_IDS_11.length] as FlavorId,
    power: 3,
    loaner: false,
  }));
}

function syntheticResults(): { results: ZoneResult[]; explanations: ZoneExplanation[] } {
  const zones = ['cool', 'party', 'energy'];
  const results: ZoneResult[] = zones.map((zoneId, zi) => ({
    zoneId,
    base: { A: 9 - zi, B: 8 - zi },
    bonus: { A: 0, B: 0 },
    totals: { A: 9 - zi, B: 8 - zi },
    winner: 'A' as Player,
  }));
  const explanations: ZoneExplanation[] = results.map((r) => ({
    ...r,
    adjustments: [],
    noBonus: 'none-equal' as const,
  }));
  return { results, explanations };
}

/**
 * Deterministic full-board harness (?harness=board&scene=full|reveal|
 * resolution|results): real TopBar + Board with a full hand and 3 cards in
 * every zone. Scenes mirror the online screen props 1:1.
 */
export function BoardHarness({ scene }: { scene: string }) {
  const noop = () => {};
  const { results, explanations } = syntheticResults();
  const revealedBoard = {
    kind: 'revealed' as const,
    zones: Object.fromEntries(
      ['cool', 'party', 'energy'].map((z) => [
        z,
        { mine: placedCards(3, 3), foe: placedCards(3, 2) },
      ])
    ),
  };
  const currentBoard = {
    kind: 'current' as const,
    zones: Object.fromEntries(
      ['cool', 'party', 'energy'].map((z) => [z, { mine: placedCards(3, 3) }])
    ),
  };
  const view: PlayerView = {
    seat: 'A',
    phase: scene === 'full' ? 'placing' : scene === 'reveal' ? 'roundReveal' : 'complete',
    round: 3,
    config: DEFAULT_GAME_CONFIG,
    hand: syntheticHand(15),
    boards: scene === 'full' ? [currentBoard] : [revealedBoard, revealedBoard, currentBoard],
    locks: { A: false, B: false },
    ready: { me: false, opponent: false },
    opponentHandCount: 9,
    deadlineMs: scene === 'full' ? Date.now() + 37_000 : null,
    drawsRemaining: 0,
    results: scene === 'results' || scene === 'resolution' ? results : null,
    winner: scene === 'results' || scene === 'resolution' ? 'A' : null,
    explanations: scene === 'results' || scene === 'resolution' ? explanations : null,
  };
  const names = { A: 'Alice', B: 'Bob' };
  const isRevealing = scene !== 'full';
  const isMatchOver = scene === 'results' || scene === 'resolution';
  return (
    <Stage>
      <div className="match-screen">
        <TopBar
          displayRound={3}
          timer={
            scene === 'full' && view.deadlineMs !== null ? (
              <TimerCountdown deadlineMs={view.deadlineMs} nowFn={() => Date.now()} />
            ) : undefined
          }
          onMenu={noop}
          names={{ me: 'Alice', opponent: 'Bob' }}
        />
        <Board
          view={view}
          names={names}
          displayRound={3}
          isRevealing={isRevealing}
          isMatchOver={isMatchOver}
          results={view.results}
          winner={view.winner}
          explanations={view.explanations}
          shakeKey={0}
          onPlace={noop}
          onUnplace={noop}
          onLock={noop}
          onTooMany={noop}
          onNextRound={noop}
          onRematch={noop}
          onReturnMenu={noop}
        />
      </div>
    </Stage>
  );
}

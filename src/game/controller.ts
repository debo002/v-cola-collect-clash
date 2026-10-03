import type { GameConfig } from './config';
import type { HandCard } from './hands';
import type { ZoneExplanation, ZoneResult } from './scoring';
import type { Player } from './match';
import type { FlavorId } from './types';

/**
 * A card the viewer may inspect. Full flavor/power/loaner — used for own
 * current-round placements and for both sides once a round is revealed.
 */
export interface VisiblePlacedCard {
  readonly handIndex: number;
  readonly flavor: FlavorId;
  readonly power: number;
  readonly loaner: boolean;
}

export interface RevealedZoneView {
  readonly mine: readonly VisiblePlacedCard[];
  readonly foe: readonly VisiblePlacedCard[];
}

export interface CurrentZoneView {
  readonly mine: readonly VisiblePlacedCard[];
  /** Opponent current-round placements: COUNT only, no card objects. */
  readonly foeCount: number;
}

export interface RevealedBoardView {
  readonly kind: 'revealed';
  readonly zones: Readonly<Record<string, RevealedZoneView>>;
}

export interface CurrentBoardView {
  readonly kind: 'current';
  readonly zones: Readonly<Record<string, CurrentZoneView>>;
}

export type BoardView = RevealedBoardView | CurrentBoardView;

/**
 * The only match shape a game screen receives. Safe to serialize: the
 * opponent's hand is a count, and the opponent's current-round placements
 * are per-zone counts. Accessing flavor/power/loaner/handIndex on the
 * opponent's current round is a COMPILE error (no such field exists).
 */
export interface PlayerView {
  readonly seat: Player;
  readonly phase: 'idle' | 'placing' | 'roundReveal' | 'complete';
  readonly round: number;
  readonly config: GameConfig;
  readonly hand: readonly HandCard[];
  readonly boards: readonly BoardView[];
  readonly locks: Readonly<Record<Player, boolean>>;
  readonly opponentHandCount: number;
  readonly deadlineMs: number | null;
  readonly drawPileCount?: number;
  readonly drawsRemaining: number;
  readonly results: readonly ZoneResult[] | null;
  readonly winner: Player | null;
  readonly explanations: readonly ZoneExplanation[] | null;
}

export type Intent =
  | { readonly type: 'place'; readonly handIndex: number; readonly zone: string }
  | { readonly type: 'unplace'; readonly handIndex: number }
  | { readonly type: 'lock' }
  | { readonly type: 'draw' }
  | { readonly type: 'rematch' };

export interface GameController {
  readonly mySeat: Player;
  subscribe(listener: (view: PlayerView) => void): () => void;
  onReject(listener: (reason: string) => void): () => void;
  send(intent: Intent): void;
  dispose(): void;
}

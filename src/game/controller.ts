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
 * are NOT included at all — not cards, not counts, not zones. Accessing
 * anything about the opponent's current round is a COMPILE error (no such
 * field exists). Opponent cards appear only on revealed boards.
 */
export interface PlayerView {
  readonly seat: Player;
  readonly phase: 'idle' | 'placing' | 'roundReveal' | 'complete';
  readonly round: number;
  readonly config: GameConfig;
  readonly hand: readonly HandCard[];
  readonly boards: readonly BoardView[];
  readonly locks: Readonly<Record<Player, boolean>>;
  /**
   * Round-reveal confirmations, per viewer: additive, non-secret, survives
   * reload/reconnect (drives "Waiting for opponent…" UI).
   */
  readonly ready: Readonly<{ me: boolean; opponent: boolean }>;
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
  | { readonly type: 'ready' }
  | { readonly type: 'rematch' };

export interface GameController {
  readonly mySeat: Player;
  subscribe(listener: (view: PlayerView) => void): () => void;
  onReject(listener: (reason: string) => void): () => void;
  send(intent: Intent): void;
  dispose(): void;
}

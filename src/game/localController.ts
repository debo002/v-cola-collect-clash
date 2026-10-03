import type { Collection } from './collection';
import { DEFAULT_GAME_CONFIG, type GameConfig } from './config';
import type { GameController, Intent, PlayerView } from './controller';
import { buildQuickPlayHand } from './hands';
import type { Player } from './match';
import {
  apply,
  applyDrawTimeout,
  applyTimeout,
  beginTurn,
  createRoomState,
  type RoomState,
} from './matchEngine';
import { rollPower, shuffled } from './rng';
import { buildPlayerView } from './view';

export interface ControllerClock {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
  now(): number;
}

function defaultClock(): ControllerClock {
  return {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    now: () => Date.now(),
  };
}

const idleView = (seat: Player, config: GameConfig): PlayerView => ({
  seat,
  phase: 'idle',
  round: 1,
  config,
  hand: [],
  boards: [],
  locks: { A: false, B: false },
  opponentHandCount: 0,
  deadlineMs: null,
  drawsRemaining: 0,
  results: null,
  winner: null,
  explanations: null,
});

/**
 * Pass-and-play adapter used while the network implementation is absent.
 * Thin wrapper over the shared engine: every intent goes through apply(),
 * views come from buildPlayerView(). Timer parity with master: each hot-seat
 * turn has its own 60s clock, reset on setSeat; a timeout auto-places only
 * the active seat.
 */
export class LocalController implements GameController {
  private currentSeat: Player = 'A';
  private listeners = new Set<(view: PlayerView) => void>();
  private rejectListeners = new Set<(reason: string) => void>();
  private room: RoomState | null = null;
  private config: GameConfig = DEFAULT_GAME_CONFIG;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly clock: ControllerClock;

  constructor(
    private readonly collection: Collection,
    clock?: ControllerClock
  ) {
    this.clock = clock ?? defaultClock();
  }

  get mySeat(): Player {
    return this.currentSeat;
  }

  subscribe(listener: (view: PlayerView) => void): () => void {
    this.listeners.add(listener);
    listener(this.view());
    return () => {
      this.listeners.delete(listener);
    };
  }

  onReject(listener: (reason: string) => void): () => void {
    this.rejectListeners.add(listener);
    return () => {
      this.rejectListeners.delete(listener);
    };
  }

  startQuickPlay(): void {
    this.start(
      DEFAULT_GAME_CONFIG,
      buildQuickPlayHand(this.collection),
      buildQuickPlayHand(this.collection),
      [],
      []
    );
  }

  startCustomGame(config: GameConfig): void {
    const roster = config.deck.kind === 'custom' ? config.deck.flavors : null;
    const makeHand = () => {
      const hand = roster
        ? roster.map((flavor) => ({
            flavor,
            loaner: true,
            power: config.power === 'fixed' ? (config.fixedPower[flavor] ?? 3) : rollPower(),
          }))
        : buildQuickPlayHand(this.collection);
      return config.power === 'fixed' && roster === null
        ? hand.map((card) => ({ ...card, power: config.fixedPower[card.flavor] ?? 3 }))
        : hand;
    };
    const handA = makeHand();
    const handB = makeHand();
    if (config.dealing === 'draw-per-round') {
      const poolA = roster ? [...roster] : handA.map((card) => card.flavor);
      const poolB = roster ? [...roster] : handB.map((card) => card.flavor);
      this.start(config, [], [], shuffled(poolA, Math.random), shuffled(poolB, Math.random));
      return;
    }
    this.start(config, handA, handB, [], []);
  }

  setSeat(seat: Player): void {
    this.currentSeat = seat;
    if (this.room !== null) {
      this.room = beginTurn(this.room, seat, this.ctx());
    }
    this.syncTimer();
    this.emit();
  }

  /** Hot-seat convenience: both seats confirm the reveal, advancing the round. */
  nextRound(): void {
    if (this.room === null || this.room.stage !== 'roundReveal') return;
    const ctx = this.ctx();
    const first = apply(this.room, 'A', { type: 'ready' }, ctx);
    const second = apply(first.state, 'B', { type: 'ready' }, ctx);
    this.room = beginTurn(second.state, 'A', ctx);
    this.currentSeat = 'A';
    this.syncTimer();
    this.emit();
  }

  endMatch(): void {
    this.clearTimer();
    this.room = null;
    this.emit();
  }

  send(intent: Intent): void {
    if (intent.type === 'rematch') {
      this.startCustomGame(this.config);
      return;
    }
    if (this.room === null) return;
    const result = apply(this.room, this.currentSeat, intent, this.ctx());
    if (result.rejected !== undefined) {
      this.reject(result.rejected);
      return;
    }
    this.room = result.state;
    this.syncTimer();
    this.emit();
  }

  dispose(): void {
    this.clearTimer();
    this.listeners.clear();
    this.rejectListeners.clear();
  }

  private ctx(): { now: number; rng: () => number } {
    return { now: this.clock.now(), rng: Math.random };
  }

  private start(
    config: GameConfig,
    handA: PlayerView['hand'],
    handB: PlayerView['hand'],
    poolA: RoomState['decks']['A'],
    poolB: RoomState['decks']['B']
  ): void {
    this.clearTimer();
    this.config = config;
    this.room = createRoomState(config, handA, handB, poolA, poolB, this.clock.now());
    this.currentSeat = 'A';
    this.emit();
  }

  private syncTimer(): void {
    this.clearTimer();
    const deadline = this.room?.deadlineMs ?? null;
    if (deadline === null) return;
    const seat = this.currentSeat;
    const delay = Math.max(0, deadline - this.clock.now());
    this.timer = this.clock.setTimeout(() => {
      if (this.room === null) return;
      const result =
        this.room.drawMs !== null
          ? applyDrawTimeout(this.room, this.ctx())
          : applyTimeout(this.room, [seat], this.ctx());
      this.room = result.state;
      this.syncTimer();
      this.emit();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
    }
    this.timer = null;
  }

  private view(): PlayerView {
    if (this.room === null) return idleView(this.currentSeat, this.config);
    return buildPlayerView(this.room, this.currentSeat);
  }

  private emit(): void {
    const view = this.view();
    for (const listener of this.listeners) listener(view);
  }

  private reject(reason: string): void {
    for (const listener of this.rejectListeners) listener(reason);
  }
}

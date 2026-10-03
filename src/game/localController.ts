import type { Collection } from './collection';
import { DEFAULT_GAME_CONFIG, type GameConfig } from './config';
import type {
  BoardView,
  CurrentBoardView,
  GameController,
  Intent,
  PlayerView,
  RevealedBoardView,
  VisiblePlacedCard,
} from './controller';
import { buildQuickPlayHand } from './hands';
import {
  addDrawnCard,
  autoPlaceForTimeout,
  bothLocked,
  createMatch,
  lockPlayer,
  placeCards,
  revealRound,
  TIMER_SECONDS,
  unplaceCard,
  type MatchState,
  type Player,
} from './match';
import { intBelow, rollPower, shuffled } from './rng';
import { explainMatch, scoreMatch } from './scoring';
import { matchWinner } from './series';
import type { FlavorId } from './types';
import { ZONES } from './zones';

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

type LocalStage = 'idle' | 'placing' | 'roundReveal' | 'complete';

/** Pass-and-play adapter used while the network implementation is absent. */
export class LocalController implements GameController {
  private currentSeat: Player = 'A';
  private listeners = new Set<(view: PlayerView) => void>();
  private rejectListeners = new Set<(reason: string) => void>();
  private match: MatchState | null = null;
  private config: GameConfig = DEFAULT_GAME_CONFIG;
  private stage: LocalStage = 'idle';
  private drawDecks: Record<Player, FlavorId[]> = { A: [], B: [] };
  private drawsLeft: Record<Player, number> = { A: 0, B: 0 };
  private deadlineMs: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private results: PlayerView['results'] = null;
  private winner: Player | null = null;
  private explanations: PlayerView['explanations'] = null;
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
      buildQuickPlayHand(this.collection)
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
      this.drawDecks = { A: shuffled(poolA, Math.random), B: shuffled(poolB, Math.random) };
      this.start(config, [], []);
      return;
    }
    this.drawDecks = { A: [], B: [] };
    this.start(config, handA, handB);
  }

  setSeat(seat: Player): void {
    this.currentSeat = seat;
    this.beginRoundForSeat();
    this.emit();
  }

  nextRound(): void {
    if (this.stage !== 'roundReveal') return;
    this.stage = 'placing';
    this.currentSeat = 'A';
    this.beginRoundForSeat();
    this.emit();
  }

  endMatch(): void {
    this.stopTimer();
    this.match = null;
    this.stage = 'idle';
    this.results = null;
    this.winner = null;
    this.explanations = null;
    this.emit();
  }

  send(intent: Intent): void {
    if (intent.type === 'rematch') {
      this.startCustomGame(this.config);
      return;
    }
    if (this.match === null || this.stage !== 'placing') {
      return;
    }
    if (intent.type === 'place') {
      const placements = this.currentPlacements();
      if (placements.has(intent.handIndex)) {
        placements.set(intent.handIndex, intent.zone);
      } else {
        const maxPlaced = this.match.maxPlacedPerRound ?? 2;
        if (placements.size >= maxPlaced) {
          this.reject(`Place at most ${maxPlaced} cards per round`);
          return;
        }
        placements.set(intent.handIndex, intent.zone);
      }
      try {
        const list = [...placements.entries()].map(([handIndex, zone]) => ({ handIndex, zone }));
        this.match = placeCards(this.match, this.currentSeat, list);
      } catch (error) {
        this.reject(error instanceof Error ? error.message : 'Invalid placement');
        return;
      }
      this.emit();
      return;
    }
    if (intent.type === 'unplace') {
      try {
        this.match = unplaceCard(this.match, this.currentSeat, intent.handIndex);
      } catch (error) {
        this.reject(error instanceof Error ? error.message : 'Cannot remove card');
        return;
      }
      this.emit();
      return;
    }
    if (intent.type === 'draw') {
      try {
        this.draw();
      } catch (error) {
        this.reject(error instanceof Error ? error.message : 'Cannot draw');
        return;
      }
      this.emit();
      return;
    }
    if (intent.type === 'lock') {
      try {
        this.match = lockPlayer(this.match, this.currentSeat);
      } catch (error) {
        this.reject(error instanceof Error ? error.message : 'Cannot lock in yet');
        return;
      }
      this.stopTimer();
      if (bothLocked(this.match)) {
        this.reveal();
      }
      this.emit();
      return;
    }
  }

  dispose(): void {
    this.stopTimer();
    this.listeners.clear();
    this.rejectListeners.clear();
  }

  private start(config: GameConfig, handA: PlayerView['hand'], handB: PlayerView['hand']): void {
    this.stopTimer();
    this.config = config;
    this.match = createMatch(handA, handB, config);
    this.stage = 'placing';
    this.results = null;
    this.winner = null;
    this.explanations = null;
    this.currentSeat = 'A';
    this.drawsLeft = { A: 0, B: 0 };
    this.deadlineMs = null;
    this.emit();
  }

  private beginRoundForSeat(): void {
    if (this.match === null || this.stage !== 'placing') return;
    const seat = this.currentSeat;
    const count =
      this.config.dealing === 'draw-per-round'
        ? Math.min(this.config.drawPerRound, this.drawDecks[seat].length)
        : 0;
    this.drawsLeft = { ...this.drawsLeft, [seat]: count };
    if (count === 0) {
      this.startTimer();
    } else {
      this.stopTimer();
    }
  }

  private draw(): void {
    if (this.match === null) throw new RangeError('No match');
    const seat = this.currentSeat;
    if (this.drawsLeft[seat] <= 0) throw new RangeError('No draws remaining');
    const pool = this.drawDecks[seat];
    if (pool.length === 0) throw new RangeError('No cards left to draw');
    const index = intBelow(Math.random, pool.length);
    const flavor = pool[index];
    if (flavor === undefined) throw new RangeError('No cards left to draw');
    const rest = pool.filter((_, i) => i !== index);
    this.drawDecks = { ...this.drawDecks, [seat]: rest };
    this.match = addDrawnCard(this.match, seat, {
      flavor,
      loaner: true,
      power: this.config.power === 'fixed' ? (this.config.fixedPower[flavor] ?? 3) : rollPower(),
    });
    this.drawsLeft = { ...this.drawsLeft, [seat]: Math.max(0, this.drawsLeft[seat] - 1) };
    if (this.drawsLeft[seat] === 0) {
      this.startTimer();
    }
  }

  private startTimer(): void {
    this.stopTimer();
    this.deadlineMs = this.clock.now() + TIMER_SECONDS * 1000;
    const seat = this.currentSeat;
    this.timer = this.clock.setTimeout(() => {
      if (this.match === null || this.stage !== 'placing') return;
      this.match = autoPlaceForTimeout(this.match, seat);
      if (bothLocked(this.match)) {
        this.reveal();
      }
      this.emit();
    }, TIMER_SECONDS * 1000);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
    }
    this.timer = null;
    this.deadlineMs = null;
  }

  private reveal(): void {
    if (this.match === null) return;
    this.match = revealRound(this.match);
    this.stopTimer();
    if (this.match.phase === 'complete') {
      this.stage = 'complete';
      this.results = scoreMatch(this.match, this.config);
      this.winner = matchWinner(this.results);
      this.explanations = explainMatch(this.match, this.config);
    } else {
      this.stage = 'roundReveal';
    }
  }

  private currentPlacements(): Map<number, string> {
    const placements = new Map<number, string>();
    if (this.match === null) return placements;
    const board = this.match.boards[this.match.round - 1];
    if (board === undefined) return placements;
    for (const zone of ZONES) {
      const side = board[zone.id];
      if (side === undefined) continue;
      for (const card of side[this.currentSeat]) {
        placements.set(card.handIndex, zone.id);
      }
    }
    return placements;
  }

  private view(): PlayerView {
    if (this.match === null) {
      return {
        seat: this.currentSeat,
        phase: 'idle',
        round: 1,
        config: this.config,
        hand: [],
        boards: [],
        locks: { A: false, B: false },
        opponentHandCount: 0,
        deadlineMs: null,
        drawsRemaining: 0,
        results: null,
        winner: null,
        explanations: null,
      };
    }
    const match = this.match;
    const seat = this.currentSeat;
    const foe: Player = seat === 'A' ? 'B' : 'A';
    const boards: BoardView[] = [];
    const visibleCount = match.phase === 'complete' ? match.boards.length : match.round;
    for (let bi = 0; bi < visibleCount; bi += 1) {
      const board = match.boards[bi];
      if (board === undefined) continue;
      const revealed = this.stage === 'complete' || bi < match.round - 1;
      if (revealed) {
        const zones: Record<string, RevealedBoardView['zones'][string]> = {};
        for (const zone of ZONES) {
          const side = board[zone.id];
          const mine: VisiblePlacedCard[] = [];
          const foeCards: VisiblePlacedCard[] = [];
          if (side !== undefined) {
            for (const card of side[seat]) {
              const held = match.hands[seat][card.handIndex];
              if (held === undefined) continue;
              mine.push({
                handIndex: card.handIndex,
                flavor: held.flavor,
                power: held.power,
                loaner: held.loaner,
              });
            }
            for (const card of side[foe]) {
              if (card.power === null) continue;
              foeCards.push({
                handIndex: card.handIndex,
                flavor: card.flavor,
                power: card.power,
                loaner: card.loaner,
              });
            }
          }
          zones[zone.id] = { mine, foe: foeCards };
        }
        boards.push({ kind: 'revealed', zones });
      } else {
        const zones: Record<string, CurrentBoardView['zones'][string]> = {};
        for (const zone of ZONES) {
          const side = board[zone.id];
          const mine: VisiblePlacedCard[] = [];
          let foeCount = 0;
          if (side !== undefined) {
            for (const card of side[seat]) {
              const held = match.hands[seat][card.handIndex];
              if (held === undefined) continue;
              mine.push({
                handIndex: card.handIndex,
                flavor: held.flavor,
                power: held.power,
                loaner: held.loaner,
              });
            }
            foeCount = side[foe].length;
          }
          zones[zone.id] = { mine, foeCount };
        }
        boards.push({ kind: 'current', zones });
      }
    }
    return {
      seat,
      phase: this.stage,
      round: match.round,
      config: this.config,
      hand: match.hands[seat],
      boards,
      locks: match.locks,
      opponentHandCount: match.hands[foe].length,
      deadlineMs: this.deadlineMs,
      drawPileCount:
        this.config.dealing === 'draw-per-round' ? this.drawDecks[seat].length : undefined,
      drawsRemaining: this.drawsLeft[seat],
      results: this.results,
      winner: this.winner,
      explanations: this.explanations,
    };
  }

  private emit(): void {
    const view = this.view();
    for (const listener of this.listeners) {
      listener(view);
    }
  }

  private reject(reason: string): void {
    for (const listener of this.rejectListeners) {
      listener(reason);
    }
  }
}

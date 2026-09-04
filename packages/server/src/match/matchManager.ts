import {
  BOMB_RESETS_TIMER,
  MIN_PLAYERS_TO_START,
  TURN_SECONDS,
  createBoard,
  createRng,
  isRoomFull,
  pickOne,
  revealCell,
  type Board,
  type PlayerPublic,
  type PublicMatchState,
  type RevealedCell,
  type RoomConfig,
  type RoomSummary,
  type Seat,
} from '@fmm/shared';
import { TurnTimer } from './turnTimer.js';

interface Occupant {
  id: string;
  nickname: string;
  score: number;
  totalScore: number;
  connected: boolean;
  /** Join order. Drives host succession and spectator promotion. */
  joinedAt: number;
}

/** Everything the room needs to push to its members. Keeps this class free of socket.io. */
export interface MatchBroadcaster {
  matchStart(state: PublicMatchState): void;
  cellRevealed(cell: RevealedCell, state: PublicMatchState): void;
  turnChanged(currentPlayerId: string, secondsLeft: number): void;
  turnTick(secondsLeft: number): void;
  matchEnded(state: PublicMatchState): void;
  matchReset(state: PublicMatchState): void;
  stateSync(state: PublicMatchState): void;
  error(playerId: string, code: string, message: string): void;
  /** Anything changed — refresh the lobby list and the server console. */
  changed(): void;
}

/**
 * One room: its seating, its match, its rules.
 *
 * The host is not stored. It is always the earliest-joined seated player, so
 * "host leaves, the first player who joined takes over" needs no bookkeeping
 * and cannot drift out of sync.
 */
export class MatchManager {
  private players: Occupant[] = [];
  private spectators: Occupant[] = [];
  private board: Board | null = null;
  private status: PublicMatchState['status'] = 'waiting';
  private currentPlayerId: string | null = null;
  private winnerId: string | null = null;
  private revealed: RevealedCell[] = [];
  private rematchVotes = new Set<string>();
  private seq = 0;

  /** Spec: "the winner of the previous match becomes the first player". */
  private lastWinnerId: string | null = null;

  readonly createdAt = Date.now();
  private readonly timer: TurnTimer;

  constructor(
    readonly roomId: string,
    readonly roomName: string,
    readonly config: RoomConfig,
    private readonly out: MatchBroadcaster,
  ) {
    this.timer = new TurnTimer(
      (secondsLeft) => this.out.turnTick(secondsLeft),
      () => this.handleTimeout(),
    );
  }

  // ── membership ───────────────────────────────────────────────────────────

  get hostId(): string | null {
    return this.orderedPlayers()[0]?.id ?? null;
  }

  get isEmpty(): boolean {
    return this.players.length === 0 && this.spectators.length === 0;
  }

  get memberCount(): number {
    return this.players.length + this.spectators.length;
  }

  isSeated(id: string): boolean {
    return this.players.some((p) => p.id === id);
  }

  has(id: string): boolean {
    return this.isSeated(id) || this.spectators.some((s) => s.id === id);
  }

  /**
   * Seats a client if there is room and no match is running.
   *
   * Joining mid-match makes them a spectator: dropping a new player into a
   * live turn rotation would be unfair to everyone already playing. They are
   * promoted automatically when the match ends.
   */
  addPlayer(id: string, nickname: string): Seat {
    const occupant: Occupant = {
      id,
      nickname,
      score: 0,
      totalScore: 0,
      connected: true,
      joinedAt: this.seq++,
    };

    if (isRoomFull(this.config, this.players.length) || this.status === 'playing') {
      this.spectators.push(occupant);
      this.out.changed();
      return 'spectator';
    }

    this.players.push(occupant);
    this.out.changed();
    return 'player';
  }

  addSpectator(id: string, nickname: string): Seat {
    this.spectators.push({
      id,
      nickname,
      score: 0,
      totalScore: 0,
      connected: true,
      joinedAt: this.seq++,
    });
    this.out.changed();
    return 'spectator';
  }

  /** Removes a member. Returns true when the room is now empty and should close. */
  remove(id: string): boolean {
    const wasSeated = this.isSeated(id);
    const wasCurrent = this.currentPlayerId === id;

    this.players = this.players.filter((p) => p.id !== id);
    this.spectators = this.spectators.filter((s) => s.id !== id);
    this.rematchVotes.delete(id);

    if (this.isEmpty) {
      this.timer.stop();
      return true;
    }

    if (wasSeated && this.status === 'playing') {
      if (this.seatedPlayers().length < MIN_PLAYERS_TO_START) {
        // Not enough players left to continue. Abandon the match.
        this.abandonMatch();
      } else if (wasCurrent) {
        // The player on turn walked away — hand the turn on rather than stall.
        this.passTurn();
      }
    }

    if (this.status === 'ended') this.settleRematch();

    this.out.stateSync(this.publicState());
    this.out.changed();
    return false;
  }

  private abandonMatch(): void {
    this.timer.stop();
    this.status = 'waiting';
    this.currentPlayerId = null;
    this.board = null;
    this.revealed = [];
    this.winnerId = null;
    this.rematchVotes.clear();
    this.promoteSpectators();
  }

  /** Fills free seats from the spectator queue, oldest first. */
  private promoteSpectators(): void {
    while (
      this.spectators.length > 0 &&
      !isRoomFull(this.config, this.players.length)
    ) {
      const next = this.spectators.shift()!;
      this.players.push(next);
    }
  }

  // ── match lifecycle ──────────────────────────────────────────────────────

  /** Host-only. Spec keeps the first player random; a rematch starts with the winner. */
  start(byPlayerId: string): void {
    if (byPlayerId !== this.hostId) {
      this.out.error(byPlayerId, 'NOT_HOST', 'Only the host can start the match.');
      return;
    }
    if (this.status === 'playing') {
      this.out.error(byPlayerId, 'ALREADY_PLAYING', 'The match has already started.');
      return;
    }

    this.promoteSpectators();

    if (this.seatedPlayers().length < MIN_PLAYERS_TO_START) {
      this.out.error(
        byPlayerId,
        'NOT_ENOUGH_PLAYERS',
        `Need at least ${MIN_PLAYERS_TO_START} players to start.`,
      );
      return;
    }

    this.startMatch(this.lastWinnerId ?? undefined);
  }

  private startMatch(firstPlayerId?: string): void {
    const seated = this.seatedPlayers();

    this.board = createBoard({
      rows: this.config.rows,
      cols: this.config.cols,
      bombCount: this.config.mineCount,
    });
    this.revealed = [];
    this.winnerId = null;
    this.rematchVotes.clear();
    for (const player of this.players) player.score = 0;

    const candidate =
      firstPlayerId && seated.some((p) => p.id === firstPlayerId)
        ? firstPlayerId
        : pickOne(createRng(), seated).id;

    this.currentPlayerId = candidate;
    this.status = 'playing';

    this.out.matchStart(this.publicState());
    this.timer.start(TURN_SECONDS);
    this.out.turnChanged(candidate, TURN_SECONDS);
    this.out.changed();
  }

  private endMatch(): void {
    this.timer.stop();
    this.status = 'ended';
    this.currentPlayerId = null;

    const seated = this.seatedPlayers();
    const best = Math.max(...seated.map((p) => p.score));
    const leaders = seated.filter((p) => p.score === best);

    this.winnerId = leaders.length === 1 ? leaders[0]!.id : null;
    this.lastWinnerId = this.winnerId;

    for (const player of seated) player.totalScore += player.score;

    this.out.matchEnded(this.publicState());
    this.out.changed();
  }

  // ── gameplay ─────────────────────────────────────────────────────────────

  reveal(playerId: string, row: number, col: number): void {
    if (this.status !== 'playing' || !this.board) {
      this.out.error(playerId, 'NOT_PLAYING', 'No match is in progress.');
      return;
    }
    if (playerId !== this.currentPlayerId) {
      this.out.error(playerId, 'NOT_YOUR_TURN', 'It is not your turn.');
      return;
    }

    const outcome = revealCell(this.board, row, col);
    if (!outcome.ok) {
      this.out.error(playerId, 'BAD_MOVE', `That slot is ${outcome.reason.replace('-', ' ')}.`);
      return;
    }

    const player = this.players.find((p) => p.id === playerId)!;
    player.score += outcome.pointsAwarded;

    const cell: RevealedCell = {
      row,
      col,
      kind: outcome.kind,
      adjacent: outcome.adjacent,
      byPlayerId: playerId,
    };
    this.revealed.push(cell);

    if (outcome.matchComplete) {
      this.out.cellRevealed(cell, this.publicState());
      this.endMatch();
      return;
    }

    this.out.cellRevealed(cell, this.publicState());

    if (outcome.keepsTurn) {
      // Spec: a bomb lets the player continue "until time runs out" — the
      // countdown deliberately keeps running. See BOMB_RESETS_TIMER.
      if (BOMB_RESETS_TIMER) {
        this.timer.start(TURN_SECONDS);
        this.out.turnChanged(playerId, TURN_SECONDS);
      }
    } else {
      this.passTurn();
    }
    this.out.changed();
  }

  private handleTimeout(): void {
    if (this.status !== 'playing') return;
    this.passTurn();
    this.out.changed();
  }

  /** Rotates to the next seated player. Works for any number of seats. */
  private passTurn(): void {
    const seated = this.seatedPlayers();
    if (seated.length < MIN_PLAYERS_TO_START) return;

    const currentIndex = seated.findIndex((p) => p.id === this.currentPlayerId);
    const next = seated[(currentIndex + 1) % seated.length]!;

    this.currentPlayerId = next.id;
    this.timer.start(TURN_SECONDS);
    this.out.turnChanged(next.id, TURN_SECONDS);
  }

  // ── rematch + reset ──────────────────────────────────────────────────────

  /**
   * Every seated player independently votes to rematch. Leaving the room is the
   * other option, and it shrinks the vote pool — so one player walking away
   * never deadlocks the rest.
   */
  voteRematch(playerId: string): void {
    if (this.status !== 'ended' || !this.isSeated(playerId)) return;

    this.rematchVotes.add(playerId);
    this.out.stateSync(this.publicState());
    this.out.changed();
    this.settleRematch();
  }

  private settleRematch(): void {
    if (this.status !== 'ended') return;

    const seated = this.seatedPlayers();
    if (seated.length < MIN_PLAYERS_TO_START) return;
    if (!seated.every((p) => this.rematchVotes.has(p.id))) return;

    this.promoteSpectators();
    this.startMatch(this.lastWinnerId ?? undefined);
  }

  /** The server console's Reset button: clears the board AND every score. */
  resetAll(): void {
    this.timer.stop();
    this.board = null;
    this.revealed = [];
    this.winnerId = null;
    this.lastWinnerId = null;
    this.currentPlayerId = null;
    this.rematchVotes.clear();
    this.status = 'waiting';

    for (const player of this.players) {
      player.score = 0;
      player.totalScore = 0;
    }
    this.promoteSpectators();

    this.out.matchReset(this.publicState());
    this.out.changed();
  }

  // ── projection ───────────────────────────────────────────────────────────

  private seatedPlayers(): Occupant[] {
    return this.orderedPlayers();
  }

  private orderedPlayers(): Occupant[] {
    return [...this.players].sort((a, b) => a.joinedAt - b.joinedAt);
  }

  private toPublic(player: Occupant): PlayerPublic {
    return {
      id: player.id,
      nickname: player.nickname,
      score: player.score,
      totalScore: player.totalScore,
      connected: player.connected,
    };
  }

  summary(): RoomSummary {
    return {
      id: this.roomId,
      name: this.roomName,
      hostNickname: this.orderedPlayers()[0]?.nickname ?? '—',
      config: this.config,
      playerCount: this.players.length,
      spectatorCount: this.spectators.length,
      status: this.status,
      createdAt: this.createdAt,
      joinable: !isRoomFull(this.config, this.players.length),
    };
  }

  /**
   * The client-safe view. Note what is absent: `board.bombs` never leaves the
   * server, so a player cannot read bomb positions out of the network traffic.
   */
  publicState(): PublicMatchState {
    return {
      roomId: this.roomId,
      roomName: this.roomName,
      hostId: this.hostId,
      config: this.config,
      status: this.status,
      rows: this.config.rows,
      cols: this.config.cols,
      bombCount: this.config.mineCount,
      bombsFound: this.revealed.filter((c) => c.kind === 'bomb').length,
      players: this.orderedPlayers().map((p) => this.toPublic(p)),
      spectatorCount: this.spectators.length,
      currentPlayerId: this.currentPlayerId,
      secondsLeft: this.timer.secondsLeft,
      revealed: [...this.revealed],
      winnerId: this.winnerId,
      rematchVotes: [...this.rematchVotes],
    };
  }
}

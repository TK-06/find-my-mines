import {
  BOMB_RESETS_TIMER,
  MIN_PLAYERS_TO_START,
  TURN_SECONDS,
  createBoard,
  createRng,
  hostModerationError,
  isRoomFull,
  joinRequestError,
  pickOne,
  rateMatch,
  revealCell,
  type Board,
  type ForfeitNotice,
  type Identity,
  type MinePosition,
  type PlayerPublic,
  type PublicMatchState,
  type RevealedCell,
  type RoomConfig,
  type RoomOrigin,
  type RoomSummary,
  type Seat,
} from '@fmm/shared';
import { contain } from '../safety.js';
import { TurnTimer } from './turnTimer.js';

interface Occupant {
  id: string;
  nickname: string;
  score: number;
  totalScore: number;
  connected: boolean;
  /** Join order. Drives host succession and spectator promotion. */
  joinedAt: number;
  /** Supabase user id, or null for a guest. Resolved from the handshake token. */
  profileId: string | null;
  isGuest: boolean;
  elo: number;
  gamesPlayed: number;
  /** Set on the seats of the match that just ended, for the result screen. */
  eloDelta?: number;
  /**
   * A spectator who may be moved into a free seat when the next match starts.
   * In an ask-to-join room only people the host let in qualify — otherwise
   * spectating and waiting would skip the host's approval.
   */
  promotable: boolean;
}

/** What the server needs in order to persist a finished match. */
export interface FinishedMatch {
  roomId: string;
  mode: RoomConfig['mode'];
  config: RoomConfig;
  winnerProfileId: string | null;
  players: {
    /** The socket that played this seat — to tell them the saved match id. Not persisted. */
    clientId: string;
    profileId: string | null;
    displayName: string;
    isGuest: boolean;
    score: number;
    placement: number;
    eloBefore: number;
    eloAfter: number;
    eloDelta: number;
    outcome: 'win' | 'loss' | 'draw';
  }[];
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
  /** The last opponent left mid-match. `result` is set when there is a rating to persist. */
  matchForfeited(notice: ForfeitNotice, result: FinishedMatch | null): void;
  /** A room-wide toast. */
  notice(message: string): void;
  error(playerId: string, code: string, message: string): void;
  /** Anything changed — refresh the lobby list and the server console. */
  changed(): void;
}

/**
 * A room ban follows an account wherever it connects from. A guest has no
 * account, so the ban holds only for that connection — logging in again as a
 * new guest gets round it, which is accepted: nothing about bans is stored.
 */
function banKey(socketId: string, profileId: string | null): string {
  return profileId ?? `socket:${socketId}`;
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

  private lastResult: FinishedMatch | null = null;

  /**
   * Who the host has banned from this room. Keyed by account id, or by
   * connection for a guest. Belongs to the room, so a new host inherits it.
   */
  private readonly roomBans = new Set<string>();

  /** Pending asks to join, oldest first. The room owns them, so a new host inherits them. */
  private joinRequests: { id: string; identity: Identity }[] = [];

  readonly createdAt = Date.now();
  private readonly timer: TurnTimer;

  constructor(
    readonly roomId: string,
    readonly roomName: string,
    readonly config: RoomConfig,
    readonly origin: RoomOrigin,
    private readonly out: MatchBroadcaster,
  ) {
    // Timer callbacks run outside any socket handler, so they contain their
    // own failures: a bug in one room's turn must not stop the server.
    const report = (error: unknown) =>
      console.error(`[room ${roomId}] turn timer callback failed:`, error);
    this.timer = new TurnTimer(
      contain((secondsLeft: number) => this.out.turnTick(secondsLeft), report),
      contain(() => this.handleTimeout(), report),
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

  /** Every member, players then spectators. */
  memberIds(): string[] {
    return [...this.players, ...this.spectators].map((o) => o.id);
  }

  // ── host moderation ──────────────────────────────────────────────────────

  /** Why this host kick or ban is refused, or null when it is allowed. */
  moderationError(actorId: string, targetId: string): string | null {
    return hostModerationError({
      origin: this.origin,
      config: this.config,
      actorId,
      hostId: this.hostId,
      targetId,
      targetInRoom: this.has(targetId),
    });
  }

  /** Stops a member rejoining. The caller removes them from the room. */
  banFromRoom(id: string): void {
    const member = [...this.players, ...this.spectators].find((o) => o.id === id);
    if (member) this.roomBans.add(banKey(member.id, member.profileId));
  }

  isBannedFromRoom(id: string, identity: Identity): boolean {
    return this.roomBans.has(banKey(id, identity.profileId));
  }

  // ── join requests ────────────────────────────────────────────────────────

  /** Asks the host for a seat. Returns why it is refused, or null once it is pending. */
  requestJoin(id: string, identity: Identity): string | null {
    const refusal = joinRequestError({
      joinByRequest: this.config.joinByRequest === true,
      alreadyMember: this.has(id),
      alreadyRequested: this.joinRequests.some((r) => r.id === id),
      banned: this.isBannedFromRoom(id, identity),
      full: isRoomFull(this.config, this.players.length),
    });
    if (refusal) return refusal;

    this.joinRequests.push({ id, identity });
    this.out.stateSync(this.publicState());
    this.out.changed();
    return null;
  }

  /** Drops a pending request. True when there was one. */
  withdrawRequest(id: string): boolean {
    const before = this.joinRequests.length;
    this.joinRequests = this.joinRequests.filter((r) => r.id !== id);
    if (this.joinRequests.length === before) return false;

    this.out.stateSync(this.publicState());
    this.out.changed();
    return true;
  }

  /**
   * Host only. Removes a pending request and hands back who asked, so the
   * caller can seat them or turn them away.
   */
  takeRequest(actorId: string, requesterId: string): { identity: Identity } | { error: string } {
    if (actorId !== this.hostId) return { error: 'Only the host can answer join requests.' };

    const request = this.joinRequests.find((r) => r.id === requesterId);
    if (!request) return { error: 'That request is no longer pending.' };

    this.joinRequests = this.joinRequests.filter((r) => r.id !== requesterId);
    this.out.stateSync(this.publicState());
    this.out.changed();
    return { identity: request.identity };
  }

  /**
   * Seats a client if there is room and no match is running.
   *
   * Joining mid-match makes them a spectator: dropping a new player into a
   * live turn rotation would be unfair to everyone already playing. They are
   * promoted automatically when the match ends.
   */
  addPlayer(id: string, identity: Identity): Seat {
    // They asked for a seat, so they are first in line for one.
    const occupant = this.newOccupant(id, identity, true);

    if (isRoomFull(this.config, this.players.length) || this.status === 'playing') {
      this.spectators.push(occupant);
      this.out.changed();
      return 'spectator';
    }

    this.players.push(occupant);
    this.out.changed();
    return 'player';
  }

  addSpectator(id: string, identity: Identity): Seat {
    // In an open room anyone watching may take a free seat later. In an
    // ask-to-join room that would skip the host, so only players they let in
    // (via addPlayer) are promoted.
    const promotable = this.config.joinByRequest !== true;
    this.spectators.push(this.newOccupant(id, identity, promotable));
    this.out.changed();
    return 'spectator';
  }

  private newOccupant(id: string, identity: Identity, promotable: boolean): Occupant {
    return {
      id,
      nickname: identity.nickname,
      score: 0,
      totalScore: 0,
      connected: true,
      joinedAt: this.seq++,
      profileId: identity.profileId,
      isGuest: identity.isGuest,
      elo: identity.elo,
      gamesPlayed: identity.gamesPlayed,
      promotable,
    };
  }

  /**
   * A seated player's connection dropped. Their seat, score and turn are held;
   * the turn clock keeps running, so a long absence just costs them turns.
   */
  markDisconnected(id: string): void {
    const player = this.players.find((p) => p.id === id);
    if (!player) return;
    player.connected = false;
    this.out.notice(`${player.nickname} disconnected. Holding their seat…`);
    this.out.stateSync(this.publicState());
    this.out.changed();
  }

  /**
   * Hands a held seat to the player's new connection. Every reference to the
   * old socket id moves with it, so turn, votes and history carry over.
   */
  rebind(oldId: string, newId: string): boolean {
    const player = this.players.find((p) => p.id === oldId);
    if (!player) return false;

    player.id = newId;
    player.connected = true;
    if (this.currentPlayerId === oldId) this.currentPlayerId = newId;
    if (this.winnerId === oldId) this.winnerId = newId;
    if (this.lastWinnerId === oldId) this.lastWinnerId = newId;
    if (this.rematchVotes.delete(oldId)) this.rematchVotes.add(newId);
    for (const cell of this.revealed) {
      if (cell.byPlayerId === oldId) cell.byPlayerId = newId;
    }

    this.out.notice(`${player.nickname} is back.`);
    this.out.stateSync(this.publicState());
    this.out.changed();
    return true;
  }

  /** Removes a member. Returns true when the room is now empty and should close. */
  remove(id: string): boolean {
    const leaver = this.players.find((p) => p.id === id);
    const wasSeated = leaver !== undefined;
    const wasCurrent = this.currentPlayerId === id;

    this.players = this.players.filter((p) => p.id !== id);
    this.spectators = this.spectators.filter((s) => s.id !== id);
    this.rematchVotes.delete(id);

    if (this.isEmpty) {
      this.timer.stop();
      return true;
    }

    const tooFew = this.seatedPlayers().length < MIN_PLAYERS_TO_START;

    if (leaver && this.status === 'playing') {
      if (tooFew) {
        // The last opponent walked out: whoever is left wins by forfeit.
        this.forfeitMatch(leaver);
      } else if (wasCurrent) {
        // The player on turn walked away — hand the turn on rather than stall.
        this.passTurn();
      }
    } else if (leaver && this.status === 'ended' && tooFew) {
      // Nobody is left to rematch, so the result screen has nothing to wait
      // for. Back to waiting, and tell whoever is still here why.
      this.abandonMatch();
      this.out.notice(`${leaver.nickname} left the room.`);
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

  /**
   * Ends the match in favour of the one player still seated. The leaver takes
   * the loss (and, in ranked, the rating hit), and the winner starts the next
   * match. The room returns to waiting for a new opponent. Being kicked or
   * banned mid-match counts the same as leaving.
   */
  private forfeitMatch(leaver: Occupant): void {
    const winner = this.seatedPlayers()[0];
    if (!winner) {
      this.abandonMatch();
      return;
    }

    this.timer.stop();
    winner.totalScore += winner.score;
    this.winnerId = winner.id;
    this.lastWinnerId = winner.id;
    this.applyRatings([winner, leaver], winner.id);

    const notice: ForfeitNotice = {
      roomId: this.roomId,
      winnerId: winner.id,
      winnerNickname: winner.nickname,
      leaverNickname: leaver.nickname,
      players: [winner, leaver].map((p) => ({
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        eloDelta: p.eloDelta,
      })),
    };
    const result = this.takeResult();

    this.abandonMatch();
    this.out.matchForfeited(notice, result);
  }

  /** Fills free seats from the spectators who may take one, oldest first. */
  private promoteSpectators(): void {
    while (!isRoomFull(this.config, this.players.length)) {
      const index = this.spectators.findIndex((s) => s.promotable);
      if (index < 0) break;
      const [next] = this.spectators.splice(index, 1);
      this.players.push(next!);
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
    for (const player of this.players) {
      player.score = 0;
      player.eloDelta = undefined;
    }
    this.lastResult = null;

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

    this.applyRatings(seated);

    this.out.matchEnded(this.publicState());
    this.out.changed();
  }

  /**
   * Rates the finished match and stashes the result for the server to persist.
   *
   * Ratings are applied in memory here so the result screen can show the change
   * immediately; writing them to Supabase is the server's job and may fail
   * without breaking the game.
   */
  private applyRatings(seated: Occupant[], forfeitWinnerId?: string): void {
    this.lastResult = null;
    if (seated.length < MIN_PLAYERS_TO_START) return;

    const ranked = this.config.mode === 'ranked';
    const results = rateMatch(
      seated.map((p) => ({
        id: p.id,
        rating: p.elo,
        gamesPlayed: p.gamesPlayed,
        // A forfeit is decided by who stayed, not by mines found so far.
        score: forfeitWinnerId ? (p.id === forfeitWinnerId ? 1 : 0) : p.score,
        isGuest: p.isGuest,
      })),
      ranked,
    );

    const byId = new Map(results.map((r) => [r.id, r]));

    for (const player of seated) {
      const result = byId.get(player.id)!;
      player.eloDelta = result.delta;
      player.elo = result.ratingAfter;
      if (ranked && !player.isGuest) player.gamesPlayed += 1;
    }

    this.lastResult = {
      roomId: this.roomId,
      mode: this.config.mode,
      config: this.config,
      winnerProfileId: seated.find((p) => p.id === this.winnerId)?.profileId ?? null,
      players: seated.map((player) => {
        const result = byId.get(player.id)!;
        return {
          clientId: player.id,
          profileId: player.profileId,
          displayName: player.nickname,
          isGuest: player.isGuest,
          score: player.score,
          placement: result.placement,
          eloBefore: result.ratingBefore,
          eloAfter: result.ratingAfter,
          eloDelta: result.delta,
          outcome: result.outcome,
        };
      }),
    };
  }

  /** The match that just finished, or null. Cleared when the next one starts. */
  takeResult(): FinishedMatch | null {
    const result = this.lastResult;
    this.lastResult = null;
    return result;
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

  /** Stops the turn timer for good. Used when an admin ends the room. */
  shutdown(): void {
    this.timer.stop();
  }

  /**
   * Where the mines are, or null before a board exists.
   *
   * The ONLY way mine positions leave this class. Called solely by the admin
   * namespace, for a verified admin who turned the mine toggle on — never by
   * anything that talks to game clients.
   */
  minePositions(): MinePosition[] | null {
    if (!this.board) return null;
    const mines: MinePosition[] = [];
    for (let row = 0; row < this.board.rows; row++) {
      for (let col = 0; col < this.board.cols; col++) {
        if (this.board.bombs[row]![col]) mines.push({ row, col });
      }
    }
    return mines;
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
      elo: player.elo,
      isGuest: player.isGuest,
      eloDelta: player.eloDelta,
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
      origin: this.origin,
      status: this.status,
      rows: this.config.rows,
      cols: this.config.cols,
      bombCount: this.config.mineCount,
      bombsFound: this.revealed.filter((c) => c.kind === 'bomb').length,
      players: this.orderedPlayers().map((p) => this.toPublic(p)),
      spectatorCount: this.spectators.length,
      spectators: this.spectators.map(({ id, nickname }) => ({ id, nickname })),
      joinRequests: this.joinRequests.map(({ id, identity }) => ({
        id,
        nickname: identity.nickname,
        isGuest: identity.isGuest,
      })),
      currentPlayerId: this.currentPlayerId,
      secondsLeft: this.timer.secondsLeft,
      revealed: [...this.revealed],
      winnerId: this.winnerId,
      rematchVotes: [...this.rematchVotes],
    };
  }
}

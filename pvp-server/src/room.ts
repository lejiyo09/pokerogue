import type { WebSocket } from "ws";
import type { PvpMode, PvpPartyMemberDto, ServerMessage, TurnCommandDto } from "./protocol.js";
import { ENEMY_BATTLER_INDEX } from "./protocol.js";

export type SeatIndex = 0 | 1;

/**
 * A room's lifecycle: team selection (initial state) -> in_battle (once both seats have
 * submitted a team and readied up) -> ended (forfeit, or a seat disconnecting mid-battle).
 * Never moves backward. See docs/pvp-online-battle-design.md, O1 fix notes.
 */
export type RoomStatus = "team_select" | "in_battle" | "ended";

/** Outcome of a single {@linkcode Room.submitCommand} call - see O2 fix notes below. */
export type SubmitCommandResult = "ok" | "already_submitted" | "stale_turn" | "future_turn";

interface Seat {
  socket: WebSocket;
  team: PvpPartyMemberDto[] | null;
  ready: boolean;
}

/** Commands submitted so far for a single turn, one slot per seat. */
type PendingTurn = [TurnCommandDto | null, TurnCommandDto | null];

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

/**
 * A single PvP match: two seats, their submitted teams, and the turn-by-turn command exchange.
 *
 * Holds no knowledge of the actual battle engine (moves, damage, etc.) - it only knows how to
 * pair up two clients' commands for the same turn and never reveal one seat's command to the
 * other until both have submitted (see docs/pvp-online-battle-design.md §5.2, "commit-reveal").
 */
export class Room {
  public readonly id: string;
  public readonly mode: PvpMode;

  private readonly seats: [Seat | null, Seat | null] = [null, null];
  private readonly pendingTurns = new Map<number, PendingTurn>();
  private status: RoomStatus = "team_select";

  /**
   * The turn number the room is currently waiting to complete. Mirrors what both clients'
   * `Battle.turn` is expected to be at this point (both start a PvP match at turn 1, and only
   * ever advance to the next turn once they've received the *previous* turn's `TURN_READY` - see
   * `RemoteCommandWaitPhase`) - so this only ever advances by exactly 1, and only once both seats
   * have submitted their command for it. See O2 fix notes.
   */
  private currentTurn = 1;

  constructor(id: string, mode: PvpMode) {
    this.id = id;
    this.mode = mode;
  }

  public get double(): boolean {
    return this.mode === "double";
  }

  public getStatus(): RoomStatus {
    return this.status;
  }

  public isFull(): boolean {
    return this.seats[0] !== null && this.seats[1] !== null;
  }

  public isEmpty(): boolean {
    return this.seats[0] === null && this.seats[1] === null;
  }

  /** Whether a new connection may still join a (non-existent) empty seat. */
  public canJoin(): boolean {
    return this.status === "team_select";
  }

  /** Whether a seat may currently (re)submit a team or READY up. */
  public canSubmitTeam(): boolean {
    return this.status === "team_select";
  }

  /** Whether a seat may currently submit a turn command. */
  public canSubmitCommand(): boolean {
    return this.status === "in_battle";
  }

  /** Seat a new connection. @returns The seat index, or `null` if the room is already full. */
  public addSeat(socket: WebSocket): SeatIndex | null {
    if (!this.seats[0]) {
      this.seats[0] = { socket, team: null, ready: false };
      return 0;
    }
    if (!this.seats[1]) {
      this.seats[1] = { socket, team: null, ready: false };
      return 1;
    }
    return null;
  }

  /** @returns The seat index occupied by `socket`, or `null` if it isn't in this room. */
  public seatOf(socket: WebSocket): SeatIndex | null {
    if (this.seats[0]?.socket === socket) {
      return 0;
    }
    if (this.seats[1]?.socket === socket) {
      return 1;
    }
    return null;
  }

  /** Remove whichever seat `socket` occupies. @returns The vacated seat index, if any. */
  public removeSeat(socket: WebSocket): SeatIndex | null {
    const seat = this.seatOf(socket);
    if (seat !== null) {
      this.seats[seat] = null;
    }
    return seat;
  }

  public setTeam(seat: SeatIndex, team: PvpPartyMemberDto[]): void {
    const s = this.seats[seat];
    if (s) {
      s.team = team;
    }
  }

  public setReady(seat: SeatIndex): void {
    const s = this.seats[seat];
    if (s) {
      s.ready = true;
    }
  }

  /** @returns Whether both seats have submitted a team and readied up. */
  public bothReady(): boolean {
    return this.seats.every(s => s?.ready && s.team !== null);
  }

  /**
   * Attempt to transition `team_select` -> `in_battle`. Only succeeds once, the first time both
   * seats are ready - a resent `READY` (or any other call) after that is a no-op that returns
   * `false`, so the caller must never re-run battle-start side effects (e.g. re-generating a
   * battle seed) on a room that has already started. See O1 fix notes.
   */
  public tryBeginBattle(): boolean {
    if (this.status !== "team_select" || !this.bothReady()) {
      return false;
    }
    this.status = "in_battle";
    this.currentTurn = 1;
    return true;
  }

  /** Mark the room as ended (forfeit, or a seat disconnecting mid-battle). Idempotent. */
  public end(): void {
    this.status = "ended";
  }

  /**
   * Record `seat`'s command for `turn`. If this completes the pair (the other seat has already
   * submitted for the same turn), sends each seat a `TURN_READY` containing only the *other*
   * seat's command, clears the buffered entry, and advances {@linkcode currentTurn}.
   *
   * The server never trusts `turn` at face value (see O2 fix notes):
   * - `turn` older than {@linkcode currentTurn}: that turn has already completed - rejected as
   *   `"stale_turn"` without touching `pendingTurns`.
   * - `turn` newer than {@linkcode currentTurn}: the room hasn't advanced that far yet (this can
   *   only happen from a buggy or malicious client, since a well-behaved client only submits its
   *   next turn's command after receiving this turn's `TURN_READY`) - rejected as `"future_turn"`.
   * - a seat resubmitting for the *same* `turn` it already has a pending command for: rejected as
   *   `"already_submitted"` - the original command is never silently overwritten.
   */
  public submitCommand(seat: SeatIndex, turn: number, command: TurnCommandDto): SubmitCommandResult {
    if (turn < this.currentTurn) {
      return "stale_turn";
    }
    if (turn > this.currentTurn) {
      return "future_turn";
    }

    const other: SeatIndex = seat === 0 ? 1 : 0;
    const pending: PendingTurn = this.pendingTurns.get(turn) ?? [null, null];
    if (pending[seat] !== null) {
      return "already_submitted";
    }
    pending[seat] = command;
    this.pendingTurns.set(turn, pending);

    const otherCommand = pending[other];
    if (!otherCommand) {
      // Still waiting on the other seat - do NOT reveal this seat's command yet.
      return "ok";
    }

    const seatSocket = this.seats[seat]?.socket;
    const otherSocket = this.seats[other]?.socket;
    if (seatSocket) {
      send(seatSocket, { type: "TURN_READY", turn, commands: { [ENEMY_BATTLER_INDEX]: otherCommand } });
    }
    if (otherSocket) {
      send(otherSocket, { type: "TURN_READY", turn, commands: { [ENEMY_BATTLER_INDEX]: command } });
    }
    this.pendingTurns.delete(turn);
    this.currentTurn++;
    return "ok";
  }

  public getCurrentTurn(): number {
    return this.currentTurn;
  }

  public getTeam(seat: SeatIndex): PvpPartyMemberDto[] | null {
    return this.seats[seat]?.team ?? null;
  }

  public getSocket(seat: SeatIndex): WebSocket | null {
    return this.seats[seat]?.socket ?? null;
  }

  public sendTo(seat: SeatIndex, message: ServerMessage): void {
    const socket = this.getSocket(seat);
    if (socket) {
      send(socket, message);
    }
  }

  public broadcast(message: ServerMessage): void {
    this.sendTo(0, message);
    this.sendTo(1, message);
  }
}

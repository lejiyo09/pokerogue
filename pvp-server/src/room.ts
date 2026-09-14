import type { WebSocket } from "ws";
import type { PvpMode, PvpPartyMemberDto, ServerMessage, TurnCommandDto } from "./protocol.js";
import { ENEMY_BATTLER_INDEX } from "./protocol.js";

export type SeatIndex = 0 | 1;

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

  constructor(id: string, mode: PvpMode) {
    this.id = id;
    this.mode = mode;
  }

  public get double(): boolean {
    return this.mode === "double";
  }

  public isFull(): boolean {
    return this.seats[0] !== null && this.seats[1] !== null;
  }

  public isEmpty(): boolean {
    return this.seats[0] === null && this.seats[1] === null;
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
   * Record `seat`'s command for `turn`. If this completes the pair (the other seat has already
   * submitted for the same turn), sends each seat a `TURN_READY` containing only the *other*
   * seat's command, and clears the buffered entry.
   */
  public submitCommand(seat: SeatIndex, turn: number, command: TurnCommandDto): void {
    const other: SeatIndex = seat === 0 ? 1 : 0;
    const pending: PendingTurn = this.pendingTurns.get(turn) ?? [null, null];
    pending[seat] = command;
    this.pendingTurns.set(turn, pending);

    const otherCommand = pending[other];
    if (!otherCommand) {
      // Still waiting on the other seat - do NOT reveal this seat's command yet.
      return;
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

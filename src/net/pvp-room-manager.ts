import type { BattlerIndex } from "#enums/battler-index";
import { BattleSocketClient } from "#net/battle-socket-client";
import type {
  BattleEndMessage,
  BattleStartMessage,
  OpponentDisconnectedMessage,
  PvpMode,
  PvpPartyMemberDto,
  RoomFullMessage,
  TurnCommandDto,
  TurnReadyMessage,
} from "#net/pvp-protocol-types";

/** High-level state of a client's participation in a PvP match. */
export type PvpRoomState =
  | "idle"
  | "connecting"
  | "waiting_for_opponent"
  | "team_select"
  | "waiting_for_ready"
  | "in_battle"
  | "ended";

interface PendingTurnWaiter {
  battlerIndex: BattlerIndex;
  resolve: (dto: TurnCommandDto) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

/**
 * Client-side orchestrator for a single PvP room/match, built on top of {@linkcode BattleSocketClient}.
 *
 * Owns room lifecycle (create/join/team-select/ready) and turn command exchange, and is the
 * object {@linkcode RemoteCommandWaitPhase} asks for the remote player's command each turn.
 * @see docs/pvp-online-battle-design.md §6, §9.1, §9.3
 */
export class PvpRoomManager {
  /**
   * How long {@linkcode waitForTurnCommand} will wait for the opponent's command before giving up
   * and rejecting - see R4 fix notes (docs/pvp-online-battle-design.md). Generous by design: a
   * human opponent taking their time to pick a move is normal, not a bug - this only exists to
   * guarantee a *hung connection* can never leave `RemoteCommandWaitPhase` waiting forever.
   */
  public static readonly DEFAULT_TURN_TIMEOUT_MS = 5 * 60 * 1000;

  private readonly socket: BattleSocketClient;
  private readonly turnTimeoutMs: number;
  private state: PvpRoomState = "idle";
  private roomId: string | null = null;

  /** Turn commands already broadcast by the server, keyed by turn number. */
  private readonly receivedTurns = new Map<number, Partial<Record<BattlerIndex, TurnCommandDto>>>();
  /** Callers currently awaiting a not-yet-received turn's command, keyed by turn number. */
  private readonly turnWaiters = new Map<number, PendingTurnWaiter[]>();

  constructor(
    socket: BattleSocketClient = new BattleSocketClient(),
    turnTimeoutMs = PvpRoomManager.DEFAULT_TURN_TIMEOUT_MS,
  ) {
    this.socket = socket;
    this.turnTimeoutMs = turnTimeoutMs;
    this.socket.on("TURN_READY", message => this.handleTurnReady(message));
    // Guarantee every pending `waitForTurnCommand` promise settles - never hangs forever - the
    // moment the connection to the opponent is known to be gone (R4 fix notes).
    this.socket.on("DISCONNECT", () => this.rejectAllWaiters(new Error("The opponent disconnected")));
    this.socket.on("BATTLE_END", () => this.rejectAllWaiters(new Error("The battle has ended")));
  }

  public getState(): PvpRoomState {
    return this.state;
  }

  public getRoomId(): string | null {
    return this.roomId;
  }

  /** Connect to the server and create a new room, resolving with its room code. */
  public async createRoom(mode: PvpMode): Promise<string> {
    this.state = "connecting";
    await this.socket.connect();

    return new Promise((resolve, reject) => {
      const onCreated = (message: { type: "ROOM_CREATED"; roomId: string }) => {
        this.roomId = message.roomId;
        this.state = "waiting_for_opponent";
        this.socket.off("ROOM_CREATED", onCreated);
        this.socket.off("ERROR", onError);
        resolve(message.roomId);
      };
      const onError = (message: { type: "ERROR"; message: string }) => {
        this.socket.off("ROOM_CREATED", onCreated);
        this.socket.off("ERROR", onError);
        reject(new Error(message.message));
      };
      this.socket.on("ROOM_CREATED", onCreated);
      this.socket.on("ERROR", onError);
      this.socket.send({ type: "CREATE_ROOM", mode });
    });
  }

  /** Connect to the server and join an existing room by its room code. */
  public async joinRoom(roomId: string): Promise<void> {
    this.state = "connecting";
    await this.socket.connect();

    return new Promise((resolve, reject) => {
      const onJoined = (message: { type: "ROOM_JOINED"; roomId: string }) => {
        this.roomId = message.roomId;
        this.state = "waiting_for_opponent";
        this.socket.off("ROOM_JOINED", onJoined);
        this.socket.off("ERROR", onError);
        resolve();
      };
      const onError = (message: { type: "ERROR"; message: string }) => {
        this.socket.off("ROOM_JOINED", onJoined);
        this.socket.off("ERROR", onError);
        reject(new Error(message.message));
      };
      this.socket.on("ROOM_JOINED", onJoined);
      this.socket.on("ERROR", onError);
      this.socket.send({ type: "JOIN_ROOM", roomId });
    });
  }

  /** Submit this player's PvP team. */
  public submitTeam(pokemon: PvpPartyMemberDto[]): void {
    this.socket.send({ type: "SUBMIT_TEAM", roomId: this.assertRoomId(), pokemon });
    this.state = "waiting_for_ready";
  }

  /** Signal that this player is ready to start the battle. */
  public ready(): void {
    this.socket.send({ type: "READY", roomId: this.assertRoomId() });
  }

  /** Leave/cancel the current room and close the connection. */
  public leave(): void {
    if (this.roomId) {
      try {
        this.socket.send({ type: "LEAVE_ROOM", roomId: this.roomId });
      } catch {
        // Socket may already be closed; nothing more to do.
      }
    }
    this.socket.disconnect();
    this.state = "idle";
    this.roomId = null;
    this.receivedTurns.clear();
    this.rejectAllWaiters(new Error("Left the PvP session"));
  }

  /** Register a listener invoked once every seat in the room is filled and team selection can begin. */
  public onRoomReady(listener: (message: RoomFullMessage) => void): void {
    this.socket.on("ROOM_FULL", message => {
      this.state = "team_select";
      listener(message);
    });
  }

  /** Register a listener invoked once when the battle is ready to begin. */
  public onBattleStart(listener: (message: BattleStartMessage) => void): void {
    this.socket.on("BATTLE_START", message => {
      this.state = "in_battle";
      listener(message);
    });
  }

  /** Register a listener invoked once when the battle concludes. */
  public onBattleEnd(listener: (message: BattleEndMessage) => void): void {
    this.socket.on("BATTLE_END", message => {
      this.state = "ended";
      listener(message);
    });
  }

  /** Register a listener invoked whenever the opponent's connection drops. */
  public onOpponentDisconnected(listener: (message: OpponentDisconnectedMessage) => void): void {
    this.socket.on("DISCONNECT", listener);
  }

  /**
   * Submit this turn's finalized command for `fieldIndex` (0, or 1 in double battles) - relative
   * to this client's own side, per {@linkcode SubmitCommandMessage}.
   */
  public sendTurnCommand(turn: number, fieldIndex: number, command: TurnCommandDto): void {
    this.socket.send({ type: "SUBMIT_COMMAND", roomId: this.assertRoomId(), turn, fieldIndex, command });
  }

  /** Report this turn's resulting battle state hash for server-side cross-client verification. */
  public sendStateHash(turn: number, hash: string): void {
    this.socket.send({ type: "STATE_HASH", roomId: this.assertRoomId(), turn, hash });
  }

  /** Forfeit the current match. */
  public forfeit(): void {
    this.socket.send({ type: "FORFEIT", roomId: this.assertRoomId() });
  }

  /**
   * Wait for the server to broadcast `turn`'s commands, then resolve with the one addressed to
   * `battlerIndex`. Used by `RemoteCommandWaitPhase` in place of the AI decision normally made
   * by `EnemyCommandPhase`.
   *
   * Safe to call either before or after the corresponding `TURN_READY` message has arrived.
   *
   * The returned promise is *guaranteed* to eventually settle - never hang forever - even if the
   * opponent's command never arrives: it rejects on a {@linkcode turnTimeoutMs} timeout, on the
   * opponent disconnecting, on the battle ending, or on {@linkcode leave} being called (see R4 fix
   * notes, docs/pvp-online-battle-design.md).
   */
  public waitForTurnCommand(turn: number, battlerIndex: BattlerIndex): Promise<TurnCommandDto> {
    const buffered = this.receivedTurns.get(turn)?.[battlerIndex];
    if (buffered) {
      return Promise.resolve(buffered);
    }

    return new Promise((resolve, reject) => {
      const waiter: PendingTurnWaiter = {
        battlerIndex,
        resolve,
        reject,
        timeoutHandle: setTimeout(() => {
          this.removeWaiter(turn, waiter);
          reject(new Error(`Timed out waiting for the opponent's turn ${turn} command`));
        }, this.turnTimeoutMs),
      };
      const waiters = this.turnWaiters.get(turn) ?? [];
      waiters.push(waiter);
      this.turnWaiters.set(turn, waiters);
    });
  }

  private removeWaiter(turn: number, waiter: PendingTurnWaiter): void {
    const waiters = this.turnWaiters.get(turn);
    if (!waiters) {
      return;
    }
    const remaining = waiters.filter(w => w !== waiter);
    if (remaining.length > 0) {
      this.turnWaiters.set(turn, remaining);
    } else {
      this.turnWaiters.delete(turn);
    }
  }

  /** Reject every currently-pending {@linkcode waitForTurnCommand} call with `error`. */
  private rejectAllWaiters(error: Error): void {
    for (const waiters of this.turnWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeoutHandle);
        waiter.reject(error);
      }
    }
    this.turnWaiters.clear();
  }

  private handleTurnReady(message: TurnReadyMessage): void {
    this.receivedTurns.set(message.turn, message.commands);
    // Bound memory use - only the immediately preceding turn is ever worth keeping around.
    this.receivedTurns.delete(message.turn - 2);

    const waiters = this.turnWaiters.get(message.turn);
    if (!waiters) {
      return;
    }
    const stillPending: PendingTurnWaiter[] = [];
    for (const waiter of waiters) {
      const dto = message.commands[waiter.battlerIndex];
      if (dto) {
        clearTimeout(waiter.timeoutHandle);
        waiter.resolve(dto);
      } else {
        stillPending.push(waiter);
      }
    }
    if (stillPending.length > 0) {
      this.turnWaiters.set(message.turn, stillPending);
    } else {
      this.turnWaiters.delete(message.turn);
    }
  }

  private assertRoomId(): string {
    if (!this.roomId) {
      throw new Error("Not currently in a PvP room");
    }
    return this.roomId;
  }
}

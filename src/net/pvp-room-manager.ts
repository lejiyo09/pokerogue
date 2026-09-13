import type { BattlerIndex } from "#enums/battler-index";
import type { MoveId } from "#enums/move-id";
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
}

/**
 * Client-side orchestrator for a single PvP room/match, built on top of {@linkcode BattleSocketClient}.
 *
 * Owns room lifecycle (create/join/team-select/ready) and turn command exchange, and is the
 * object {@linkcode RemoteCommandWaitPhase} asks for the remote player's command each turn.
 * @see docs/pvp-online-battle-design.md §6, §9.1, §9.3
 */
export class PvpRoomManager {
  private readonly socket: BattleSocketClient;
  private state: PvpRoomState = "idle";
  private roomId: string | null = null;
  private yourBattlerIndex: BattlerIndex | null = null;

  /** Turn commands already broadcast by the server, keyed by turn number. */
  private readonly receivedTurns = new Map<number, Partial<Record<BattlerIndex, TurnCommandDto>>>();
  /** Callers currently awaiting a not-yet-received turn's command, keyed by turn number. */
  private readonly turnWaiters = new Map<number, PendingTurnWaiter[]>();

  constructor(socket: BattleSocketClient = new BattleSocketClient()) {
    this.socket = socket;
    this.socket.on("TURN_READY", message => this.handleTurnReady(message));
  }

  public getState(): PvpRoomState {
    return this.state;
  }

  public getRoomId(): string | null {
    return this.roomId;
  }

  public getYourBattlerIndex(): BattlerIndex | null {
    return this.yourBattlerIndex;
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
      const onJoined = (message: { type: "ROOM_JOINED"; roomId: string; yourBattlerIndex: BattlerIndex }) => {
        this.roomId = message.roomId;
        this.yourBattlerIndex = message.yourBattlerIndex;
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
    this.turnWaiters.clear();
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
      this.yourBattlerIndex = message.yourBattlerIndex;
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

  /** Submit this turn's move command for `fieldIndex` (0, or 1 in double battles). */
  public sendMove(turn: number, fieldIndex: number, moveId: MoveId, targets: BattlerIndex[]): void {
    this.socket.send({ type: "SELECT_MOVE", roomId: this.assertRoomId(), turn, fieldIndex, moveId, targets });
  }

  /** Submit this turn's switch command for `fieldIndex`. */
  public sendSwitch(turn: number, fieldIndex: number, partyIndex: number): void {
    this.socket.send({ type: "SELECT_SWITCH", roomId: this.assertRoomId(), turn, fieldIndex, partyIndex });
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
   */
  public waitForTurnCommand(turn: number, battlerIndex: BattlerIndex): Promise<TurnCommandDto> {
    const buffered = this.receivedTurns.get(turn)?.[battlerIndex];
    if (buffered) {
      return Promise.resolve(buffered);
    }

    return new Promise(resolve => {
      const waiters = this.turnWaiters.get(turn) ?? [];
      waiters.push({ battlerIndex, resolve });
      this.turnWaiters.set(turn, waiters);
    });
  }

  private handleTurnReady(message: TurnReadyMessage): void {
    this.receivedTurns.set(message.turn, message.commands);
    // Bound memory use - only the immediately preceding turn is ever worth keeping around.
    this.receivedTurns.delete(message.turn - 2);

    const waiters = this.turnWaiters.get(message.turn);
    if (!waiters) {
      return;
    }
    for (const waiter of waiters) {
      const dto = message.commands[waiter.battlerIndex];
      if (dto) {
        waiter.resolve(dto);
      }
    }
    this.turnWaiters.delete(message.turn);
  }

  private assertRoomId(): string {
    if (!this.roomId) {
      throw new Error("Not currently in a PvP room");
    }
    return this.roomId;
  }
}

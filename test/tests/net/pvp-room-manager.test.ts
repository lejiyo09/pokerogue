import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import type { BattleSocketClient } from "#net/battle-socket-client";
import type { PvpClientMessage, PvpServerMessage, TurnCommandDto } from "#net/pvp-protocol-types";
import { PvpRoomManager } from "#net/pvp-room-manager";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ServerMessageType = PvpServerMessage["type"];
type Listener = (message: PvpServerMessage) => void;

/**
 * A minimal fake standing in for {@linkcode BattleSocketClient}, so `PvpRoomManager`'s turn-wait
 * logic (R4 fix) can be tested without a real WebSocket connection.
 */
class FakeBattleSocketClient {
  public readonly sent: PvpClientMessage[] = [];
  private readonly listeners: Partial<Record<ServerMessageType, Set<Listener>>> = {};

  connect(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): void {}

  send(message: PvpClientMessage): void {
    this.sent.push(message);
  }

  on(type: ServerMessageType, listener: Listener): void {
    let set = this.listeners[type];
    if (!set) {
      set = new Set();
      this.listeners[type] = set;
    }
    set.add(listener);
  }

  off(type: ServerMessageType, listener: Listener): void {
    this.listeners[type]?.delete(listener);
  }

  /** Simulate the server broadcasting `message` to this client. */
  emit(message: PvpServerMessage): void {
    for (const listener of this.listeners[message.type] ?? []) {
      listener(message);
    }
  }
}

const SOME_COMMAND: TurnCommandDto = { command: Command.FIGHT, cursor: 0 };

describe("PvpRoomManager.waitForTurnCommand (R4)", () => {
  let socket: FakeBattleSocketClient;
  let session: PvpRoomManager;

  beforeEach(() => {
    socket = new FakeBattleSocketClient();
    // A short timeout so the timeout test doesn't need to fake-advance a real 5 minutes.
    session = new PvpRoomManager(socket as unknown as BattleSocketClient, 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves once the server broadcasts TURN_READY for that turn", async () => {
    const promise = session.waitForTurnCommand(1, BattlerIndex.ENEMY);
    socket.emit({ type: "TURN_READY", turn: 1, commands: { [BattlerIndex.ENEMY]: SOME_COMMAND } });
    await expect(promise).resolves.toEqual(SOME_COMMAND);
  });

  it("resolves immediately if the turn's command was already broadcast before waiting started", async () => {
    socket.emit({ type: "TURN_READY", turn: 1, commands: { [BattlerIndex.ENEMY]: SOME_COMMAND } });
    await expect(session.waitForTurnCommand(1, BattlerIndex.ENEMY)).resolves.toEqual(SOME_COMMAND);
  });

  it("rejects (never hangs forever) when the opponent disconnects mid-wait", async () => {
    const promise = session.waitForTurnCommand(1, BattlerIndex.ENEMY);
    socket.emit({ type: "DISCONNECT", graceSeconds: 0 });
    await expect(promise).rejects.toThrow();
  });

  it("rejects when the battle ends while still waiting", async () => {
    const promise = session.waitForTurnCommand(1, BattlerIndex.ENEMY);
    socket.emit({ type: "BATTLE_END", reason: "forfeit" });
    await expect(promise).rejects.toThrow();
  });

  it("rejects on timeout if neither a TURN_READY nor a disconnect ever arrives", async () => {
    vi.useFakeTimers();
    const promise = session.waitForTurnCommand(1, BattlerIndex.ENEMY);
    const assertion = expect(promise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("does not reject an already-resolved wait when a later disconnect occurs", async () => {
    const promise = session.waitForTurnCommand(1, BattlerIndex.ENEMY);
    socket.emit({ type: "TURN_READY", turn: 1, commands: { [BattlerIndex.ENEMY]: SOME_COMMAND } });
    await expect(promise).resolves.toEqual(SOME_COMMAND);
    // Must not throw an unhandled rejection or otherwise misbehave now that there's nothing left waiting.
    expect(() => socket.emit({ type: "DISCONNECT", graceSeconds: 0 })).not.toThrow();
  });

  it("rejects every still-pending turn wait when leave() is called", async () => {
    const promiseA = session.waitForTurnCommand(1, BattlerIndex.ENEMY);
    const promiseB = session.waitForTurnCommand(2, BattlerIndex.ENEMY);
    session.leave();
    await expect(promiseA).rejects.toThrow();
    await expect(promiseB).rejects.toThrow();
  });

  it("only rejects waiters for the disconnect that actually occurred, not ones resolved earlier for other turns", async () => {
    const turn1 = session.waitForTurnCommand(1, BattlerIndex.ENEMY);
    socket.emit({ type: "TURN_READY", turn: 1, commands: { [BattlerIndex.ENEMY]: SOME_COMMAND } });
    await expect(turn1).resolves.toEqual(SOME_COMMAND);

    const turn2 = session.waitForTurnCommand(2, BattlerIndex.ENEMY);
    socket.emit({ type: "DISCONNECT", graceSeconds: 0 });
    await expect(turn2).rejects.toThrow();
  });
});

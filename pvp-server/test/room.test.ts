import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerMessage, TurnCommandDto } from "../src/protocol.js";
import { ENEMY_BATTLER_INDEX } from "../src/protocol.js";
import { Room } from "../src/room.js";

/** Minimal stand-in for `ws.WebSocket`, just enough for `Room` to talk to. */
class FakeSocket {
  public readonly OPEN = 1;
  public readonly readyState = 1;
  public readonly received: ServerMessage[] = [];

  public send(data: string): void {
    this.received.push(JSON.parse(data));
  }
}

function makeRoom(): { room: Room; a: FakeSocket; b: FakeSocket } {
  const room = new Room("TEST01", "single");
  const a = new FakeSocket();
  const b = new FakeSocket();
  assert.equal(room.addSeat(a as unknown as import("ws").WebSocket), 0);
  assert.equal(room.addSeat(b as unknown as import("ws").WebSocket), 1);
  return { room, a, b };
}

test("a third seat cannot join a full room", () => {
  const { room } = makeRoom();
  const c = new FakeSocket();
  assert.equal(room.addSeat(c as unknown as import("ws").WebSocket), null);
});

test("submitCommand withholds a turn until both seats have submitted", () => {
  const { room, a, b } = makeRoom();
  const moveA: TurnCommandDto = { command: 0, move: { move: 1, targets: [2] } };
  const moveB: TurnCommandDto = { command: 0, move: { move: 5, targets: [0] } };

  room.submitCommand(0, 1, moveA);
  assert.equal(a.received.length, 0, "seat 0 must not hear back before seat 1 submits");
  assert.equal(b.received.length, 0, "seat 1 must not learn seat 0's command before submitting its own");

  room.submitCommand(1, 1, moveB);

  assert.equal(a.received.length, 1);
  assert.equal(b.received.length, 1);

  const toA = a.received.at(0);
  const toB = b.received.at(0);
  assert.ok(toA);
  assert.ok(toB);
  assert.equal(toA.type, "TURN_READY");
  assert.equal(toB.type, "TURN_READY");
  if (toA.type !== "TURN_READY" || toB.type !== "TURN_READY") {
    return;
  }

  // Each seat is told only the *other* seat's command, mirrored under the "enemy" slot.
  assert.deepEqual(toA.commands[ENEMY_BATTLER_INDEX], moveB);
  assert.deepEqual(toB.commands[ENEMY_BATTLER_INDEX], moveA);
  assert.equal(toA.turn, 1);
  assert.equal(toB.turn, 1);
});

test("submitCommand pairs commands per-turn, not globally", () => {
  const { room, a, b } = makeRoom();
  room.submitCommand(0, 1, { command: 0 });
  room.submitCommand(0, 2, { command: 3 }); // seat 0 already submitted turn 2 too, ahead of seat 1

  assert.equal(a.received.length, 0);
  assert.equal(b.received.length, 0);

  room.submitCommand(1, 1, { command: 1 });
  assert.equal(a.received.length, 1);
  assert.equal(b.received.length, 1);
  assert.equal((a.received.at(0) as { turn: number } | undefined)?.turn, 1);

  room.submitCommand(1, 2, { command: 2 });
  assert.equal(a.received.length, 2);
  assert.equal(b.received.length, 2);
  assert.equal((a.received.at(1) as { turn: number } | undefined)?.turn, 2);
});

test("bothReady requires both a submitted team and a READY from each seat", () => {
  const { room } = makeRoom();
  assert.equal(room.bothReady(), false);

  room.setTeam(0, [{ species: 25, level: 50, moves: [1, 2, 3] }]);
  room.setReady(0);
  assert.equal(room.bothReady(), false, "only one seat ready");

  room.setTeam(1, [{ species: 1, level: 50, moves: [4] }]);
  room.setReady(1);
  assert.equal(room.bothReady(), true);
});

test("removeSeat frees the seat and reports emptiness", () => {
  const { room, a } = makeRoom();
  assert.equal(room.isFull(), true);
  const seat = room.removeSeat(a as unknown as import("ws").WebSocket);
  assert.equal(seat, 0);
  assert.equal(room.isFull(), false);
  assert.equal(room.isEmpty(), false);
});

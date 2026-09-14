import assert from "node:assert/strict";
import { test } from "node:test";
import type { PvpPartyMemberDto, ServerMessage, TurnCommandDto } from "../src/protocol.js";
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

function makeTeam(species: number): PvpPartyMemberDto[] {
  return [
    {
      species,
      level: 50,
      moves: [1, 2, 3],
      id: species * 1000,
      abilityIndex: 0,
      formIndex: 0,
      gender: 0,
      shiny: false,
      variant: 0,
      ivs: [10, 10, 10, 10, 10, 10],
      nature: 0,
    },
  ];
}

function makeRoom(): { room: Room; a: FakeSocket; b: FakeSocket } {
  const room = new Room("TEST01", "single");
  const a = new FakeSocket();
  const b = new FakeSocket();
  assert.equal(room.addSeat(a as unknown as import("ws").WebSocket), 0);
  assert.equal(room.addSeat(b as unknown as import("ws").WebSocket), 1);
  return { room, a, b };
}

/** Bring a fresh room all the way to `in_battle`, seat 0 = species 25, seat 1 = species 1. */
function makeBattlingRoom(): { room: Room; a: FakeSocket; b: FakeSocket } {
  const ctx = makeRoom();
  ctx.room.setTeam(0, makeTeam(25));
  ctx.room.setTeam(1, makeTeam(1));
  ctx.room.setReady(0);
  ctx.room.setReady(1);
  assert.equal(ctx.room.tryBeginBattle(), true);
  return ctx;
}

test("a third seat cannot join a full room", () => {
  const { room } = makeRoom();
  const c = new FakeSocket();
  assert.equal(room.addSeat(c as unknown as import("ws").WebSocket), null);
});

test("submitCommand withholds a turn until both seats have submitted", () => {
  const { room, a, b } = makeBattlingRoom();
  const moveA: TurnCommandDto = { command: 0, move: { move: 1, targets: [2] } };
  const moveB: TurnCommandDto = { command: 0, move: { move: 5, targets: [0] } };

  assert.equal(room.submitCommand(0, 1, moveA), "ok");
  assert.equal(a.received.length, 0, "seat 0 must not hear back before seat 1 submits");
  assert.equal(b.received.length, 0, "seat 1 must not learn seat 0's command before submitting its own");

  assert.equal(room.submitCommand(1, 1, moveB), "ok");

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

test("submitCommand advances the room's current turn only once a turn completes, and rejects out-of-order turns", () => {
  const { room, a, b } = makeBattlingRoom();
  assert.equal(room.getCurrentTurn(), 1);

  // Seat 0 tries to get ahead of the room's current turn before turn 1 has even completed - O2 fix.
  assert.equal(room.submitCommand(0, 2, { command: 3 }), "future_turn");
  assert.equal(a.received.length, 0);
  assert.equal(b.received.length, 0);

  assert.equal(room.submitCommand(0, 1, { command: 0 }), "ok");
  assert.equal(room.submitCommand(1, 1, { command: 1 }), "ok");
  assert.equal(room.getCurrentTurn(), 2, "the room must advance exactly once turn 1 completes");
  assert.equal(a.received.length, 1);
  assert.equal(b.received.length, 1);
  assert.equal((a.received.at(0) as { turn: number } | undefined)?.turn, 1);

  // Now turn 2 is valid.
  assert.equal(room.submitCommand(1, 2, { command: 2 }), "ok");
  assert.equal(room.submitCommand(0, 2, { command: 2 }), "ok");
  assert.equal(room.getCurrentTurn(), 3);
  assert.equal(a.received.length, 2);
  assert.equal(b.received.length, 2);
  assert.equal((a.received.at(1) as { turn: number } | undefined)?.turn, 2);
});

test("submitCommand rejects a stale (already-completed) turn without reopening it", () => {
  const { room, a, b } = makeBattlingRoom();
  assert.equal(room.submitCommand(0, 1, { command: 0 }), "ok");
  assert.equal(room.submitCommand(1, 1, { command: 1 }), "ok");
  assert.equal(room.getCurrentTurn(), 2);
  a.received.length = 0;
  b.received.length = 0;

  assert.equal(room.submitCommand(0, 1, { command: 9 }), "stale_turn");
  assert.equal(a.received.length, 0);
  assert.equal(b.received.length, 0);
  assert.equal(room.getCurrentTurn(), 2, "a stale resubmission must not perturb the current turn");
});

test("submitCommand rejects a seat resubmitting for the same turn instead of overwriting it", () => {
  const { room, a, b } = makeBattlingRoom();
  const first: TurnCommandDto = { command: 0, move: { move: 1, targets: [2] } };
  const second: TurnCommandDto = { command: 0, move: { move: 99, targets: [2] } };

  assert.equal(room.submitCommand(0, 1, first), "ok");
  assert.equal(room.submitCommand(0, 1, second), "already_submitted");

  // The original command is preserved - resolving turn 1 must reveal `first`, not `second`.
  assert.equal(room.submitCommand(1, 1, { command: 1 }), "ok");
  const toB = b.received.at(0);
  assert.ok(toB && toB.type === "TURN_READY");
  if (toB.type !== "TURN_READY") {
    return;
  }
  assert.deepEqual(toB.commands[ENEMY_BATTLER_INDEX], first);
  void a;
});

test("tryBeginBattle only succeeds once, and requires both a submitted team and READY from each seat", () => {
  const { room } = makeRoom();
  assert.equal(room.tryBeginBattle(), false);

  room.setTeam(0, makeTeam(25));
  room.setReady(0);
  assert.equal(room.tryBeginBattle(), false, "only one seat ready");

  room.setTeam(1, makeTeam(1));
  room.setReady(1);
  assert.equal(room.getStatus(), "team_select");
  assert.equal(room.tryBeginBattle(), true);
  assert.equal(room.getStatus(), "in_battle");

  // A resent READY (bothReady() is still true) must not re-trigger battle start.
  assert.equal(room.tryBeginBattle(), false);
});

test("canSubmitTeam/canSubmitCommand/canJoin reflect the room's current status", () => {
  const { room } = makeRoom();
  assert.equal(room.canSubmitTeam(), true);
  assert.equal(room.canSubmitCommand(), false);
  assert.equal(room.canJoin(), true);

  room.setTeam(0, makeTeam(25));
  room.setTeam(1, makeTeam(1));
  room.setReady(0);
  room.setReady(1);
  room.tryBeginBattle();

  assert.equal(room.canSubmitTeam(), false, "cannot resubmit a team once in_battle");
  assert.equal(room.canSubmitCommand(), true);
  assert.equal(room.canJoin(), false, "a third player cannot join a room that already started");

  room.end();
  assert.equal(room.canSubmitTeam(), false);
  assert.equal(room.canSubmitCommand(), false, "cannot submit commands to an ended room");
  assert.equal(room.canJoin(), false);
});

test("removeSeat frees the seat and reports emptiness", () => {
  const { room, a } = makeRoom();
  assert.equal(room.isFull(), true);
  const seat = room.removeSeat(a as unknown as import("ws").WebSocket);
  assert.equal(seat, 0);
  assert.equal(room.isFull(), false);
  assert.equal(room.isEmpty(), false);
});

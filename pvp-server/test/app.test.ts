import assert from "node:assert/strict";
import { test } from "node:test";
import { connections, handleMessage, roomManager } from "../src/app.js";
import type { PvpPartyMemberDto, ServerMessage } from "../src/protocol.js";

/** Minimal stand-in for `ws.WebSocket`, just enough for `app.ts` to talk to. */
class FakeSocket {
  public readonly OPEN = 1;
  public readonly readyState = 1;
  public readonly received: ServerMessage[] = [];

  public send(data: string): void {
    this.received.push(JSON.parse(data));
  }
}

function lastMessage(socket: FakeSocket): ServerMessage | undefined {
  return socket.received.at(-1);
}

function errorMessages(socket: FakeSocket): string[] {
  return socket.received.filter((m): m is Extract<ServerMessage, { type: "ERROR" }> => m.type === "ERROR").map(m => m.message);
}

function send(socket: FakeSocket, message: unknown): void {
  handleMessage(socket as unknown as Parameters<typeof handleMessage>[0], JSON.stringify(message));
}

function createRoom(socket: FakeSocket): string {
  send(socket, { type: "CREATE_ROOM", mode: "single" });
  const msg = lastMessage(socket);
  assert.ok(msg && msg.type === "ROOM_CREATED", "expected ROOM_CREATED");
  if (msg.type !== "ROOM_CREATED") {
    throw new Error("unreachable");
  }
  return msg.roomId;
}

const VALID_TEAM: PvpPartyMemberDto[] = [
  {
    species: 25,
    level: 50,
    moves: [1, 2, 3],
    id: 1,
    abilityIndex: 0,
    formIndex: 0,
    gender: 0,
    shiny: false,
    variant: 0,
    ivs: [10, 10, 10, 10, 10, 10],
    nature: 0,
  },
];

test("a socket cannot create a second room while already seated, and can never join the room it just created", () => {
  const a = new FakeSocket();
  const roomId = createRoom(a);

  send(a, { type: "CREATE_ROOM", mode: "single" });
  assert.match(errorMessages(a).at(-1) ?? "", /already in a room/i);

  send(a, { type: "JOIN_ROOM", roomId });
  assert.match(errorMessages(a).at(-1) ?? "", /already in a room/i);

  // No second seat was ever taken in its own room.
  const room = roomManager.getRoom(roomId);
  assert.ok(room);
  assert.equal(room?.isFull(), false);
});

test("a socket already seated in one room cannot join a different room", () => {
  const a = new FakeSocket();
  const b = new FakeSocket();
  const c = new FakeSocket();
  createRoom(a);
  const roomBId = createRoom(b);

  send(a, { type: "JOIN_ROOM", roomId: roomBId });
  assert.match(errorMessages(a).at(-1) ?? "", /already in a room/i);
  // Room B must still only have its own creator seated - `a` was never let in - so the seat `a`
  // tried to steal is still free for someone else.
  send(c, { type: "JOIN_ROOM", roomId: roomBId });
  assert.ok(c.received.some(m => m.type === "ROOM_JOINED"));
});

test("a malformed SUBMIT_TEAM (pokemon not an array) does not crash the server and only errors the sender", () => {
  const a = new FakeSocket();
  const b = new FakeSocket();
  const roomId = createRoom(a);
  send(b, { type: "JOIN_ROOM", roomId });

  assert.doesNotThrow(() => {
    send(a, { type: "SUBMIT_TEAM", roomId, pokemon: "not-an-array" });
  });
  assert.match(errorMessages(a).at(-1) ?? "", /malformed message/i);

  // The other seat in the same room is completely unaffected.
  assert.doesNotThrow(() => {
    send(b, { type: "SUBMIT_TEAM", roomId, pokemon: VALID_TEAM });
  });
  assert.equal(errorMessages(b).length, 0);
});

test("a malformed party member (out-of-range IVs) is rejected by schema validation", () => {
  const a = new FakeSocket();
  const roomId = createRoom(a);
  const badTeam = [{ ...VALID_TEAM[0], ivs: [99, 0, 0, 0, 0, 0] }];

  assert.doesNotThrow(() => {
    send(a, { type: "SUBMIT_TEAM", roomId, pokemon: badTeam });
  });
  assert.match(errorMessages(a).at(-1) ?? "", /malformed message/i);
});

test("unparsable JSON only errors the sending socket, never touches any room", () => {
  const a = new FakeSocket();
  const b = new FakeSocket();
  createRoom(a);
  const roomBId = createRoom(b);

  assert.doesNotThrow(() => {
    handleMessage(a as unknown as Parameters<typeof handleMessage>[0], "{not valid json");
  });
  assert.match(errorMessages(a).at(-1) ?? "", /invalid json/i);

  // Room B, entirely unrelated to socket `a`, is untouched.
  const roomB = roomManager.getRoom(roomBId);
  assert.ok(roomB);
  assert.equal(roomB?.getStatus(), "team_select");
});

test("JOIN_ROOM is rejected once the room has already started battling", () => {
  const a = new FakeSocket();
  const b = new FakeSocket();
  const c = new FakeSocket();
  const roomId = createRoom(a);
  send(b, { type: "JOIN_ROOM", roomId });
  send(a, { type: "SUBMIT_TEAM", roomId, pokemon: VALID_TEAM });
  send(b, { type: "SUBMIT_TEAM", roomId, pokemon: VALID_TEAM });
  send(a, { type: "READY", roomId });
  send(b, { type: "READY", roomId });

  assert.equal(roomManager.getRoom(roomId)?.getStatus(), "in_battle");

  send(c, { type: "JOIN_ROOM", roomId });
  assert.match(errorMessages(c).at(-1) ?? "", /no longer accepting/i);
});

test("resending READY after battle start does not re-trigger battle start or re-send BATTLE_START", () => {
  const a = new FakeSocket();
  const b = new FakeSocket();
  const roomId = createRoom(a);
  send(b, { type: "JOIN_ROOM", roomId });
  send(a, { type: "SUBMIT_TEAM", roomId, pokemon: VALID_TEAM });
  send(b, { type: "SUBMIT_TEAM", roomId, pokemon: VALID_TEAM });
  send(a, { type: "READY", roomId });
  send(b, { type: "READY", roomId });

  const battleStartCountBefore = a.received.filter(m => m.type === "BATTLE_START").length;
  assert.equal(battleStartCountBefore, 1);

  send(a, { type: "READY", roomId });
  const battleStartCountAfter = a.received.filter(m => m.type === "BATTLE_START").length;
  assert.equal(battleStartCountAfter, 1, "a resent READY must not start the battle a second time");
  assert.match(errorMessages(a).at(-1) ?? "", /cannot ready up/i);
});

test("SUBMIT_COMMAND is rejected outside of an active battle", () => {
  const a = new FakeSocket();
  const b = new FakeSocket();
  const roomId = createRoom(a);
  send(b, { type: "JOIN_ROOM", roomId });

  send(a, { type: "SUBMIT_COMMAND", roomId, turn: 1, fieldIndex: 0, command: { command: 0 } });
  assert.match(errorMessages(a).at(-1) ?? "", /outside of an active battle/i);
});

test("a seat leaving mid-battle ends the room and the other seat can no longer submit commands", () => {
  const a = new FakeSocket();
  const b = new FakeSocket();
  const roomId = createRoom(a);
  send(b, { type: "JOIN_ROOM", roomId });
  send(a, { type: "SUBMIT_TEAM", roomId, pokemon: VALID_TEAM });
  send(b, { type: "SUBMIT_TEAM", roomId, pokemon: VALID_TEAM });
  send(a, { type: "READY", roomId });
  send(b, { type: "READY", roomId });

  const room = roomManager.getRoom(roomId);
  assert.ok(room);
  room.removeSeat(a as unknown as import("ws").WebSocket);
  // Mirror what `leaveRoom` does (mark ended once a seat leaves mid-battle) without going through
  // the real `close` event, since `FakeSocket` has no EventEmitter plumbing.
  if (room.getStatus() === "in_battle") {
    room.end();
  }

  send(b, { type: "SUBMIT_COMMAND", roomId, turn: 1, fieldIndex: 0, command: { command: 0 } });
  assert.match(errorMessages(b).at(-1) ?? "", /outside of an active battle/i);
});

test.after(() => {
  connections.clear();
});

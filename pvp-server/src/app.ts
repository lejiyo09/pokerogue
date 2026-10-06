import type { WebSocket } from "ws";
import type { ClientMessage } from "./protocol.js";
import type { Room, SeatIndex } from "./room.js";
import { generateBattleSeed, RoomManager } from "./room-manager.js";
import { parseClientMessage } from "./schema.js";

/**
 * Connection handling and message dispatch, kept separate from the process entrypoint
 * (`server.ts`) so it can be exercised directly in tests without binding a real port - see
 * `test/app.test.ts`.
 * @module
 */

export const roomManager = new RoomManager();

export interface ConnectionState {
  room: Room | null;
  seat: SeatIndex | null;
}

export const connections = new Map<WebSocket, ConnectionState>();

function sendError(socket: WebSocket, message: string): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: "ERROR", message }));
  }
}

/** @returns The room+seat for a message that must reference an existing room the socket has joined, or `null` (having already sent an ERROR). */
function requireSeat(socket: WebSocket, roomId: string): { room: Room; seat: SeatIndex } | null {
  const state = connections.get(socket);
  const room = roomManager.getRoom(roomId);
  if (!room || !state || state.room !== room || state.seat === null) {
    sendError(socket, `Not currently seated in room ${roomId}`);
    return null;
  }
  return { room, seat: state.seat };
}

/**
 * Actually act on a validated {@linkcode ClientMessage}. Kept separate from {@linkcode handleMessage}
 * so that the latter can wrap this in a single try/catch - see R3 fix notes.
 */
export function dispatchMessage(socket: WebSocket, message: ClientMessage): void {
  switch (message.type) {
    case "CREATE_ROOM": {
      // A socket that already occupies a seat (in this room or another) may not create a second
      // one - this also rules out a socket ever joining the very room it just created (R2 fix).
      const state = connections.get(socket);
      if (state?.room) {
        sendError(socket, "Already in a room; leave it before creating another");
        return;
      }
      const room = roomManager.createRoom(message.mode);
      const seat = room.addSeat(socket);
      if (seat === null) {
        // Cannot happen on a brand-new room, but avoid leaving an orphaned, seatless room behind
        // if it ever does.
        roomManager.deleteIfEmpty(room);
        sendError(socket, "Failed to create room");
        return;
      }
      connections.set(socket, { room, seat });
      room.sendTo(seat, { type: "ROOM_CREATED", roomId: room.id });
      console.log(`[room ${room.id}] created (mode=${room.mode}), seat 0 taken`);
      return;
    }

    case "JOIN_ROOM": {
      const state = connections.get(socket);
      if (state?.room) {
        sendError(socket, "Already in a room; leave it before joining another");
        return;
      }
      const room = roomManager.getRoom(message.roomId);
      if (!room) {
        sendError(socket, `No such room: ${message.roomId}`);
        return;
      }
      if (!room.canJoin()) {
        sendError(socket, `Room ${message.roomId} is no longer accepting new players`);
        return;
      }
      if (room.isFull()) {
        sendError(socket, `Room ${message.roomId} is full`);
        return;
      }
      const seat = room.addSeat(socket);
      if (seat === null) {
        sendError(socket, `Room ${message.roomId} is full`);
        return;
      }
      connections.set(socket, { room, seat });
      room.sendTo(seat, { type: "ROOM_JOINED", roomId: room.id });
      console.log(`[room ${room.id}] seat ${seat} taken`);

      if (room.isFull()) {
        room.broadcast({ type: "ROOM_FULL", double: room.double });
        console.log(`[room ${room.id}] full, awaiting team submission`);
      }
      return;
    }

    case "LEAVE_ROOM": {
      leaveRoom(socket);
      return;
    }

    case "SUBMIT_TEAM": {
      const ctx = requireSeat(socket, message.roomId);
      if (!ctx) {
        return;
      }
      if (!ctx.room.canSubmitTeam()) {
        sendError(socket, "Cannot submit a team once the battle has started");
        return;
      }
      ctx.room.setTeam(ctx.seat, message.pokemon);
      console.log(`[room ${ctx.room.id}] seat ${ctx.seat} submitted a team (${message.pokemon.length} pokemon)`);
      return;
    }

    case "READY": {
      const ctx = requireSeat(socket, message.roomId);
      if (!ctx) {
        return;
      }
      if (!ctx.room.canSubmitTeam()) {
        // Already in_battle (or ended) - a resent READY must never re-trigger startBattle (O1 fix).
        sendError(socket, "Cannot ready up once the battle has started");
        return;
      }
      if (ctx.room.getTeam(ctx.seat) === null) {
        sendError(socket, "Submit a team before readying up");
        return;
      }
      ctx.room.setReady(ctx.seat);
      console.log(`[room ${ctx.room.id}] seat ${ctx.seat} ready`);

      if (ctx.room.tryBeginBattle()) {
        startBattle(ctx.room);
      }
      return;
    }

    case "SUBMIT_COMMAND": {
      const ctx = requireSeat(socket, message.roomId);
      if (!ctx) {
        return;
      }
      if (!ctx.room.canSubmitCommand()) {
        sendError(socket, "Cannot submit a command outside of an active battle");
        return;
      }
      const result = ctx.room.submitCommand(ctx.seat, message.turn, message.command);
      switch (result) {
        case "ok":
          console.log(`[room ${ctx.room.id}] seat ${ctx.seat} submitted turn ${message.turn} command`);
          break;
        case "already_submitted":
          sendError(socket, `Already submitted a command for turn ${message.turn}`);
          break;
        case "stale_turn":
          sendError(socket, `Turn ${message.turn} has already completed`);
          break;
        case "future_turn":
          sendError(
            socket,
            `Turn ${message.turn} is not yet valid (room is currently on turn ${ctx.room.getCurrentTurn()})`,
          );
          break;
      }
      return;
    }

    case "STATE_HASH": {
      // Cross-client verification is not implemented yet - accepted and ignored.
      // See docs/pvp-online-battle-design.md §7.3 / §12 and pvp-server/README.md "Known gaps".
      return;
    }

    case "FORFEIT": {
      const ctx = requireSeat(socket, message.roomId);
      if (!ctx) {
        return;
      }
      if (ctx.room.getStatus() === "ended") {
        sendError(socket, "Battle has already ended");
        return;
      }
      ctx.room.end();
      ctx.room.broadcast({ type: "BATTLE_END", reason: "forfeit" });
      console.log(`[room ${ctx.room.id}] seat ${ctx.seat} forfeited`);
      return;
    }

    default: {
      sendError(socket, `Unknown message type: ${(message as { type?: string }).type}`);
    }
  }
}

/**
 * Entry point for every inbound message: validate its shape, then dispatch it. No exception
 * raised while handling one socket's message may ever escape and crash the process, or corrupt
 * state shared with unrelated rooms/sockets (R3 fix) - this is the single choke point every
 * inbound message passes through.
 */
export function handleMessage(socket: WebSocket, raw: string): void {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    sendError(socket, "Malformed message: invalid JSON");
    return;
  }

  const parsed = parseClientMessage(parsedJson);
  if (!parsed.success) {
    sendError(socket, `Malformed message: ${parsed.error}`);
    return;
  }

  try {
    dispatchMessage(socket, parsed.data);
  } catch (err) {
    console.error(`Error handling ${parsed.data.type} message:`, err);
    sendError(socket, "Internal server error while handling your message");
  }
}

function startBattle(room: Room): void {
  const battleSeed = generateBattleSeed();
  const teamA = room.getTeam(0);
  const teamB = room.getTeam(1);
  if (!teamA || !teamB) {
    // `tryBeginBattle` already guarantees this; defensive check to keep the type checker honest.
    return;
  }
  room.sendTo(0, { type: "BATTLE_START", battleSeed, double: room.double, opponentTeam: teamB });
  room.sendTo(1, { type: "BATTLE_START", battleSeed, double: room.double, opponentTeam: teamA });
  console.log(`[room ${room.id}] battle started (seed=${battleSeed})`);
}

export function leaveRoom(socket: WebSocket): void {
  const state = connections.get(socket);
  if (!state?.room) {
    return;
  }
  const { room } = state;
  const seat = room.removeSeat(socket);
  connections.delete(socket);
  if (seat !== null) {
    // A match that already had both sides connected cannot meaningfully continue with only one -
    // mark it ended so no further command is accepted (O1 fix); a room still in team_select stays
    // open for someone else to fill the vacated seat.
    if (room.getStatus() === "in_battle") {
      room.end();
    }
    const otherSeat: SeatIndex = seat === 0 ? 1 : 0;
    room.sendTo(otherSeat, { type: "DISCONNECT", graceSeconds: 0 });
    console.log(`[room ${room.id}] seat ${seat} left`);
  }
  roomManager.deleteIfEmpty(room);
}

/** Wire up a freshly-accepted real `ws` connection. */
export function attachConnection(socket: WebSocket): void {
  connections.set(socket, { room: null, seat: null });

  socket.on("message", data => handleMessage(socket, data.toString()));
  socket.on("close", () => leaveRoom(socket));
  socket.on("error", err => console.error("Socket error:", err));
}

import { type WebSocket, WebSocketServer } from "ws";
import type { ClientMessage } from "./protocol.js";
import type { Room, SeatIndex } from "./room.js";
import { generateBattleSeed, RoomManager } from "./room-manager.js";

const PORT = Number(process.env.PORT ?? 8081);

const roomManager = new RoomManager();

interface ConnectionState {
  room: Room | null;
  seat: SeatIndex | null;
}

const connections = new Map<WebSocket, ConnectionState>();

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

function handleMessage(socket: WebSocket, raw: string): void {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw);
  } catch {
    sendError(socket, "Malformed message");
    return;
  }

  switch (message.type) {
    case "CREATE_ROOM": {
      const room = roomManager.createRoom(message.mode);
      const seat = room.addSeat(socket);
      // `addSeat` cannot fail on a brand-new room, but keep the type checker honest.
      if (seat === null) {
        sendError(socket, "Failed to create room");
        return;
      }
      connections.set(socket, { room, seat });
      room.sendTo(seat, { type: "ROOM_CREATED", roomId: room.id });
      console.log(`[room ${room.id}] created (mode=${room.mode}), seat 0 taken`);
      return;
    }

    case "JOIN_ROOM": {
      const room = roomManager.getRoom(message.roomId);
      if (!room) {
        sendError(socket, `No such room: ${message.roomId}`);
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
      ctx.room.setTeam(ctx.seat, message.pokemon);
      console.log(`[room ${ctx.room.id}] seat ${ctx.seat} submitted a team (${message.pokemon.length} pokemon)`);
      return;
    }

    case "READY": {
      const ctx = requireSeat(socket, message.roomId);
      if (!ctx) {
        return;
      }
      if (ctx.room.getTeam(ctx.seat) === null) {
        sendError(socket, "Submit a team before readying up");
        return;
      }
      ctx.room.setReady(ctx.seat);
      console.log(`[room ${ctx.room.id}] seat ${ctx.seat} ready`);

      if (ctx.room.bothReady()) {
        startBattle(ctx.room);
      }
      return;
    }

    case "SUBMIT_COMMAND": {
      const ctx = requireSeat(socket, message.roomId);
      if (!ctx) {
        return;
      }
      console.log(`[room ${ctx.room.id}] seat ${ctx.seat} submitted turn ${message.turn} command`);
      ctx.room.submitCommand(ctx.seat, message.turn, message.command);
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
      ctx.room.broadcast({ type: "BATTLE_END", reason: "forfeit" });
      console.log(`[room ${ctx.room.id}] seat ${ctx.seat} forfeited`);
      return;
    }

    default: {
      sendError(socket, `Unknown message type: ${(message as { type?: string }).type}`);
    }
  }
}

function startBattle(room: Room): void {
  const battleSeed = generateBattleSeed();
  const teamA = room.getTeam(0);
  const teamB = room.getTeam(1);
  if (!teamA || !teamB) {
    // `bothReady` already guarantees this; defensive check to keep the type checker honest.
    return;
  }
  room.sendTo(0, { type: "BATTLE_START", battleSeed, double: room.double, opponentTeam: teamB });
  room.sendTo(1, { type: "BATTLE_START", battleSeed, double: room.double, opponentTeam: teamA });
  console.log(`[room ${room.id}] battle started (seed=${battleSeed})`);
}

function leaveRoom(socket: WebSocket): void {
  const state = connections.get(socket);
  if (!state?.room) {
    return;
  }
  const { room } = state;
  const seat = room.removeSeat(socket);
  connections.delete(socket);
  if (seat !== null) {
    const otherSeat: SeatIndex = seat === 0 ? 1 : 0;
    room.sendTo(otherSeat, { type: "DISCONNECT", graceSeconds: 0 });
    console.log(`[room ${room.id}] seat ${seat} left`);
  }
  roomManager.deleteIfEmpty(room);
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", socket => {
  connections.set(socket, { room: null, seat: null });

  socket.on("message", data => handleMessage(socket, data.toString()));
  socket.on("close", () => leaveRoom(socket));
  socket.on("error", err => console.error("Socket error:", err));
});

console.log(`PokéRogue PvP server listening on ws://localhost:${PORT}`);

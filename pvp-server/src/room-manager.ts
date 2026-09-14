import crypto from "node:crypto";
import type { PvpMode } from "./protocol.js";
import { Room } from "./room.js";

// Excludes visually ambiguous characters (0/O, 1/I).
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;

function generateRoomCode(): string {
  let code = "";
  const bytes = crypto.randomBytes(ROOM_CODE_LENGTH);
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[(bytes[i] ?? 0) % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

/** Generates a battle seed shared by both participants (see docs/pvp-online-battle-design.md §8.2). */
export function generateBattleSeed(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** In-memory registry of active PvP rooms. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  public createRoom(mode: PvpMode): Room {
    let id: string;
    do {
      id = generateRoomCode();
    } while (this.rooms.has(id));

    const room = new Room(id, mode);
    this.rooms.set(id, room);
    return room;
  }

  public getRoom(id: string): Room | null {
    return this.rooms.get(id) ?? null;
  }

  public deleteIfEmpty(room: Room): void {
    if (room.isEmpty()) {
      this.rooms.delete(room.id);
    }
  }
}

/**
 * Wire protocol shared with the client's `src/net/pvp-protocol-types.ts`.
 *
 * There is intentionally no shared package between this server and the client repo/directory -
 * they are meant to be independently deployable projects (see pvp-server/README.md and
 * docs/pvp-online-battle-design.md §9 in the client repo). Keep this file's shapes in sync with
 * `src/net/pvp-protocol-types.ts` by hand when the protocol changes.
 *
 * Numeric enum values below (Command, BattlerIndex, MoveId, SpeciesId) are opaque to the server -
 * it never interprets them, only relays them between the two clients - so they are typed as
 * `number` here rather than duplicating the client's enums.
 */

/** Mirrors `src/enums/battler-index.ts`. The server only ever needs to know a peer is "the enemy". */
export const ENEMY_BATTLER_INDEX = 2;

export type PvpMode = "single" | "double";

/** Mirrors the client's `TurnCommandDto`. */
export interface TurnCommandDto {
  command: number;
  cursor?: number;
  move?: {
    move: number;
    targets: number[];
  };
  targets?: number[];
}

/** Mirrors the client's `PvpPartyMemberDto`. */
export interface PvpPartyMemberDto {
  species: number;
  level: number;
  moves: number[];
}

// #region Client -> Server messages

export interface CreateRoomMessage {
  type: "CREATE_ROOM";
  mode: PvpMode;
}

export interface JoinRoomMessage {
  type: "JOIN_ROOM";
  roomId: string;
}

export interface LeaveRoomMessage {
  type: "LEAVE_ROOM";
  roomId: string;
}

export interface SubmitTeamMessage {
  type: "SUBMIT_TEAM";
  roomId: string;
  pokemon: PvpPartyMemberDto[];
}

export interface ReadyMessage {
  type: "READY";
  roomId: string;
}

/** A single, generic "this is my command for this turn" message (covers FIGHT/POKEMON/TERA/etc). */
export interface SubmitCommandMessage {
  type: "SUBMIT_COMMAND";
  roomId: string;
  turn: number;
  fieldIndex: number;
  command: TurnCommandDto;
}

export interface StateHashMessage {
  type: "STATE_HASH";
  roomId: string;
  turn: number;
  hash: string;
}

export interface ForfeitMessage {
  type: "FORFEIT";
  roomId: string;
}

export type ClientMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | LeaveRoomMessage
  | SubmitTeamMessage
  | ReadyMessage
  | SubmitCommandMessage
  | StateHashMessage
  | ForfeitMessage;

// #endregion Client -> Server messages

// #region Server -> Client messages

export interface RoomCreatedMessage {
  type: "ROOM_CREATED";
  roomId: string;
}

export interface RoomJoinedMessage {
  type: "ROOM_JOINED";
  roomId: string;
}

export interface RoomFullMessage {
  type: "ROOM_FULL";
  double: boolean;
}

export interface BattleStartMessage {
  type: "BATTLE_START";
  battleSeed: string;
  double: boolean;
  opponentTeam: PvpPartyMemberDto[];
}

/**
 * Sent individually to each seat once BOTH seats have submitted a command for `turn` -
 * never before. `commands` only ever contains the *opponent's* command
 * (keyed by `ENEMY_BATTLER_INDEX`), since a client already knows its own.
 */
export interface TurnReadyMessage {
  type: "TURN_READY";
  turn: number;
  commands: Record<number, TurnCommandDto>;
}

export interface BattleEndMessage {
  type: "BATTLE_END";
  reason: string;
}

export interface OpponentDisconnectedMessage {
  type: "DISCONNECT";
  graceSeconds: number;
}

export interface ErrorMessage {
  type: "ERROR";
  message: string;
}

export type ServerMessage =
  | RoomCreatedMessage
  | RoomJoinedMessage
  | RoomFullMessage
  | BattleStartMessage
  | TurnReadyMessage
  | BattleEndMessage
  | OpponentDisconnectedMessage
  | ErrorMessage;

// #endregion Server -> Client messages

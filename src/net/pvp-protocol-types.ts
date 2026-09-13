/**
 * Message and DTO types for the client <-> PvP server WebSocket protocol.
 * @see docs/pvp-online-battle-design.md §6 for the full message table and rationale.
 * @module
 */

import type { BattlerIndex } from "#enums/battler-index";
import type { Command } from "#enums/command";
import type { MoveId } from "#enums/move-id";
import type { SpeciesId } from "#enums/species-id";

/** Whether a PvP match is a single (1v1) or double (2v2) battle. */
export type PvpMode = "single" | "double";

/**
 * Serializable subset of {@linkcode TurnCommand} (see `src/battle.ts`) sent over the wire.
 * Omits fields that either don't apply to PvP (e.g. `skip`, used for AI ally coordination)
 * or aren't yet supported by the MVP (e.g. non-`NORMAL` {@linkcode MoveUseMode}s).
 */
export interface TurnCommandDto {
  command: Command;
  cursor?: number;
  move?: {
    move: MoveId;
    targets: BattlerIndex[];
  };
  targets?: BattlerIndex[];
}

/** A single Pokémon submitted as part of a player's PvP team. */
export interface PvpPartyMemberDto {
  species: SpeciesId;
  level: number;
  moves: MoveId[];
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

export interface SelectMoveMessage {
  type: "SELECT_MOVE";
  roomId: string;
  turn: number;
  fieldIndex: number;
  moveId: MoveId;
  targets: BattlerIndex[];
}

export interface SelectSwitchMessage {
  type: "SELECT_SWITCH";
  roomId: string;
  turn: number;
  fieldIndex: number;
  partyIndex: number;
}

export interface SelectOtherMessage {
  type: "SELECT_OTHER";
  roomId: string;
  turn: number;
  fieldIndex: number;
  command: Command;
}

export interface StateHashMessage {
  type: "STATE_HASH";
  roomId: string;
  turn: number;
  hash: string;
}

export interface ReconnectMessage {
  type: "RECONNECT";
  roomId: string;
  lastKnownTurn: number;
}

export interface ForfeitMessage {
  type: "FORFEIT";
  roomId: string;
}

export type PvpClientMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | LeaveRoomMessage
  | SubmitTeamMessage
  | ReadyMessage
  | SelectMoveMessage
  | SelectSwitchMessage
  | SelectOtherMessage
  | StateHashMessage
  | ReconnectMessage
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
  yourBattlerIndex: BattlerIndex;
}

/** Sent to both participants once every seat in the room is filled, so team selection can begin. */
export interface RoomFullMessage {
  type: "ROOM_FULL";
  double: boolean;
}

export interface BattleStartMessage {
  type: "BATTLE_START";
  battleSeed: string;
  double: boolean;
  yourBattlerIndex: BattlerIndex;
  opponentTeam: PvpPartyMemberDto[];
}

export interface TurnReadyMessage {
  type: "TURN_READY";
  turn: number;
  commands: Partial<Record<BattlerIndex, TurnCommandDto>>;
}

export interface StateAckMessage {
  type: "STATE_ACK";
  turn: number;
}

export interface ResyncRequiredMessage {
  type: "RESYNC_REQUIRED";
  turn: number;
}

export interface BattleEndMessage {
  type: "BATTLE_END";
  winner: BattlerIndex | null;
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

export type PvpServerMessage =
  | RoomCreatedMessage
  | RoomJoinedMessage
  | RoomFullMessage
  | BattleStartMessage
  | TurnReadyMessage
  | StateAckMessage
  | ResyncRequiredMessage
  | BattleEndMessage
  | OpponentDisconnectedMessage
  | ErrorMessage;

// #endregion Server -> Client messages

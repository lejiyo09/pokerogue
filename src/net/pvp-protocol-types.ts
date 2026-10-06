/**
 * Message and DTO types for the client <-> PvP server WebSocket protocol.
 *
 * Kept in sync **by hand** with `pvp-server/src/protocol.ts` - the two are independent projects
 * (see `pvp-server/README.md`) with no shared package, mirroring how upstream PokéRogue's actual
 * client and server are separate repositories with no shared type package either.
 * @see docs/pvp-online-battle-design.md §6 for the design rationale.
 * @module
 */

import type { Gender } from "#data/gender";
import type { BattlerIndex } from "#enums/battler-index";
import type { Command } from "#enums/command";
import type { MoveId } from "#enums/move-id";
import type { Nature } from "#enums/nature";
import type { SpeciesId } from "#enums/species-id";
import type { Variant } from "#sprites/variant";

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

/**
 * A single Pokémon submitted as part of a player's PvP team.
 *
 * Beyond the visible `species`/`level`/`moves`, this also pins down every field the battle
 * engine's own Pokémon construction would otherwise randomize (`id`, IVs, ability, form, gender,
 * shininess/variant, nature). Both clients build this Pokémon from the *same* DTO - one as a
 * `PlayerPokemon` (the owner's own client), the other as an `EnemyPokemon` (the opponent's client)
 * - so without these fields being explicit and shared, the two clients would each roll their own
 * random values and silently desync the battle. See {@linkcode generatePvpPartyMemberDto} in
 * `#net/pvp-team-setup` (generates these once, from a real Pokémon construction) and
 * `docs/pvp-online-battle-design.md`.
 */
export interface PvpPartyMemberDto {
  species: SpeciesId;
  level: number;
  moves: MoveId[];
  id: number;
  abilityIndex: number;
  formIndex: number;
  gender: Gender;
  shiny: boolean;
  variant: Variant;
  ivs: number[];
  nature: Nature;
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

/**
 * "This is my command for this turn" - a single, generic message covering FIGHT/POKEMON/TERA/etc,
 * since {@linkcode TurnCommandDto} already fully describes any command type.
 * `fieldIndex` is always relative to the *sender's own* side (0, or 1 in a double battle) - never
 * a shared/global index, since each client always treats itself as the `PLAYER` side locally
 * (see docs/pvp-online-battle-design.md §4, and `RemoteCommandWaitPhase`).
 */
export interface SubmitCommandMessage {
  type: "SUBMIT_COMMAND";
  roomId: string;
  turn: number;
  fieldIndex: number;
  command: TurnCommandDto;
}

/** Not yet acted on by the server - see `pvp-server/README.md` "Known gaps". */
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

export type PvpClientMessage =
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

/** Sent to both participants once every seat in the room is filled, so team selection can begin. */
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
 * Sent individually to each participant once **both** sides have submitted a command for `turn` -
 * never before (see docs/pvp-online-battle-design.md §5.2, "commit-reveal"). `commands` only ever
 * contains the *opponent's* command, keyed by {@linkcode BattlerIndex.ENEMY}, since a client
 * already knows its own (it just finalized it locally via `CommandPhase`).
 */
export interface TurnReadyMessage {
  type: "TURN_READY";
  turn: number;
  commands: Partial<Record<BattlerIndex, TurnCommandDto>>;
}

/** Currently only ever sent for an explicit {@linkcode ForfeitMessage} - see `pvp-server/README.md` "Known gaps". */
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

export type PvpServerMessage =
  | RoomCreatedMessage
  | RoomJoinedMessage
  | RoomFullMessage
  | BattleStartMessage
  | TurnReadyMessage
  | BattleEndMessage
  | OpponentDisconnectedMessage
  | ErrorMessage;

// #endregion Server -> Client messages

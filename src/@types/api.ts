import type { PokemonData } from "#system/pokemon-data";
import type { SessionSaveData, SystemSaveData } from "#types/save-data";

export interface UserInfo {
  username: string;
  lastSessionSlot: number;
  discordId: string;
  googleId: string;
  hasAdminRole: boolean;
  /** Full gameplay-cheat access (see `GameData.unlockEverythingForCheats`) - granted to exactly one designated school email; see rogueserver's `cheatAccountEmail`. */
  cheatsEnabled: boolean;
}

export interface TitleStatsResponse {
  playerCount: number;
  battleCount: number;
}

// #region Account API

export interface AccountInfoResponse extends UserInfo {}

export interface AccountLoginRequest {
  username: string;
  password: string;
}

export interface AccountLoginResponse {
  token: string;
}

export interface AccountRegisterRequest {
  username: string;
  password: string;
}

export interface AccountChangePwRequest {
  password: string;
}
export interface AccountChangePwResponse {
  success: boolean;
}

// #endregion Account API

// #region Admin API

export interface SearchAccountRequest {
  username: string;
}

export interface DiscordRequest extends SearchAccountRequest {
  discordId: string;
}

export interface GoogleRequest extends SearchAccountRequest {
  googleId: string;
}

export interface SearchAccountResponse {
  username: string;
  discordId: string;
  googleId: string;
  lastLoggedIn: string;
  registered: string;
  systemData?: SystemSaveData;
}

/** Third party login services */
export type AdminUiHandlerService = "discord" | "google";
/** Mode for the admin UI handler */
export type AdminUiHandlerServiceMode = "Link" | "Unlink";

export interface PokerogueAdminApiParams extends Record<AdminUiHandlerService, SearchAccountRequest> {
  discord: DiscordRequest;
  google: GoogleRequest;
}

// #endregion Admin API

export interface UpdateAllSavedataRequest {
  system: SystemSaveData;
  session: SessionSaveData;
  sessionSlotId: number;
  clientSessionId: string;
}

// #region Session Save API

export interface UpdateSessionSavedataRequest {
  slot: number;
  trainerId: number;
  secretId: number;
  clientSessionId: string;
}

/** This is **NOT** related to {@linkcode ClearSessionSavedataRequest}  */
export interface NewClearSessionSavedataRequest {
  slot: number;
  isVictory: boolean;
  clientSessionId: string;
}

export interface GetSessionSavedataRequest {
  slot: number;
  clientSessionId: string;
}

export interface DeleteSessionSavedataRequest {
  slot: number;
  clientSessionId: string;
}

/** This is **NOT** related to {@linkcode NewClearSessionSavedataRequest} */
export interface ClearSessionSavedataRequest {
  slot: number;
  trainerId: number;
  clientSessionId: string;
}

/** Pokerogue API response for path: `/savedata/session/clear` */
// TODO: Why can these be nullish?
export interface ClearSessionSavedataResponse {
  /** Contains the error message if any occured */
  error?: string;
  /** Is `true` if the request was successfully processed */
  success?: boolean;
}

// #endregion Session Save API

// #region System Save API

export interface GetSystemSavedataRequest {
  clientSessionId: string;
}

export interface UpdateSystemSavedataRequest {
  clientSessionId: string;
  trainerId?: number;
  secretId?: number;
}

export interface VerifySystemSavedataRequest {
  clientSessionId: string;
}

export interface VerifySystemSavedataResponse {
  valid: boolean;
  systemData: SystemSaveData;
}

// #endregion System Save API

// #region PvP Collection API
// See `docs/pvp-progression-design.md` §2 for the design this implements.

/**
 * One individual permanently banked into a player's PvP Global Pokémon Collection.
 * @see `docs/pvp-progression-design.md` §2.1
 */
export interface BankedPokemon {
  /** A client-generated identifier stable across repeated syncs of the same individual. */
  uid: string;
  data: PokemonData;
  originRunSeed: string;
  originTimestamp: number;
  /** The individual's level within its originating PvE run, kept for display only - never used in PvP battle calculations. */
  pveLevel: number;
}

export type GetPvpCollectionResponse = BankedPokemon[];

export interface UpsertPvpCollectionRequest {
  entries: BankedPokemon[];
}

// #endregion PvP Collection API

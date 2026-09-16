import type { PvpRoomManager } from "#net/pvp-room-manager";

/**
 * The currently-active {@linkcode PvpRoomManager}, if any.
 *
 * Mirrors the `globalScene` singleton pattern (`#app/global-scene`): the battle engine's
 * phases (e.g. `RemoteCommandWaitPhase`) need to reach the active PvP session without every
 * caller threading it through as a parameter.
 */
let activeSession: PvpRoomManager | null = null;

/** Set (or clear, with `null`) the active PvP session. */
export function setPvpSession(session: PvpRoomManager | null): void {
  activeSession = session;
}

/** @returns The active PvP session, or `null` if not currently in a PvP match. */
export function getPvpSession(): PvpRoomManager | null {
  return activeSession;
}

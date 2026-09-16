import { conflictsWithPvpTeam } from "#data/pvp/species-clause";
import type { BankedPokemon } from "#types/api";

/** The maximum number of individuals a PvP team may contain. */
export const PVP_TEAM_SIZE = 6;

/**
 * Immutable selection state for the PvP team builder: a pool of candidates
 * (from the player's Global Pokémon Collection) and the subset currently
 * selected for the team.
 * @see `docs/pvp-progression-design.md` §2.4/§2.5/§2.6
 */
export interface PvpTeamBuilderState {
  readonly pool: readonly BankedPokemon[];
  readonly selected: readonly BankedPokemon[];
}

/** Creates a fresh team builder state with nothing selected yet. */
export function createPvpTeamBuilderState(pool: readonly BankedPokemon[]): PvpTeamBuilderState {
  return { pool, selected: [] };
}

function isSelected(state: PvpTeamBuilderState, uid: string): boolean {
  return state.selected.some(member => member.uid === uid);
}

/**
 * Checks whether the pool candidate identified by `uid` can currently be
 * added to the team - i.e. the team isn't full, it isn't already selected,
 * and it doesn't violate the Species Clause against what's already selected.
 * @param state - The current team builder state
 * @param uid - The `BankedPokemon.uid` of the candidate to check
 */
export function isSelectable(state: PvpTeamBuilderState, uid: string): boolean {
  if (state.selected.length >= PVP_TEAM_SIZE || isSelected(state, uid)) {
    return false;
  }

  const candidate = state.pool.find(member => member.uid === uid);
  if (!candidate) {
    return false;
  }

  return !conflictsWithPvpTeam(
    candidate.data,
    state.selected.map(member => member.data),
  );
}

/**
 * Adds the pool candidate identified by `uid` to the team.
 * @returns A new state with `uid` selected, or `state` unchanged if {@linkcode isSelectable} would return `false`.
 */
export function select(state: PvpTeamBuilderState, uid: string): PvpTeamBuilderState {
  if (!isSelectable(state, uid)) {
    return state;
  }

  const candidate = state.pool.find(member => member.uid === uid);
  if (!candidate) {
    return state;
  }

  return { ...state, selected: [...state.selected, candidate] };
}

/**
 * Removes `uid` from the team, freeing up its species slot for other candidates.
 * @returns A new state with `uid` no longer selected. A no-op (returns an equivalent state) if it wasn't selected.
 */
export function deselect(state: PvpTeamBuilderState, uid: string): PvpTeamBuilderState {
  return { ...state, selected: state.selected.filter(member => member.uid !== uid) };
}

/** Whether the team has reached {@linkcode PVP_TEAM_SIZE} members. */
export function isFull(state: PvpTeamBuilderState): boolean {
  return state.selected.length >= PVP_TEAM_SIZE;
}

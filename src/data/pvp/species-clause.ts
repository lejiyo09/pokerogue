import type { SpeciesId } from "#enums/species-id";

/**
 * The minimal shape {@linkcode getPvpSpeciesSlots} needs - satisfied by both
 * a full {@linkcode PokemonData} and a `BankedPokemon.data`.
 */
export interface PvpSpeciesClauseSource {
  species: SpeciesId;
  fusionSpecies?: SpeciesId | null;
}

/**
 * Returns the species slot(s) a given individual "occupies" for PvP's
 * duplicate-species check (Species Clause).
 * @remarks
 * `formIndex`/`fusionFormIndex` are intentionally not consulted - a mega
 * evolution or form change (e.g. Black/White Kyurem) shares its base
 * `species` value in this codebase, so comparing `species` alone already
 * treats them as the same species. Regional forms (Alolan/Galarian/etc.)
 * are, by contrast, distinct `SpeciesId` values here and are therefore
 * already treated as different species with no extra handling needed.
 *
 * A fused individual occupies both its own `species` and its
 * `fusionSpecies` slot, since the fusion mechanic (`Pokemon.fuse()`)
 * destroys the donor individual within a single run, so the only way to
 * hold both a fusion and an unfused copy of its donor species at once is
 * across two different save slots/collection entries.
 * @see `docs/pvp-progression-design.md` §2.6 for the full reasoning.
 * @param source - The individual to resolve
 * @returns The species slots `source` occupies
 */
export function getPvpSpeciesSlots(source: PvpSpeciesClauseSource): SpeciesId[] {
  return source.fusionSpecies ? [source.species, source.fusionSpecies] : [source.species];
}

/**
 * Checks whether `candidate` would violate PvP's Species Clause against the
 * individuals already on `team` - i.e. whether it shares a species slot
 * (see {@linkcode getPvpSpeciesSlots}) with any of them.
 * @param candidate - The individual being considered for the team
 * @param team - The individuals already selected for the team
 * @returns `true` if adding `candidate` to `team` would duplicate a species
 */
export function conflictsWithPvpTeam(candidate: PvpSpeciesClauseSource, team: PvpSpeciesClauseSource[]): boolean {
  const candidateSlots = getPvpSpeciesSlots(candidate);
  return team.some(member => getPvpSpeciesSlots(member).some(id => candidateSlots.includes(id)));
}

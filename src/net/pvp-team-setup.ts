/**
 * Constructs live battle {@linkcode PlayerPokemon}/{@linkcode EnemyPokemon} instances from the
 * {@linkcode PvpPartyMemberDto}s exchanged over the network, and installs them as the current
 * PvP match's parties.
 *
 * This is the piece that turns a `BATTLE_START` message into Pokemon the existing battle engine
 * can actually act on - see docs/pvp-online-battle-design.md §5 ("what each side needs to know")
 * and §9 (MVP step 5).
 * @module
 */

import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import type { MoveId } from "#enums/move-id";
import type { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { type EnemyPokemon, PlayerPokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import type { PvpPartyMemberDto } from "#net/pvp-protocol-types";

/**
 * Generate a fully-determined {@linkcode PvpPartyMemberDto} for `species`/`level`/`moves`.
 *
 * Constructs a throwaway {@linkcode PlayerPokemon} purely to let the existing battle engine roll
 * its usual random identity (IVs, ability, form, gender, shininess/variant, nature, id) exactly
 * once, then captures those values into the DTO so they can be sent to the opponent and applied
 * identically on both clients (see {@linkcode buildPlayerPokemon}/{@linkcode buildEnemyPokemon}
 * below - this is the R1 determinism fix, docs/pvp-online-battle-design.md).
 *
 * The sample Pokemon is never summoned or added to the scene - it exists only to read these
 * fields back off of, and is discarded immediately afterward.
 */
export function generatePvpPartyMemberDto(species: SpeciesId, level: number, moves: MoveId[]): PvpPartyMemberDto {
  const speciesForm = speciesDataRegistry.getSpecies(species);
  const sample = new PlayerPokemon(speciesForm, level);
  return {
    species,
    level,
    moves,
    id: sample.id,
    abilityIndex: sample.abilityIndex,
    formIndex: sample.formIndex,
    gender: sample.gender,
    shiny: sample.shiny,
    variant: sample.variant,
    ivs: [...sample.ivs],
    nature: sample.nature,
  };
}

/**
 * Overwrite `pokemon`'s randomly-generated identity with the explicit values carried by `dto`,
 * then recompute `stats`/`hp` to match - so that both clients end up with byte-for-byte identical
 * Pokemon for the same DTO, regardless of what each client's own construction happened to roll.
 */
function applyDeterministicIdentity(pokemon: PlayerPokemon | EnemyPokemon, dto: PvpPartyMemberDto): void {
  pokemon.id = dto.id;
  pokemon.abilityIndex = dto.abilityIndex;
  pokemon.formIndex = dto.formIndex;
  pokemon.gender = dto.gender;
  pokemon.shiny = dto.shiny;
  pokemon.variant = dto.variant;
  pokemon.ivs = [...dto.ivs];
  // `setNature` also recalculates `stats`/`hp`, which must happen after every other identity
  // field above has already been overwritten.
  pokemon.setNature(dto.nature);
}

function buildPlayerPokemon(dto: PvpPartyMemberDto): PlayerPokemon {
  const species = speciesDataRegistry.getSpecies(dto.species);
  const pokemon = globalScene.addPlayerPokemon(species, dto.level);
  applyDeterministicIdentity(pokemon, dto);
  pokemon.moveset = dto.moves.map(moveId => new PokemonMove(moveId));
  return pokemon;
}

function buildEnemyPokemon(dto: PvpPartyMemberDto): EnemyPokemon {
  const species = speciesDataRegistry.getSpecies(dto.species);
  const pokemon = globalScene.addEnemyPokemon(species, dto.level, TrainerSlot.NONE);
  applyDeterministicIdentity(pokemon, dto);
  pokemon.moveset = dto.moves.map(moveId => new PokemonMove(moveId));
  return pokemon;
}

/**
 * Build and install both sides' parties for a PvP match.
 * @param myTeam - This client's own team, exactly as it was submitted via `SUBMIT_TEAM`
 * @param opponentTeam - The opponent's team, as relayed by the server in `BATTLE_START`
 * @remarks
 * Must be called after {@linkcode BattleScene.newPvpBattle}, since it relies on
 * `globalScene.currentBattle` already existing.
 */
export function setUpPvpParty(myTeam: PvpPartyMemberDto[], opponentTeam: PvpPartyMemberDto[]): void {
  globalScene.setPvpParty(myTeam.map(buildPlayerPokemon));
  globalScene.currentBattle.enemyParty = opponentTeam.map(buildEnemyPokemon);
}

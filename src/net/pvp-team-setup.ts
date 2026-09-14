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
import { TrainerSlot } from "#enums/trainer-slot";
import type { EnemyPokemon, PlayerPokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import type { PvpPartyMemberDto } from "#net/pvp-protocol-types";

function buildPlayerPokemon(dto: PvpPartyMemberDto): PlayerPokemon {
  const species = speciesDataRegistry.getSpecies(dto.species);
  const pokemon = globalScene.addPlayerPokemon(species, dto.level);
  pokemon.moveset = dto.moves.map(moveId => new PokemonMove(moveId));
  return pokemon;
}

function buildEnemyPokemon(dto: PvpPartyMemberDto): EnemyPokemon {
  const species = speciesDataRegistry.getSpecies(dto.species);
  const pokemon = globalScene.addEnemyPokemon(species, dto.level, TrainerSlot.NONE);
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

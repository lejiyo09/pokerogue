import { SpeciesId } from "#enums/species-id";
import { PVP_BATTLE_LEVEL, pvpPartyMemberDtoFromBankedPokemon } from "#net/pvp-team-setup";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("pvpPartyMemberDtoFromBankedPokemon", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("preserves the individual's actual identity, overriding only its level", async () => {
    const game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const data = new PokemonData(game.scene.getPlayerParty()[0]);

    const dto = pvpPartyMemberDtoFromBankedPokemon(data, PVP_BATTLE_LEVEL);

    expect(dto.species).toBe(data.species);
    expect(dto.level).toBe(PVP_BATTLE_LEVEL);
    expect(dto.id).toBe(data.id);
    expect(dto.abilityIndex).toBe(data.abilityIndex);
    expect(dto.formIndex).toBe(data.formIndex);
    expect(dto.gender).toBe(data.gender);
    expect(dto.shiny).toBe(data.shiny);
    expect(dto.variant).toBe(data.variant);
    expect(dto.ivs).toEqual(data.ivs);
    expect(dto.nature).toBe(data.nature);
    expect(dto.moves).toEqual(data.moveset.map(move => move.moveId));
  });
});

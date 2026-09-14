import { globalScene } from "#app/global-scene";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { generatePvpPartyMemberDto, setUpPvpParty } from "#net/pvp-team-setup";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("PvP - determinism (R1)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    new GameManager(phaserGame);
  });

  it("generatePvpPartyMemberDto captures a fully-determined identity", () => {
    const dto = generatePvpPartyMemberDto(SpeciesId.PIKACHU, 50, [MoveId.THUNDERBOLT]);

    expect(dto.species).toBe(SpeciesId.PIKACHU);
    expect(dto.level).toBe(50);
    expect(dto.ivs).toHaveLength(6);
    for (const iv of dto.ivs) {
      expect(iv).toBeGreaterThanOrEqual(0);
      expect(iv).toBeLessThanOrEqual(31);
    }
    expect(Number.isInteger(dto.id)).toBe(true);
    expect(Number.isInteger(dto.abilityIndex)).toBe(true);
    expect(Number.isInteger(dto.formIndex)).toBe(true);
    expect(Number.isInteger(dto.gender)).toBe(true);
    expect(typeof dto.shiny).toBe("boolean");
    expect(Number.isInteger(dto.variant)).toBe(true);
    expect(Number.isInteger(dto.nature)).toBe(true);
  });

  it("building the same DTO as a PlayerPokemon and as an EnemyPokemon produces identical core identity and stats", () => {
    // One player's own Pokemon (`myTeam`) is built as a `PlayerPokemon` on their own client, but
    // as an `EnemyPokemon` on the opponent's client - both from the exact same DTO relayed over
    // the network. Without R1, each construction path would roll its own random IVs/ability/etc,
    // silently desyncing the two clients' view of this Pokemon.
    const dto = generatePvpPartyMemberDto(SpeciesId.CHARIZARD, 78, [MoveId.FLAMETHROWER, MoveId.DRAGON_CLAW]);

    globalScene.newPvpBattle("deterministic-test-seed", false);
    setUpPvpParty([dto], [dto]);

    const asPlayerPokemon = globalScene.getPlayerParty()[0];
    const asEnemyPokemon = globalScene.currentBattle.enemyParty[0];

    expect(asPlayerPokemon).toBeDefined();
    expect(asEnemyPokemon).toBeDefined();

    expect(asPlayerPokemon.id).toBe(asEnemyPokemon.id);
    expect(asPlayerPokemon.id).toBe(dto.id);
    expect(asPlayerPokemon.abilityIndex).toBe(asEnemyPokemon.abilityIndex);
    expect(asPlayerPokemon.abilityIndex).toBe(dto.abilityIndex);
    expect(asPlayerPokemon.formIndex).toBe(asEnemyPokemon.formIndex);
    expect(asPlayerPokemon.gender).toBe(asEnemyPokemon.gender);
    expect(asPlayerPokemon.shiny).toBe(asEnemyPokemon.shiny);
    expect(asPlayerPokemon.variant).toBe(asEnemyPokemon.variant);
    expect(asPlayerPokemon.nature).toBe(asEnemyPokemon.nature);
    expect(asPlayerPokemon.ivs).toEqual(asEnemyPokemon.ivs);
    expect(asPlayerPokemon.ivs).toEqual(dto.ivs);

    // The identity fields above are what `calculateStats()` derives `stats`/`getMaxHp()` from -
    // if they truly match, the derived values must match too.
    expect(asPlayerPokemon.stats).toEqual(asEnemyPokemon.stats);
    expect(asPlayerPokemon.getMaxHp()).toBe(asEnemyPokemon.getMaxHp());
  });

  it("two DTOs generated for the same species/level are not forced to collide (sanity check on randomness source)", () => {
    // Not a strict requirement of R1, but guards against a degenerate "always returns the same
    // values" implementation slipping through.
    const dtoA = generatePvpPartyMemberDto(SpeciesId.EEVEE, 30, [MoveId.TACKLE]);
    const dtoB = generatePvpPartyMemberDto(SpeciesId.EEVEE, 30, [MoveId.TACKLE]);
    const identical =
      dtoA.id === dtoB.id
      && dtoA.abilityIndex === dtoB.abilityIndex
      && dtoA.gender === dtoB.gender
      && dtoA.nature === dtoB.nature
      && dtoA.ivs.every((v, i) => v === dtoB.ivs[i]);
    expect(identical).toBe(false);
  });
});

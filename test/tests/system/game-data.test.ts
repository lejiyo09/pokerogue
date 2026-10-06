import { pokerogueApi } from "#api/api";
import * as account from "#app/account";
import { VALUE_REDUCTION_MAX } from "#app/constants";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import * as appConstants from "#constants/app-constants";
import { MAX_STARTER_CANDY_COUNT } from "#constants/game-constants";
import { AbilityAttr } from "#enums/ability-attr";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { Passive } from "#enums/passive";
import { GameManager } from "#test/framework/game-manager";
import type { SessionSaveData } from "#types/save-data";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("System - Game Data", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .moveset([MoveId.SPLASH])
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  describe("tryClearSession", () => {
    beforeEach(() => {
      vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(false);
      vi.spyOn(game.scene.gameData, "getSessionSaveData").mockReturnValue({} as SessionSaveData);
      vi.spyOn(account, "updateUserInfo").mockImplementation(async () => [true, 1]);
    });

    it("should return [true, true] if bypassLogin is true", async () => {
      vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(true);

      const result = await game.scene.gameData.tryClearSession(0);

      expect(result).toEqual([true, true]);
    });

    it("should return [true, true] if successful", async () => {
      vi.spyOn(pokerogueApi.savedata.session, "clear").mockResolvedValue({
        success: true,
      });

      const result = await game.scene.gameData.tryClearSession(0);

      expect(result).toEqual([true, true]);
      expect(account.updateUserInfo).toHaveBeenCalled();
    });

    it("should return [true, false] if not successful", async () => {
      vi.spyOn(pokerogueApi.savedata.session, "clear").mockResolvedValue({
        success: false,
      });

      const result = await game.scene.gameData.tryClearSession(0);

      expect(result).toEqual([true, false]);
      expect(account.updateUserInfo).toHaveBeenCalled();
    });

    it("should return [false, false] session is out of date", async () => {
      vi.spyOn(pokerogueApi.savedata.session, "clear").mockResolvedValue({
        error: "session out of date",
      });

      const result = await game.scene.gameData.tryClearSession(0);

      expect(result).toEqual([false, false]);
      expect(account.updateUserInfo).toHaveBeenCalled();
    });
  });

  describe("unlockEverythingForCheats", () => {
    it("marks every species as seen/caught with max IVs recorded", () => {
      game.scene.gameData.unlockEverythingForCheats();

      for (const species of speciesDataRegistry.getAllSpecies()) {
        const dexEntry = game.scene.gameData.dexData[species.speciesId];
        expect(dexEntry.caughtAttr, `caughtAttr for species ${species.speciesId}`).not.toBe(0n);
        expect(dexEntry.seenAttr, `seenAttr for species ${species.speciesId}`).not.toBe(0n);
        expect(dexEntry.ivs, `ivs for species ${species.speciesId}`).toEqual([31, 31, 31, 31, 31, 31]);
      }
    });

    it("maxes out every starter's candy, abilities, passive, and cost reduction", () => {
      game.scene.gameData.unlockEverythingForCheats();

      for (const species of speciesDataRegistry.getAllStarters(true)) {
        const starterEntry = game.scene.gameData.starterData[species.speciesId];
        expect(starterEntry.candyCount, `candyCount for species ${species.speciesId}`).toBe(MAX_STARTER_CANDY_COUNT);
        expect(starterEntry.abilityAttr, `abilityAttr for species ${species.speciesId}`).toBe(
          AbilityAttr.ABILITY_1 | AbilityAttr.ABILITY_2 | AbilityAttr.ABILITY_HIDDEN,
        );
        expect(starterEntry.passiveAttr, `passiveAttr for species ${species.speciesId}`).toBe(
          Passive.UNLOCKED | Passive.ENABLED,
        );
        expect(starterEntry.valueReduction, `valueReduction for species ${species.speciesId}`).toBe(
          VALUE_REDUCTION_MAX,
        );
      }
    });
  });
});

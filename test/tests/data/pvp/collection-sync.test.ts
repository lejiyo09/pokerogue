import { pokerogueApi } from "#api/api";
import * as appConstants from "#constants/app-constants";
import { resetPvpCollectionSyncState, syncPvpCollection } from "#data/pvp/collection-sync";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("PvP Collection Sync", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    resetPvpCollectionSyncState();
    vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(false);
  });

  it("should do nothing when bypassLogin is true", async () => {
    vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(true);
    const upsertSpy = vi.spyOn(pokerogueApi.pvpCollection, "upsert");

    await game.classicMode.startBattle(SpeciesId.RATTATA);
    await syncPvpCollection();

    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("should upsert every current party member the first time it runs", async () => {
    const upsertSpy = vi.spyOn(pokerogueApi.pvpCollection, "upsert").mockResolvedValue(true);

    await game.classicMode.startBattle(SpeciesId.RATTATA);
    await syncPvpCollection();

    expect(upsertSpy).toHaveBeenCalledOnce();
    const { entries } = upsertSpy.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    expect(entries[0].uid).toBe(String(game.scene.getPlayerParty()[0].id));
  });

  it("should not re-upsert a party member that was already successfully synced", async () => {
    const upsertSpy = vi.spyOn(pokerogueApi.pvpCollection, "upsert").mockResolvedValue(true);

    await game.classicMode.startBattle(SpeciesId.RATTATA);
    await syncPvpCollection();
    await syncPvpCollection();

    expect(upsertSpy).toHaveBeenCalledOnce();
  });

  it("should retry a party member on the next call if the previous upsert failed", async () => {
    const upsertSpy = vi.spyOn(pokerogueApi.pvpCollection, "upsert").mockResolvedValueOnce(false);

    await game.classicMode.startBattle(SpeciesId.RATTATA);
    await syncPvpCollection();
    upsertSpy.mockResolvedValueOnce(true);
    await syncPvpCollection();

    expect(upsertSpy).toHaveBeenCalledTimes(2);
  });
});

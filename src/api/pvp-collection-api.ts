import { ApiBase } from "#api/api-base";
import type { GetPvpCollectionResponse, UpsertPvpCollectionRequest } from "#types/api";

/** A wrapper for PokéRogue PvP Global Pokémon Collection API requests. */
export class PokeroguePvpCollectionApi extends ApiBase {
  /**
   * Get every individual banked in the logged-in account's PvP Global Pokémon Collection.
   * @returns The banked individuals, or `null` if the request failed.
   */
  public async get(): Promise<GetPvpCollectionResponse | null> {
    try {
      const response = await this.doGet("/pvp/collection");
      if (!response.ok) {
        console.warn(`Could not get PvP collection! (${response.status}: ${response.statusText})`);
        return null;
      }
      return (await response.json()) as GetPvpCollectionResponse;
    } catch (err) {
      console.warn("Could not get PvP collection!", err);
      return null;
    }
  }

  /**
   * Bank new or updated individuals into the logged-in account's PvP Global Pokémon Collection.
   * An entry whose `uid` is already banked is overwritten, never duplicated.
   * @param bodyData - The {@linkcode UpsertPvpCollectionRequest} to send
   * @returns Whether the request succeeded.
   */
  public async upsert(bodyData: UpsertPvpCollectionRequest): Promise<boolean> {
    try {
      const response = await this.doPost("/pvp/collection", bodyData);
      if (!response.ok) {
        console.warn(`Could not update PvP collection! (${response.status}: ${response.statusText})`);
      }
      return response.ok;
    } catch (err) {
      console.warn("Could not update PvP collection!", err);
      return false;
    }
  }
}

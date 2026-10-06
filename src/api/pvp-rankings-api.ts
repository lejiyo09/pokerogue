import { ApiBase } from "#api/api-base";
import type { GetPvpRankingsRequest, GetPvpRankingsResponse } from "#types/api";

/** A wrapper for PokéRogue PvP lobby ranking API requests. */
export class PokeroguePvpRankingsApi extends ApiBase {
  /**
   * Get one page of the PvP lobby's ranking list.
   * @param params - The {@linkcode GetPvpRankingsRequest} to send
   * @returns The requested page of rankings, or `null` if the request failed.
   */
  public async get(params: GetPvpRankingsRequest = {}): Promise<GetPvpRankingsResponse | null> {
    try {
      const urlSearchParams = this.toUrlSearchParams(params);
      const response = await this.doGet(`/pvp/rankings?${urlSearchParams}`);
      if (!response.ok) {
        console.warn(`Could not get PvP rankings! (${response.status}: ${response.statusText})`);
        return null;
      }
      return (await response.json()) as GetPvpRankingsResponse;
    } catch (err) {
      console.warn("Could not get PvP rankings!", err);
      return null;
    }
  }

  /**
   * Get the total number of pages {@linkcode get} can return.
   * @returns The page count, or `null` if the request failed.
   */
  public async getPageCount(): Promise<number | null> {
    try {
      const response = await this.doGet("/pvp/rankingpagecount");
      if (!response.ok) {
        console.warn(`Could not get PvP ranking page count! (${response.status}: ${response.statusText})`);
        return null;
      }
      const count = Number.parseInt(await response.text(), 10);
      return Number.isNaN(count) ? null : count;
    } catch (err) {
      console.warn("Could not get PvP ranking page count!", err);
      return null;
    }
  }
}

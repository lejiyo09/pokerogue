import { PokeroguePvpRankingsApi } from "#api/pvp-rankings-api";
import { initServerForApiTests } from "#test/setup/test-file-initialization";
import { getApiBaseUrl } from "#test/utils/test-utils";
import type { GetPvpRankingsResponse } from "#types/api";
import { HttpResponse, http } from "msw";
import type { SetupServer } from "msw/node";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const apiBase = getApiBaseUrl();
const pvpRankingsApi = new PokeroguePvpRankingsApi(apiBase);

let server: SetupServer;
beforeAll(async () => {
  server = await initServerForApiTests();
});

afterEach(() => {
  server.resetHandlers();
});

describe("Pokerogue PvP Rankings API", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn");
  });

  describe("Get", () => {
    it("should return a page of rankings on SUCCESS", async () => {
      const response: GetPvpRankingsResponse = [{ rank: 1, username: "trainer", wins: 10, losses: 2 }];
      server.use(http.get(`${apiBase}/pvp/rankings`, () => HttpResponse.json(response)));

      const result = await pvpRankingsApi.get({ page: 2 });

      expect(result).toEqual(response);
    });

    it("should return null and report a warning on a non-OK response", async () => {
      server.use(http.get(`${apiBase}/pvp/rankings`, () => new HttpResponse(null, { status: 500 })));

      const result = await pvpRankingsApi.get();

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalled();
    });

    it("should return null and report a warning on ERROR", async () => {
      server.use(http.get(`${apiBase}/pvp/rankings`, () => HttpResponse.error()));

      const result = await pvpRankingsApi.get();

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith("Could not get PvP rankings!", expect.any(Error));
    });
  });

  describe("GetPageCount", () => {
    it("should return the parsed page count on SUCCESS", async () => {
      server.use(http.get(`${apiBase}/pvp/rankingpagecount`, () => HttpResponse.text("3")));

      const count = await pvpRankingsApi.getPageCount();

      expect(count).toBe(3);
    });

    it("should return null and report a warning on a non-OK response", async () => {
      server.use(http.get(`${apiBase}/pvp/rankingpagecount`, () => new HttpResponse(null, { status: 500 })));

      const count = await pvpRankingsApi.getPageCount();

      expect(count).toBeNull();
      expect(console.warn).toHaveBeenCalled();
    });

    it("should return null and report a warning on ERROR", async () => {
      server.use(http.get(`${apiBase}/pvp/rankingpagecount`, () => HttpResponse.error()));

      const count = await pvpRankingsApi.getPageCount();

      expect(count).toBeNull();
      expect(console.warn).toHaveBeenCalledWith("Could not get PvP ranking page count!", expect.any(Error));
    });
  });
});

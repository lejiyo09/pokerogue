import { PokeroguePvpCollectionApi } from "#api/pvp-collection-api";
import { initServerForApiTests } from "#test/setup/test-file-initialization";
import { getApiBaseUrl } from "#test/utils/test-utils";
import type { BankedPokemon, GetPvpCollectionResponse, UpsertPvpCollectionRequest } from "#types/api";
import { HttpResponse, http } from "msw";
import type { SetupServer } from "msw/node";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const apiBase = getApiBaseUrl();
const pvpCollectionApi = new PokeroguePvpCollectionApi(apiBase);

let server: SetupServer;
beforeAll(async () => {
  server = await initServerForApiTests();
});

afterEach(() => {
  server.resetHandlers();
});

describe("Pokerogue PvP Collection API", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn");
  });

  describe("Get", () => {
    it("should return the banked individuals on SUCCESS", async () => {
      const response: GetPvpCollectionResponse = [
        { uid: "a", data: {} as BankedPokemon["data"], originRunSeed: "seed", originTimestamp: 0, pveLevel: 42 },
      ];
      server.use(http.get(`${apiBase}/pvp/collection`, () => HttpResponse.json(response)));

      const result = await pvpCollectionApi.get();

      expect(result).toEqual(response);
    });

    it("should return null and report a warning on a non-OK response", async () => {
      server.use(http.get(`${apiBase}/pvp/collection`, () => new HttpResponse(null, { status: 401 })));

      const result = await pvpCollectionApi.get();

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalled();
    });

    it("should return null and report a warning on ERROR", async () => {
      server.use(http.get(`${apiBase}/pvp/collection`, () => HttpResponse.error()));

      const result = await pvpCollectionApi.get();

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith("Could not get PvP collection!", expect.any(Error));
    });
  });

  describe("Upsert", () => {
    const request: UpsertPvpCollectionRequest = {
      entries: [
        { uid: "a", data: {} as BankedPokemon["data"], originRunSeed: "seed", originTimestamp: 0, pveLevel: 42 },
      ],
    };

    it("should return true on SUCCESS", async () => {
      server.use(http.post(`${apiBase}/pvp/collection`, () => new HttpResponse(null, { status: 200 })));

      const success = await pvpCollectionApi.upsert(request);

      expect(success).toBe(true);
    });

    it("should return false and report a warning on a non-OK response", async () => {
      server.use(http.post(`${apiBase}/pvp/collection`, () => new HttpResponse("bad request", { status: 400 })));

      const success = await pvpCollectionApi.upsert(request);

      expect(success).toBe(false);
      expect(console.warn).toHaveBeenCalled();
    });

    it("should return false and report a warning on ERROR", async () => {
      server.use(http.post(`${apiBase}/pvp/collection`, () => HttpResponse.error()));

      const success = await pvpCollectionApi.upsert(request);

      expect(success).toBe(false);
      expect(console.warn).toHaveBeenCalledWith("Could not update PvP collection!", expect.any(Error));
    });
  });
});

import { conflictsWithPvpTeam, getPvpSpeciesSlots } from "#data/pvp/species-clause";
import { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

describe("PvP Species Clause", () => {
  describe("getPvpSpeciesSlots", () => {
    it("should return a single slot for a non-fused individual", () => {
      expect(getPvpSpeciesSlots({ species: SpeciesId.CHARIZARD })).toEqual([SpeciesId.CHARIZARD]);
    });

    it("should ignore formIndex - a mega/form-changed individual still resolves to its base species", () => {
      // Mega Charizard X/Y and Black/White Kyurem are formIndex variants of the same
      // SpeciesId in this codebase, so the resolver never needs to look at formIndex.
      expect(getPvpSpeciesSlots({ species: SpeciesId.CHARIZARD })).toEqual([SpeciesId.CHARIZARD]);
      expect(getPvpSpeciesSlots({ species: SpeciesId.KYUREM })).toEqual([SpeciesId.KYUREM]);
    });

    it("should return two slots for a fused individual - its own species and its fusion species", () => {
      expect(getPvpSpeciesSlots({ species: SpeciesId.CHARIZARD, fusionSpecies: SpeciesId.BLASTOISE })).toEqual([
        SpeciesId.CHARIZARD,
        SpeciesId.BLASTOISE,
      ]);
    });

    it("should treat a falsy fusionSpecies as not fused", () => {
      expect(getPvpSpeciesSlots({ species: SpeciesId.CHARIZARD, fusionSpecies: null })).toEqual([SpeciesId.CHARIZARD]);
    });
  });

  describe("conflictsWithPvpTeam", () => {
    it("should not conflict with an empty team", () => {
      expect(conflictsWithPvpTeam({ species: SpeciesId.CHARIZARD }, [])).toBe(false);
    });

    it("should not conflict with a team of different species", () => {
      const team = [{ species: SpeciesId.BLASTOISE }, { species: SpeciesId.VENUSAUR }];
      expect(conflictsWithPvpTeam({ species: SpeciesId.CHARIZARD }, team)).toBe(false);
    });

    it("should conflict when the same species is already on the team", () => {
      const team = [{ species: SpeciesId.CHARIZARD }];
      expect(conflictsWithPvpTeam({ species: SpeciesId.CHARIZARD }, team)).toBe(true);
    });

    it("should treat regional forms as distinct species (no conflict)", () => {
      // Alolan/Galarian forms are separate SpeciesId values in this codebase (design decision:
      // docs/pvp-progression-design.md §2.6), so a base-form and regional-form pair never conflicts.
      const team = [{ species: SpeciesId.MEOWTH }];
      expect(conflictsWithPvpTeam({ species: SpeciesId.ALOLA_MEOWTH }, team)).toBe(false);
    });

    it("should conflict when a candidate's fusionSpecies matches a team member's species", () => {
      const team = [{ species: SpeciesId.BLASTOISE }];
      const candidate = { species: SpeciesId.CHARIZARD, fusionSpecies: SpeciesId.BLASTOISE };
      expect(conflictsWithPvpTeam(candidate, team)).toBe(true);
    });

    it("should conflict when a team member's fusionSpecies matches the candidate's species", () => {
      const team = [{ species: SpeciesId.CHARIZARD, fusionSpecies: SpeciesId.BLASTOISE }];
      expect(conflictsWithPvpTeam({ species: SpeciesId.BLASTOISE }, team)).toBe(true);
    });
  });
});

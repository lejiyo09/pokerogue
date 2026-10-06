import {
  createPvpTeamBuilderState,
  deselect,
  isFull,
  isSelectable,
  PVP_TEAM_SIZE,
  select,
} from "#data/pvp/team-builder";
import { SpeciesId } from "#enums/species-id";
import type { BankedPokemon } from "#types/api";
import { describe, expect, it } from "vitest";

function banked(uid: string, species: SpeciesId, fusionSpecies?: SpeciesId): BankedPokemon {
  return {
    uid,
    data: { species, fusionSpecies } as BankedPokemon["data"],
    originRunSeed: "seed",
    originTimestamp: 0,
    pveLevel: 50,
  };
}

describe("PvP Team Builder", () => {
  const charizardA = banked("a", SpeciesId.CHARIZARD);
  const charizardB = banked("b", SpeciesId.CHARIZARD);
  const blastoise = banked("c", SpeciesId.BLASTOISE);
  const pool = [charizardA, charizardB, blastoise];

  describe("isSelectable", () => {
    it("should be true for any untaken candidate on an empty team", () => {
      const state = createPvpTeamBuilderState(pool);
      expect(isSelectable(state, "a")).toBe(true);
      expect(isSelectable(state, "c")).toBe(true);
    });

    it("should be false for a candidate not in the pool", () => {
      const state = createPvpTeamBuilderState(pool);
      expect(isSelectable(state, "does-not-exist")).toBe(false);
    });

    it("should be false for a candidate already selected", () => {
      const state = select(createPvpTeamBuilderState(pool), "a");
      expect(isSelectable(state, "a")).toBe(false);
    });

    it("should be false for a same-species candidate once one is selected (Species Clause)", () => {
      const state = select(createPvpTeamBuilderState(pool), "a");
      expect(isSelectable(state, "b")).toBe(false);
      expect(isSelectable(state, "c")).toBe(true);
    });

    it("should be false for any candidate once the team is full", () => {
      const bigPool = Array.from({ length: PVP_TEAM_SIZE }, (_, i) => banked(`p${i}`, i as SpeciesId));
      let state = createPvpTeamBuilderState(bigPool);
      for (const p of bigPool) {
        state = select(state, p.uid);
      }
      expect(isFull(state)).toBe(true);
      expect(isSelectable(state, "a")).toBe(false);
    });
  });

  describe("select", () => {
    it("should add a selectable candidate to selected", () => {
      const state = select(createPvpTeamBuilderState(pool), "a");
      expect(state.selected.map(p => p.uid)).toEqual(["a"]);
    });

    it("should be a no-op if the candidate is not selectable", () => {
      const state = select(createPvpTeamBuilderState(pool), "a");
      const next = select(state, "b");
      expect(next).toBe(state);
    });
  });

  describe("deselect", () => {
    it("should remove a selected candidate, freeing its species slot", () => {
      let state = select(createPvpTeamBuilderState(pool), "a");
      state = deselect(state, "a");
      expect(state.selected).toHaveLength(0);
      expect(isSelectable(state, "b")).toBe(true);
    });

    it("should be a no-op for a candidate that wasn't selected", () => {
      const state = createPvpTeamBuilderState(pool);
      const next = deselect(state, "a");
      expect(next.selected).toEqual(state.selected);
    });
  });
});

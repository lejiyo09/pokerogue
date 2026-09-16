import { pokerogueApi } from "#api/api";
import { globalScene } from "#app/global-scene";
import { bypassLogin } from "#constants/app-constants";
import { PokemonData } from "#system/pokemon-data";
import type { BankedPokemon } from "#types/api";

/**
 * IDs (see {@linkcode PokemonData.id}) of party members already banked into
 * the PvP Global Pokémon Collection during the current game session.
 * @remarks
 * Tracked purely as a client-side optimization to avoid re-uploading an
 * individual on every autosave when the party hasn't actually changed - the
 * server's upsert-by-`uid` semantics mean re-sending an already-banked
 * individual is harmless, just wasted bandwidth.
 */
let bankedPartyMemberIds = new Set<number>();

/** Resets the sync tracking above - call when starting/loading into a fresh game session. */
export function resetPvpCollectionSyncState(): void {
  bankedPartyMemberIds = new Set();
}

/**
 * Banks any player party member not yet synced this session into the PvP
 * Global Pokémon Collection.
 * @remarks
 * Intended to be called from {@linkcode GameData.saveAll} - the existing
 * single save chokepoint that already serializes the current party on every
 * autosave - implementing the "sync on PvE party change" banking trigger.
 * @see `docs/pvp-progression-design.md` §2.2 for the design this implements.
 */
export async function syncPvpCollection(): Promise<void> {
  if (bypassLogin) {
    return;
  }

  const party = globalScene.getPlayerParty();
  const newMembers = party.filter(pokemon => !bankedPartyMemberIds.has(pokemon.id));
  if (newMembers.length === 0) {
    return;
  }

  const originTimestamp = Date.now();
  const entries: BankedPokemon[] = newMembers.map(pokemon => ({
    uid: String(pokemon.id),
    data: new PokemonData(pokemon),
    originRunSeed: globalScene.seed,
    originTimestamp,
    pveLevel: pokemon.level,
  }));

  const success = await pokerogueApi.pvpCollection.upsert({ entries });
  if (!success) {
    // Leave the failed members untracked so the next saveAll() retries them.
    return;
  }

  for (const pokemon of newMembers) {
    bankedPartyMemberIds.add(pokemon.id);
  }
}

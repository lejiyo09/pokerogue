import "#app/extensions"; // Setup Phaser extension methods/etc

import { initAbilities } from "#abilities/init-abilities";
import { initGlobalAudioManager } from "#app/global-audio-manager";
import { initSettingsManager } from "#app/global-settings-manager";
import { initChallenges } from "#data/challenge";
import { initTrainerTypeDialogue } from "#data/dialogue";
import { initSpeciesDataRegistry } from "#data/species-data-registry";
import { initBiomeBgmLoopPoints } from "#init/init-biome-bgm-loop-points";
import { initBiomeDepths } from "#init/init-biome-depths";
import { initBiomes } from "#init/init-biomes";
import { initCatchableSpecies } from "#init/init-catchable-species";
import { initStarterColors } from "#init/init-starter-colors";
import { initModifierPools } from "#modifiers/init-modifier-pools";
import { initModifierTypes } from "#modifiers/modifier-type";
import { initMoves } from "#moves/move";
import { initMysteryEncounters } from "#mystery-encounters/mystery-encounter-biomes";
import { initAchievements } from "#system/achv";
import { initVouchers } from "#system/voucher";
import { initStatsKeys } from "#ui/game-stats-ui-handler";

/**
 * Yields control back to the browser's event loop (a macrotask via `setTimeout`, so it also lets
 * a paint happen, unlike a microtask).
 * @remarks
 * Several of the steps in {@linkcode initializeGame} construct large in-memory object graphs
 * (the full species/move/ability data set) synchronously. Without yielding between them, all of
 * that work runs as one uninterrupted block on the main thread - on slow hardware, this reads as
 * the whole page/tab hanging right as the loading screen hits 100%, since nothing can render or
 * respond to input until the block finishes. This doesn't reduce the total work, just breaks it
 * into chunks so the browser can breathe (and the loading screen can keep animating) between them.
 */
function yieldToMainThread(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export async function initializeGame(): Promise<void> {
  await initStarterColors();
  initBiomeBgmLoopPoints();
  await initSettingsManager();
  await yieldToMainThread();
  initSpeciesDataRegistry();
  await initGlobalAudioManager();
  await yieldToMainThread();
  initModifierTypes();
  initModifierPools();
  initAchievements();
  initVouchers();
  initStatsKeys();
  initBiomes();
  initCatchableSpecies();
  initBiomeDepths();
  initTrainerTypeDialogue();
  await yieldToMainThread();
  initMoves();
  await yieldToMainThread();
  initAbilities();
  await yieldToMainThread();
  initChallenges();
  initMysteryEncounters();
}

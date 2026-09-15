import { globalScene } from "#app/global-scene";
import { getLevelTotalExp } from "#data/exp";
import { getNatureName } from "#data/nature";
import { Nature } from "#enums/nature";
import { PartyUiMode } from "#enums/party-ui-mode";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import type { OptionSelectItem, OptionSelectModeConfig } from "#types/ui-types";
import type { PartyOption } from "#ui/party-ui-handler";

/**
 * Opens the "Cheats" menu reachable from the pause menu's community submenu
 * (see menu-ui-handler.ts) - only for the account with
 * `loggedInUser.cheatsEnabled` (see rogueserver's `cheatAccountEmail`).
 * @param yOffset - Vertical position, matching the community submenu's own options.
 */
export function showCheatMenu(yOffset: number): void {
  const { ui } = globalScene;

  const options: OptionSelectItem[] = [
    {
      label: "Unlock All Pokémon",
      handler: () => {
        ui.playSelect();
        unlockAllPokemon();
        return true;
      },
      keepOpen: true,
    },
    {
      label: "Edit Party Pokémon",
      handler: () => {
        ui.playSelect();
        selectPartyPokemonToEdit();
        return true;
      },
      keepOpen: true,
    },
    {
      label: "Cancel",
      handler: () => {
        ui.revertMode();
        return true;
      },
    },
  ];

  const optionSelectConfig: OptionSelectModeConfig = { options, yOffset };
  ui.setOverlayMode(UiMode.OPTION_SELECT, optionSelectConfig);
}

async function unlockAllPokemon(): Promise<void> {
  globalScene.gameData.unlockEverythingForCheats();
  await globalScene.gameData.saveSystem();
  globalScene.ui.setMode(UiMode.ALERT_MODAL, "Every Pokémon is now unlocked!", 500);
}

function selectPartyPokemonToEdit(): void {
  const { ui } = globalScene;
  const modeToReturnTo = ui.mode;

  ui.setMode(UiMode.PARTY, PartyUiMode.SELECT, -1, async (slotIndex: number, _option: PartyOption) => {
    await ui.setMode(modeToReturnTo);

    const party = globalScene.getPlayerParty();
    if (slotIndex >= party.length) {
      return;
    }

    showEditOptionsFor(party[slotIndex]);
  });
}

function showEditOptionsFor(pokemon: PlayerPokemon): void {
  const { ui } = globalScene;

  const options: OptionSelectItem[] = [
    {
      label: "Set Level",
      handler: () => {
        ui.playSelect();
        ui.setOverlayMode(UiMode.CHEAT_LEVEL_FORM, {
          buttonActions: [
            async (level: number) => {
              setLevel(pokemon, level);
              await globalScene.gameData.saveAll(true, true);
              ui.revertMode();
              ui.revertMode();
            },
            () => ui.revertMode(),
          ],
        });
        return true;
      },
      keepOpen: true,
    },
    {
      label: "Set Nature",
      handler: () => {
        ui.playSelect();
        showNaturePicker(pokemon);
        return true;
      },
      keepOpen: true,
    },
    {
      label: "Max IVs",
      handler: () => {
        ui.playSelect();
        pokemon.ivs = [31, 31, 31, 31, 31, 31];
        pokemon.calculateStats();
        pokemon.updateInfo();
        globalScene.gameData.saveAll(true, true);
        ui.revertMode();
        return true;
      },
      keepOpen: true,
    },
    {
      label: "Cancel",
      handler: () => {
        ui.revertMode();
        return true;
      },
    },
  ];

  ui.setOverlayMode(UiMode.OPTION_SELECT, { options } satisfies OptionSelectModeConfig);
}

function showNaturePicker(pokemon: PlayerPokemon): void {
  const { ui } = globalScene;

  const options: OptionSelectItem[] = [];
  for (let nature = Nature.HARDY; nature <= Nature.QUIRKY; nature++) {
    options.push({
      label: getNatureName(nature, true, false, true),
      handler: () => {
        ui.playSelect();
        pokemon.setNature(nature);
        pokemon.updateInfo();
        globalScene.gameData.saveAll(true, true);
        ui.revertMode();
        ui.revertMode();
        return true;
      },
    });
  }
  options.push({
    label: "Cancel",
    handler: () => {
      ui.revertMode();
      return true;
    },
  });

  ui.setOverlayMode(UiMode.OPTION_SELECT, { options, maxOptions: 8 } satisfies OptionSelectModeConfig);
}

/** Sets `pokemon`'s level directly (no LevelUpPhase animation), fixes up its exp to match, and heals it to full. */
function setLevel(pokemon: PlayerPokemon, level: number): void {
  pokemon.level = level;
  if (level <= globalScene.getMaxExpLevel(true)) {
    pokemon.exp = getLevelTotalExp(level, pokemon.species.growthRate);
  }
  pokemon.calculateStats();
  pokemon.hp = pokemon.getMaxHp();
  pokemon.status = null;
  pokemon.updateInfo();
}

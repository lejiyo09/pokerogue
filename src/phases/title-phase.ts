import { pokerogueApi } from "#api/api";
import { loggedInUser } from "#app/account";
import { GameMode, getGameMode } from "#app/game-mode";
import { audioManager } from "#app/global-audio-manager";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { activeOverrides } from "#app/overrides";
import { Phase } from "#app/phase";
import { bypassLogin } from "#constants/app-constants";
import { getDailyRunStarters, startDailyEventChallenges } from "#data/daily-run";
import { modifierTypes } from "#data/data-lists";
import { Gender } from "#data/gender";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { Unlockables } from "#enums/unlockables";
import { getBiomeKey } from "#field/arena";
import type { Modifier } from "#modifiers/modifier";
import { getDailyRunStarterModifiers, regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import type { BattleStartMessage, PvpMode, PvpPartyMemberDto } from "#net/pvp-protocol-types";
import { PvpRoomManager } from "#net/pvp-room-manager";
import { getPvpSession, setPvpSession } from "#net/pvp-session";
import { setUpPvpParty } from "#net/pvp-team-setup";
import { vouchers } from "#system/voucher";
import type { OptionSelectItem, OptionSelectModeConfig } from "#types/ui-types";
import { SaveSlotUiMode } from "#ui/save-slot-select-ui-handler";
import { isLocalServerConnected } from "#utils/common";
import i18next from "i18next";

const NO_SAVE_SLOT = -1;

export class TitlePhase extends Phase {
  public readonly phaseName = "TitlePhase";
  private loaded = false;
  // TODO: Make `end` take a `GameModes` as a parameter rather than storing it on the class itself
  public gameMode: GameModes;

  async start(): Promise<void> {
    super.start();

    globalScene.ui.clearText();
    globalScene.ui.fadeIn(250);

    const now = new Date();
    if (now.getMonth() === 11 || (now.getMonth() === 0 && now.getDate() <= 15)) {
      audioManager.playBgm("winter_title", true);
    } else {
      audioManager.playBgm("title", true);
    }

    const lastSlot = await this.checkLastSaveSlot();
    await this.showOptions(lastSlot);
  }

  /**
   * If a user is logged in, check the last save slot they loaded and adjust various variables
   * to account for it.
   * @returns A Promise that resolves with the last loaded session's slot ID.
   * Returns `NO_SAVE_SLOT` if not logged in or no session was found.
   */
  private async checkLastSaveSlot(): Promise<number> {
    if (loggedInUser == null) {
      return NO_SAVE_SLOT;
    }
    try {
      const sessionData = await globalScene.gameData.getSession(loggedInUser.lastSessionSlot);
      if (!sessionData) {
        return NO_SAVE_SLOT;
      }

      globalScene.sessionSlotId = loggedInUser.lastSessionSlot;
      // Set the BG texture to the last save's current biome
      const biomeKey = getBiomeKey(sessionData.arena.biome);
      const bgTexture = `${biomeKey}_bg`;
      await globalScene.loadBiomeAssets(sessionData.arena.biome);
      globalScene.arenaBg.setTexture(bgTexture);
      return loggedInUser.lastSessionSlot;
    } catch (err) {
      console.error(err);
      return NO_SAVE_SLOT;
    }
  }

  private async showOptions(lastSessionSlot: number): Promise<void> {
    const { gameData, ui } = globalScene;
    const options: OptionSelectItem[] = [];
    // Add a "continue" menu if the session slot ID is >-1
    if (lastSessionSlot > NO_SAVE_SLOT) {
      options.push({
        label: i18next.t("continue", { ns: "menu" }),
        handler: () => {
          this.loadSaveSlot(lastSessionSlot);
          return true;
        },
      });
    }
    options.push(
      {
        label: i18next.t("menu:newGame"),
        handler: () => {
          const setModeAndEnd = (gameMode: GameModes) => {
            this.gameMode = gameMode;
            ui.setMode(UiMode.MESSAGE);
            ui.clearText();
            this.end();
          };
          const newGameOptions: OptionSelectItem[] = [];
          newGameOptions.push({
            label: GameMode.getModeName(GameModes.CLASSIC),
            handler: () => {
              setModeAndEnd(GameModes.CLASSIC);
              return true;
            },
          });
          newGameOptions.push({
            label: i18next.t("menu:dailyRun"),
            handler: () => {
              this.initDailyRun();
              return true;
            },
          });
          if (gameData.isUnlocked(Unlockables.ENDLESS_MODE)) {
            newGameOptions.push({
              label: GameMode.getModeName(GameModes.CHALLENGE),
              handler: () => {
                setModeAndEnd(GameModes.CHALLENGE);
                return true;
              },
            });
            newGameOptions.push({
              label: GameMode.getModeName(GameModes.ENDLESS),
              handler: () => {
                setModeAndEnd(GameModes.ENDLESS);
                return true;
              },
            });
            if (gameData.isUnlocked(Unlockables.SPLICED_ENDLESS_MODE)) {
              newGameOptions.push({
                label: GameMode.getModeName(GameModes.SPLICED_ENDLESS),
                handler: () => {
                  setModeAndEnd(GameModes.SPLICED_ENDLESS);
                  return true;
                },
              });
            }
          }
          // Cancel button = back to title
          newGameOptions.push({
            label: i18next.t("menu:cancel"),
            handler: () => {
              globalScene.phaseManager.toTitleScreen();
              super.end();
              return true;
            },
          });
          ui.showText(i18next.t("menu:selectGameMode"), null, () => {
            const config: OptionSelectModeConfig = { options: newGameOptions, yOffset: 48 };
            ui.setOverlayMode(UiMode.OPTION_SELECT, config);
          });
          return true;
        },
      },
      {
        label: i18next.t("menu:loadGame"),
        handler: () => {
          ui.setOverlayMode(UiMode.SAVE_SLOT, SaveSlotUiMode.LOAD, (slotId: number) => {
            if (slotId === NO_SAVE_SLOT) {
              console.warn("Attempted to load save slot of -1 through load game menu!");
              return this.showOptions(slotId);
            }
            this.loadSaveSlot(slotId);
          });
          return true;
        },
      },
      {
        label: i18next.t("menu:runHistory"),
        handler: () => {
          ui.setOverlayMode(UiMode.RUN_HISTORY);
          return true;
        },
        keepOpen: true,
      },
      {
        label: i18next.t("menu:settings"),
        handler: () => {
          ui.setOverlayMode(UiMode.SETTINGS_GENERAL);
          return true;
        },
        keepOpen: true,
      },
      {
        // TODO: Localize once this feature is out of early development (see docs/pvp-online-battle-design.md).
        label: "PvP Battle (beta)",
        handler: () => {
          this.showPvpMenu();
          return true;
        },
        keepOpen: true,
      },
    );
    const config: OptionSelectModeConfig = { options, blockCancelButton: true };
    await ui.setMode(UiMode.TITLE, config);
  }

  // TODO: Make callers actually wait for the save slot to load
  private async loadSaveSlot(slotId: number): Promise<void> {
    // TODO: Do we need to `await` this?
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.resetModeChain();
    globalScene.sessionSlotId = slotId;
    try {
      const success = await globalScene.gameData.loadSession(slotId);
      if (success) {
        this.loaded = true;
        globalScene.ui.showText(i18next.t("menu:sessionSuccess"), null, () => this.end());
      } else {
        this.end();
      }
    } catch (err) {
      console.error(err);
      globalScene.ui.showText(i18next.t("menu:failedToLoadSession"), null);
    }
  }

  initDailyRun(): void {
    globalScene.ui.clearText();
    globalScene.ui.setMode(UiMode.SAVE_SLOT, SaveSlotUiMode.SAVE, (slotId: number) => {
      if (slotId === -1) {
        globalScene.phaseManager.toTitleScreen();
        super.end();
        return;
      }
      globalScene.phaseManager.clearPhaseQueue();
      globalScene.sessionSlotId = slotId;

      const generateDaily = (seed: string) => {
        globalScene.gameMode = getGameMode(GameModes.DAILY);

        seed = globalScene.gameMode.trySetCustomDailyConfig(seed);

        // Daily runs don't support all challenges yet (starter select restrictions aren't considered)
        startDailyEventChallenges();

        globalScene.setSeed(seed);
        globalScene.resetSeed();

        globalScene.money = globalScene.gameMode.getStartingMoney();

        const starters = getDailyRunStarters();
        const startingLevel = globalScene.gameMode.getStartingLevel();

        // TODO: Dedupe this
        const party = globalScene.getPlayerParty();
        const loadPokemonAssets: Promise<void>[] = [];
        for (const [index, starter] of starters.entries()) {
          const species = speciesDataRegistry.getSpecies(starter.speciesId);
          const starterFormIndex = starter.formIndex;
          const starterGender =
            species.malePercent === null ? Gender.GENDERLESS : starter.female ? Gender.FEMALE : Gender.MALE;
          const starterPokemon = globalScene.addPlayerPokemon(
            species,
            startingLevel,
            starter.abilityIndex,
            starterFormIndex,
            starterGender,
            starter.shiny,
            starter.variant,
            starter.ivs,
            starter.nature,
          );
          starterPokemon.setVisible(false);
          if (starter.moveset) {
            // avoid validating daily run starter movesets which are pre-populated already
            starterPokemon.tryPopulateMoveset(starter.moveset, true);
          }

          const customStarterConfig = globalScene.gameMode.dailyConfig?.starters?.[index];
          if (customStarterConfig?.ability != null) {
            starterPokemon.customPokemonData.ability = customStarterConfig.ability;
          }
          if (customStarterConfig?.passive != null) {
            starterPokemon.customPokemonData.passive = customStarterConfig.passive;
          }

          party.push(starterPokemon);
          loadPokemonAssets.push(starterPokemon.loadAssets());
        }

        regenerateModifierPoolThresholds(party, ModifierPoolType.DAILY_STARTER);

        const modifiers: Modifier[] = new Array(3)
          .fill(null)
          .map(() => modifierTypes.EXP_SHARE().withIdFromFunc(modifierTypes.EXP_SHARE).newModifier())
          .concat(
            new Array(3)
              .fill(null)
              .map(() => modifierTypes.GOLDEN_EXP_CHARM().withIdFromFunc(modifierTypes.GOLDEN_EXP_CHARM).newModifier()),
          )
          .concat([modifierTypes.MAP().withIdFromFunc(modifierTypes.MAP).newModifier()])
          .concat([modifierTypes.ABILITY_CHARM().withIdFromFunc(modifierTypes.ABILITY_CHARM).newModifier()])
          .concat([modifierTypes.SHINY_CHARM().withIdFromFunc(modifierTypes.SHINY_CHARM).newModifier()])
          .concat(getDailyRunStarterModifiers(party))
          .filter(m => m !== null);

        for (const m of modifiers) {
          globalScene.addModifier(m, true, false, false, true);
        }
        for (const m of timedEventManager.getEventDailyStartingItems()) {
          globalScene.addModifier(
            modifierTypes[m]().withIdFromFunc(modifierTypes[m]).newModifier(),
            true,
            false,
            false,
            true,
          );
        }
        globalScene.updateModifiers(true, true);

        Promise.all(loadPokemonAssets).then(async () => {
          globalScene.time.delayedCall(500, () => audioManager.playBgm());
          globalScene.gameData.gameStats.dailyRunSessionsPlayed++;
          const startingBiome = globalScene.gameMode.getStartingBiome();

          await globalScene.loadBiomeAssets(startingBiome);
          globalScene.newArena(startingBiome);
          globalScene.newBattle();
          globalScene.arena.init();
          globalScene.sessionPlayTime = 0;
          globalScene.lastSavePlayTime = 0;
          this.end();
        });
      };

      // If Online, calls seed fetch from db to generate daily run. If Offline, generates a daily run based on current date.
      if (!bypassLogin || isLocalServerConnected) {
        pokerogueApi.daily
          .getSeed()
          .then(seed => {
            if (seed) {
              generateDaily(seed);
            } else {
              throw new Error("Daily run seed is null!");
            }
          })
          .catch(err => {
            console.error("Failed to load daily run:\n", err);
          });
      } else {
        // Grab first 10 chars of ISO date format (YYYY-MM-DD) and convert to base64
        let seed: string = btoa(new Date().toISOString().slice(0, 10));
        if (activeOverrides.DAILY_RUN_SEED_OVERRIDE != null) {
          seed =
            typeof activeOverrides.DAILY_RUN_SEED_OVERRIDE === "string"
              ? activeOverrides.DAILY_RUN_SEED_OVERRIDE
              : JSON.stringify(activeOverrides.DAILY_RUN_SEED_OVERRIDE);
        }
        generateDaily(seed);
      }
    });
  }

  // TODO: Refactor this
  end(): void {
    if (!this.loaded && !globalScene.gameMode.isDaily) {
      globalScene.gameMode = getGameMode(this.gameMode);
      if (this.gameMode === GameModes.CHALLENGE) {
        globalScene.phaseManager.pushNew("SelectChallengePhase");
      } else {
        globalScene.phaseManager.pushNew("SelectStarterPhase");
      }
      globalScene.newArena(globalScene.gameMode.getStartingBiome());
    } else {
      audioManager.playBgm();
    }

    globalScene.phaseManager.pushNew("EncounterPhase", this.loaded);

    if (this.loaded) {
      const availablePartyMembers = globalScene.getPokemonAllowedInBattle().length;

      globalScene.phaseManager.pushNew("SummonPhase", 0, true, true);
      if (globalScene.currentBattle.double && availablePartyMembers > 1) {
        globalScene.phaseManager.pushNew("SummonPhase", 1, true, true);
      }

      if (
        globalScene.currentBattle.battleType !== BattleType.TRAINER
        && (globalScene.currentBattle.waveIndex > 1 || !globalScene.gameMode.isDaily)
      ) {
        const minPartySize = globalScene.currentBattle.double ? 2 : 1;
        if (availablePartyMembers > minPartySize) {
          globalScene.phaseManager.pushNew("CheckSwitchPhase", 0, globalScene.currentBattle.double);
          if (globalScene.currentBattle.double) {
            globalScene.phaseManager.pushNew("CheckSwitchPhase", 1, globalScene.currentBattle.double);
          }
        }
      }
    }

    // TODO: Move this to a migrate script instead of running it on save slot load
    for (const achv of Object.keys(globalScene.gameData.achvUnlocks)) {
      if (Object.hasOwn(vouchers, achv) && achv !== "CLASSIC_VICTORY") {
        globalScene.validateVoucher(vouchers[achv]);
      }
    }

    super.end();
  }

  // #region PvP (see docs/pvp-online-battle-design.md)
  //
  // MVP: a fixed template team rather than a full team-builder UI (design doc §10, step 1).
  // The team-builder UI, double battles, and a proper reward-free battle-end flow remain
  // unimplemented - see the summary posted alongside this code for the full "what's not done yet" list.

  private showPvpMenu(): void {
    const { ui } = globalScene;
    const pvpOptions: OptionSelectItem[] = [
      {
        label: "Create Room (Single Battle)",
        handler: () => {
          this.startPvpCreateRoom("single");
          return true;
        },
      },
      {
        label: "Join Room by Code",
        handler: () => {
          this.startPvpJoinRoom();
          return true;
        },
      },
      {
        label: i18next.t("menu:cancel"),
        handler: () => {
          globalScene.phaseManager.toTitleScreen();
          // `toTitleScreen()` only queues a fresh `TitlePhase`; it doesn't start it - this
          // (currently-running) `TitlePhase` still has to end for the phase manager to advance
          // to it, exactly like the "New Game" submenu's own Cancel button (above) does.
          super.end();
          return true;
        },
      },
    ];
    const config: OptionSelectModeConfig = { options: pvpOptions, yOffset: 48 };
    ui.setOverlayMode(UiMode.OPTION_SELECT, config);
  }

  private startPvpCreateRoom(mode: PvpMode): void {
    const { ui } = globalScene;
    const session = new PvpRoomManager();
    setPvpSession(session);

    ui.setMode(UiMode.MESSAGE);
    ui.showText("Connecting to the PvP server...");

    session
      .createRoom(mode)
      .then(roomId => {
        console.log("[PvP] Room code:", roomId);
        ui.showText(`Room code: ${roomId}\nWaiting for an opponent to join...`);
        this.waitForPvpRoomReady(session);
      })
      .catch((error: Error) => this.abortPvpSetup(error));
  }

  private startPvpJoinRoom(): void {
    const session = new PvpRoomManager();
    setPvpSession(session);

    globalScene.ui.setOverlayMode(UiMode.PVP_JOIN_FORM, {
      buttonActions: [
        () => {
          globalScene.ui.revertMode();
          this.waitForPvpRoomReady(session);
        },
        () => {
          setPvpSession(null);
          globalScene.ui.revertMode();
        },
      ],
    });
  }

  private waitForPvpRoomReady(session: PvpRoomManager): void {
    const { ui } = globalScene;
    ui.setMode(UiMode.MESSAGE);
    ui.showText("Waiting for the opponent...");

    session.onRoomReady(() => this.submitFixedPvpTeamAndReady(session));
    session.onOpponentDisconnected(() => this.abortPvpSetup(new Error("The opponent disconnected.")));
  }

  private submitFixedPvpTeamAndReady(session: PvpRoomManager): void {
    const { ui } = globalScene;

    const myTeam: PvpPartyMemberDto[] = [
      { species: SpeciesId.PIKACHU, level: 50, moves: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL] },
    ];
    session.submitTeam(myTeam);
    session.ready();

    ui.showText("Waiting for the opponent to be ready...");
    session.onBattleStart(message => this.beginPvpBattle(session, myTeam, message));
  }

  /**
   * Construct both sides' live Pokemon from the (fixed-template) teams and start the turn loop,
   * exactly as `EncounterPhase` would for a normal battle - minus the wild/trainer generation it
   * doesn't need, since both teams are already fully known (see design doc §9.3).
   */
  private beginPvpBattle(session: PvpRoomManager, myTeam: PvpPartyMemberDto[], message: BattleStartMessage): void {
    const { ui } = globalScene;

    globalScene.newPvpBattle(message.battleSeed, message.double);
    setUpPvpParty(myTeam, message.opponentTeam);

    session.onOpponentDisconnected(() => {
      ui.showText("The opponent disconnected.", null, () => this.endPvpBattle(session));
    });
    session.onBattleEnd(endMessage => {
      ui.showText(`Battle ended: ${endMessage.reason}`, null, () => this.endPvpBattle(session));
    });

    ui.setMode(UiMode.MESSAGE);
    ui.resetModeChain();
    ui.clearText();
    globalScene.phaseManager.clearPhaseQueue();
    // Bring both Pokemon onto the field (SummonPhase), then queue each side's PostSummonPhase
    // (InitEncounterPhase) - once that queue drains, the PhaseManager automatically starts the
    // first real TurnInitPhase (see docs/phases.md).
    globalScene.phaseManager.pushNew("SummonPhase", 0, true);
    globalScene.phaseManager.pushNew("SummonPhase", 0, false);
    globalScene.phaseManager.pushNew("InitEncounterPhase");
    // NOT `this.end()`: `TitlePhase.end()` unconditionally starts a normal run (pushes
    // `SelectStarterPhase`/`EncounterPhase` based on `this.gameMode`, which is unset here) - it's
    // only appropriate for the "New Game"/"Load Game" flows. `super.end()` just advances the
    // phase queue, which is what we want (see docs/phases.md).
    super.end();
  }

  /**
   * Tear down the PvP session on disconnect/forfeit/battle-end.
   * @remarks
   * **Known gap:** this does not return to the title screen. Doing so safely requires ending
   * whichever battle phase happens to be currently running at the (unpredictable) moment the
   * battle ends - `TitlePhase` has no reference to it, and forcing a transition via
   * `PhaseManager.shiftPhase()` directly (bypassing that phase's own `end()`) risks a double-end
   * crash if that phase later tries to end itself normally (e.g. after an in-flight `await`
   * resolves). See `pvp-server/README.md` "Known gaps" (battle-end handling) - a real fix belongs
   * with implementing proper win/loss detection, not a workaround here.
   */
  private endPvpBattle(session: PvpRoomManager): void {
    session.leave();
    setPvpSession(null);
  }

  private abortPvpSetup(error: Error): void {
    console.error("PvP setup failed:", error);
    getPvpSession()?.leave();
    setPvpSession(null);
    globalScene.ui.showText(`Could not connect to the PvP server:\n${error.message}`, null, () =>
      this.showOptions(NO_SAVE_SLOT),
    );
  }

  // #endregion PvP
}

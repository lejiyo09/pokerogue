import { pokerogueApi } from "#api/api";
import { globalScene } from "#app/global-scene";
import {
  createPvpTeamBuilderState,
  deselect,
  isSelectable,
  type PvpTeamBuilderState,
  select,
} from "#data/pvp/team-builder";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import type { PvpPartyMemberDto } from "#net/pvp-protocol-types";
import { PVP_BATTLE_LEVEL, pvpPartyMemberDtoFromBankedPokemon } from "#net/pvp-team-setup";
import { PokemonData } from "#system/pokemon-data";
import type { BankedPokemon } from "#types/api";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import { fixedInt, formatLargeNumber } from "#utils/common";
import i18next from "i18next";

export interface PvpTeamBuilderArgs {
  onConfirm: (team: PvpPartyMemberDto[]) => void;
  onCancel?: () => void;
}

/**
 * Lets the player pick their PvP team from their Global Pokémon Collection
 * ({@linkcode PokeroguePvpCollectionApi}), enforcing the Species Clause
 * ({@linkcode isSelectable}/`data/pvp/team-builder.ts`) and confirming with `Button.SUBMIT` into a
 * {@linkcode PvpPartyMemberDto} team via {@linkcode pvpPartyMemberDtoFromBankedPokemon}.
 *
 * Structurally modeled on `RunHistoryUiHandler` (the closest existing scrollable-row-list-with-
 * cursor UI in this codebase) - see docs/pvp-progression-design.md §9.1/§9.3.
 */
export class PvpTeamBuilderUiHandler extends MessageUiHandler {
  private readonly maxRows = 4;

  private teamBuilderContainer: Phaser.GameObjects.Container;
  private rowsContainer: Phaser.GameObjects.Container;
  private rows: PvpCandidateRowContainer[] = [];

  private scrollCursor = 0;
  private cursorObj: Phaser.GameObjects.NineSlice | null;
  private rowsContainerInitialY: number;

  private state: PvpTeamBuilderState = createPvpTeamBuilderState([]);
  private onConfirm: ((team: PvpPartyMemberDto[]) => void) | null = null;
  private onCancel: (() => void) | null = null;

  override setup() {
    const ui = this.getUi();

    this.teamBuilderContainer = globalScene.add.container(0, 0);
    this.teamBuilderContainer.setVisible(false);
    ui.add(this.teamBuilderContainer);

    const bg = globalScene.add.rectangle(
      0,
      0,
      globalScene.scaledCanvas.width,
      -globalScene.scaledCanvas.height,
      0x006860,
    );
    bg.setOrigin(0, 0);
    this.teamBuilderContainer.add(bg);

    this.rowsContainerInitialY = -globalScene.scaledCanvas.height + 8;

    this.rowsContainer = globalScene.add.container(8, this.rowsContainerInitialY);
    this.teamBuilderContainer.add(this.rowsContainer);
  }

  override show(args: any[]): boolean {
    super.show(args);

    const config = args[0] as PvpTeamBuilderArgs | undefined;
    this.onConfirm = config?.onConfirm ?? null;
    this.onCancel = config?.onCancel ?? null;

    this.getUi().bringToTop(this.teamBuilderContainer);
    this.teamBuilderContainer.setVisible(true);

    this.populateCandidates().then(() => {
      this.setScrollCursor(0);
      this.setCursor(0);
      if (this.rows.length === 0) {
        this.clearCursor();
      }
    });

    return true;
  }

  private async populateCandidates(): Promise<void> {
    const collection = await pokerogueApi.pvpCollection.get();
    if (!collection || collection.length === 0) {
      this.showEmpty();
      return;
    }

    // Fused individuals can't be represented in a PvP battle yet: PvpPartyMemberDto (what
    // pvp-server's SUBMIT_TEAM validates) has no fusionSpecies field, and extending it is a
    // pvp-server protocol change out of scope for this session - see
    // docs/pvp-progression-design.md §2.6.
    const pool: BankedPokemon[] = collection
      .filter(entry => !new PokemonData(entry.data).fusionSpecies)
      .map(entry => ({ ...entry, data: new PokemonData(entry.data) }));

    if (pool.length === 0) {
      this.showEmpty();
      return;
    }

    this.state = createPvpTeamBuilderState(pool);

    for (let i = 0; i < pool.length; i++) {
      const row = new PvpCandidateRowContainer(pool[i], i);
      globalScene.add.existing(row);
      this.rowsContainer.add(row);
      this.rows.push(row);
    }

    this.refreshRows();
  }

  private showEmpty(): void {
    const emptyWindow = addWindow(0, 0, 304, 165);
    this.rowsContainer.add(emptyWindow);
    const center = emptyWindow.getCenter();
    const emptyText = addTextObject(0, 0, i18next.t("saveSlotSelectUiHandler:empty"), TextStyle.WINDOW, {
      fontSize: "72px",
    });
    emptyText.setPosition(center.x, center.y);
    emptyText.setOrigin(0.5, 0.5);
    this.rowsContainer.add(emptyText);
  }

  /** Re-syncs every row's selected/enabled display with {@linkcode state}. */
  private refreshRows(): void {
    for (const row of this.rows) {
      const uid = row.candidate.uid;
      const selected = this.state.selected.some(member => member.uid === uid);
      row.setSelected(selected);
      row.setEnabled(selected || isSelectable(this.state, uid));
    }
  }

  /**
   * @param button `Button.UP`/`DOWN` scroll, `Button.ACTION` toggles the highlighted candidate,
   * `Button.SUBMIT` confirms the team (if at least one candidate is selected), `Button.CANCEL`
   * backs out without confirming.
   */
  override processInput(button: Button): boolean {
    const ui = this.getUi();
    let success = false;

    switch (button) {
      case Button.CANCEL:
        success = true;
        this.onCancel?.();
        ui.revertMode();
        break;
      case Button.SUBMIT: {
        if (this.state.selected.length === 0) {
          break;
        }
        const team = this.state.selected.map(member =>
          pvpPartyMemberDtoFromBankedPokemon(member.data, PVP_BATTLE_LEVEL),
        );
        success = true;
        this.onConfirm?.(team);
        ui.revertMode();
        break;
      }
      case Button.ACTION: {
        const candidate = this.rows[this.cursor + this.scrollCursor]?.candidate;
        if (!candidate) {
          break;
        }
        const uid = candidate.uid;
        if (this.state.selected.some(member => member.uid === uid)) {
          this.state = deselect(this.state, uid);
          success = true;
        } else if (isSelectable(this.state, uid)) {
          this.state = select(this.state, uid);
          success = true;
        }
        if (success) {
          this.refreshRows();
        }
        break;
      }
      case Button.UP:
        if (this.rows.length > 0) {
          if (this.cursor) {
            success = this.setCursor(this.cursor - 1);
          } else if (this.scrollCursor) {
            success = this.setScrollCursor(this.scrollCursor - 1);
          } else if (this.rows.length > 1) {
            // wrap around to the bottom
            success = this.setCursor(Math.min(this.rows.length - 1, this.maxRows - 1));
            success = this.setScrollCursor(Math.max(0, this.rows.length - this.maxRows)) || success;
          }
        }
        break;
      case Button.DOWN:
        if (this.rows.length > 0) {
          if (this.cursor < Math.min(this.maxRows - 1, this.rows.length - this.scrollCursor - 1)) {
            success = this.setCursor(this.cursor + 1);
          } else if (this.scrollCursor < this.rows.length - this.maxRows) {
            success = this.setScrollCursor(this.scrollCursor + 1);
          } else if (this.rows.length > 1) {
            // wrap around to the top
            success = this.setCursor(0);
            success = this.setScrollCursor(0) || success;
          }
        }
        break;
    }

    if (success) {
      ui.playSelect();
    }
    return success;
  }

  override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);

    if (!this.cursorObj) {
      this.cursorObj = globalScene.add.nineslice(0, 0, "select_cursor_highlight_thick", undefined, 296, 46, 6, 6, 6, 6);
      this.cursorObj.setOrigin(0, 0);
      this.rowsContainer.add(this.cursorObj);
    }
    this.cursorObj.setPosition(4, 4 + (cursor + this.scrollCursor) * 56);
    return changed;
  }

  private setScrollCursor(scrollCursor: number): boolean {
    const changed = scrollCursor !== this.scrollCursor;

    if (changed) {
      this.scrollCursor = scrollCursor;
      this.setCursor(this.cursor);
      globalScene.tweens.add({
        targets: this.rowsContainer,
        y: this.rowsContainerInitialY - 56 * scrollCursor,
        duration: fixedInt(325),
        ease: "Sine.easeInOut",
      });
    }
    return changed;
  }

  override clear() {
    super.clear();
    this.teamBuilderContainer.setVisible(false);
    this.setScrollCursor(0);
    this.clearCursor();
    this.clearRows();
    this.state = createPvpTeamBuilderState([]);
    this.onConfirm = null;
    this.onCancel = null;
  }

  private clearCursor(): void {
    if (this.cursorObj) {
      this.cursorObj.destroy();
    }
    this.cursorObj = null;
  }

  private clearRows(): void {
    this.rows.splice(0, this.rows.length);
    this.rowsContainer.removeAll(true);
  }
}

/** One selectable row: a single banked individual's icon, name, and level, plus a selected marker. */
class PvpCandidateRowContainer extends Phaser.GameObjects.Container {
  public readonly candidate: BankedPokemon;

  private selectedText: Phaser.GameObjects.Text;

  constructor(candidate: BankedPokemon, slotId: number) {
    super(globalScene, 0, slotId * 56);

    this.candidate = candidate;
    this.setup();
  }

  private setup(): void {
    const window = addWindow(0, 0, 304, 52);
    this.add(window);

    const data = this.candidate.data as PokemonData;
    const pokemon = data.toPokemon();

    const iconContainer = globalScene.add.container(20, 26);
    iconContainer.add(globalScene.addPokemonIcon(pokemon, 0, 0, 0.5, 0.5));
    this.add(iconContainer);

    const nameText = addTextObject(
      48,
      18,
      `${pokemon.getNameToRender()} ${i18next.t("saveSlotSelectUiHandler:lv")}${formatLargeNumber(pokemon.level, 1000)}`,
      TextStyle.WINDOW,
    );
    this.add(nameText);

    this.selectedText = addTextObject(270, 18, "", TextStyle.SUMMARY_GREEN, { fontSize: "64px" });
    this.add(this.selectedText);

    pokemon.destroy();
  }

  setSelected(selected: boolean): void {
    this.selectedText.setText(selected ? "✓" : "");
  }

  setEnabled(enabled: boolean): void {
    this.setAlpha(enabled ? 1 : 0.5);
  }
}

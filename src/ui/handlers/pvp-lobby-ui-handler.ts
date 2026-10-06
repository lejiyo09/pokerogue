import { pokerogueApi } from "#api/api";
import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import type { PvpRanking } from "#types/api";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";

export interface PvpLobbyArgs {
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onCancel: () => void;
}

// The playable canvas is only 320x180 game units (see `globalScene.scaledCanvas`) - these are
// deliberately far more compact than e.g. `PvpTeamBuilderUiHandler`'s 56-unit icon rows, which
// would overflow this single non-scrolling screen several times over at that size.
const RANKING_ROWS_SHOWN = 3;
const RANKING_ROW_HEIGHT = 16;
const ACTION_ROW_HEIGHT = 26;
const ACTION_LABELS = ["Create Room (Single Battle)", "Join Room by Code"];
const RANKINGS_WINDOW_HEIGHT = 8 + RANKING_ROWS_SHOWN * RANKING_ROW_HEIGHT;

/**
 * The PvP lobby: a read-only top-5 rankings panel (`pokerogueApi.pvpRankings`, see
 * docs/pvp-progression-design.md §9.2) above a short fixed action menu (Create Room / Join Room by
 * Code / Cancel) that just calls the already-working `PvpRoomManager` flows wired up in
 * `title-phase.ts`.
 *
 * Structurally modeled on `PvpTeamBuilderUiHandler`/`RunHistoryUiHandler` - see §9.1/§9.3 for why
 * this screen deliberately has no open-room list or matchmaking queue display.
 */
export class PvpLobbyUiHandler extends MessageUiHandler {
  /** Create Room, Join Room, Cancel. */
  private readonly actionCount = ACTION_LABELS.length + 1;

  private lobbyContainer: Phaser.GameObjects.Container;
  private rankingsContainer: Phaser.GameObjects.Container;
  private actionsContainer: Phaser.GameObjects.Container;

  private cursorObj: Phaser.GameObjects.NineSlice | null;

  private onCreateRoom: (() => void) | null = null;
  private onJoinRoom: (() => void) | null = null;
  private onCancel: (() => void) | null = null;

  override setup() {
    const ui = this.getUi();

    this.lobbyContainer = globalScene.add.container(0, 0);
    this.lobbyContainer.setVisible(false);
    ui.add(this.lobbyContainer);

    const top = -globalScene.scaledCanvas.height;

    const bg = globalScene.add.rectangle(0, 0, globalScene.scaledCanvas.width, top, 0x006860);
    bg.setOrigin(0, 0);
    this.lobbyContainer.add(bg);

    const title = addTextObject(8, top + 8, "PvP Lobby", TextStyle.WINDOW, { fontSize: "96px" });
    this.lobbyContainer.add(title);

    this.rankingsContainer = globalScene.add.container(8, top + 24);
    this.lobbyContainer.add(this.rankingsContainer);

    this.actionsContainer = globalScene.add.container(8, top + 24 + RANKINGS_WINDOW_HEIGHT + 6);
    this.lobbyContainer.add(this.actionsContainer);

    const actionLabels = [...ACTION_LABELS, i18next.t("menu:cancel")];
    for (const [i, label] of actionLabels.entries()) {
      const row = new LobbyActionRowContainer(label, i);
      globalScene.add.existing(row);
      this.actionsContainer.add(row);
    }
  }

  override show(args: any[]): boolean {
    super.show(args);

    const config = args[0] as PvpLobbyArgs | undefined;
    this.onCreateRoom = config?.onCreateRoom ?? null;
    this.onJoinRoom = config?.onJoinRoom ?? null;
    this.onCancel = config?.onCancel ?? null;

    this.getUi().bringToTop(this.lobbyContainer);
    this.lobbyContainer.setVisible(true);

    this.populateRankings();
    this.setCursor(0);

    return true;
  }

  private async populateRankings(): Promise<void> {
    this.rankingsContainer.removeAll(true);

    const window = addWindow(0, 0, 304, RANKINGS_WINDOW_HEIGHT);
    this.rankingsContainer.add(window);

    const rankings = await pokerogueApi.pvpRankings.get({ page: 1 });
    if (!rankings || rankings.length === 0) {
      const emptyText = addTextObject(10, 6, "No ranked battles played yet.", TextStyle.WINDOW, {
        fontSize: "48px",
      });
      this.rankingsContainer.add(emptyText);
      return;
    }

    for (const [i, ranking] of rankings.slice(0, RANKING_ROWS_SHOWN).entries()) {
      const row = new RankingRowContainer(ranking, i);
      globalScene.add.existing(row);
      this.rankingsContainer.add(row);
    }
  }

  override processInput(button: Button): boolean {
    const ui = this.getUi();
    let success = false;

    switch (button) {
      case Button.CANCEL:
        success = true;
        this.onCancel?.();
        break;
      case Button.ACTION:
      case Button.SUBMIT:
        success = true;
        switch (this.cursor) {
          case 0:
            this.onCreateRoom?.();
            break;
          case 1:
            this.onJoinRoom?.();
            break;
          default:
            this.onCancel?.();
            break;
        }
        break;
      case Button.UP:
        success = this.setCursor(this.cursor ? this.cursor - 1 : this.actionCount - 1);
        break;
      case Button.DOWN:
        success = this.setCursor(this.cursor < this.actionCount - 1 ? this.cursor + 1 : 0);
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
      this.cursorObj = globalScene.add.nineslice(
        0,
        0,
        "select_cursor_highlight_thick",
        undefined,
        296,
        ACTION_ROW_HEIGHT - 8,
        6,
        6,
        6,
        6,
      );
      this.cursorObj.setOrigin(0, 0);
      this.actionsContainer.add(this.cursorObj);
    }
    this.cursorObj.setPosition(4, 2 + cursor * ACTION_ROW_HEIGHT);
    return changed;
  }

  override clear() {
    super.clear();
    this.lobbyContainer.setVisible(false);
    this.clearCursor();
    this.onCreateRoom = null;
    this.onJoinRoom = null;
    this.onCancel = null;
  }

  private clearCursor(): void {
    if (this.cursorObj) {
      this.cursorObj.destroy();
    }
    this.cursorObj = null;
  }
}

/** One fixed, always-enabled action row ("Create Room", "Join Room by Code", "Cancel"). */
class LobbyActionRowContainer extends Phaser.GameObjects.Container {
  constructor(label: string, slotId: number) {
    super(globalScene, 0, slotId * ACTION_ROW_HEIGHT);

    const window = addWindow(0, 0, 304, ACTION_ROW_HEIGHT - 4);
    this.add(window);

    const labelText = addTextObject(10, 6, label, TextStyle.WINDOW, { fontSize: "48px" });
    this.add(labelText);
  }
}

/** One read-only leaderboard row: rank, username, win-loss record. */
class RankingRowContainer extends Phaser.GameObjects.Container {
  constructor(ranking: PvpRanking, rowIndex: number) {
    super(globalScene, 10, 6 + rowIndex * RANKING_ROW_HEIGHT);

    const rankText = addTextObject(0, 0, `#${ranking.rank}`, TextStyle.WINDOW, { fontSize: "48px" });
    this.add(rankText);

    const nameText = addTextObject(36, 0, ranking.username, TextStyle.WINDOW, { fontSize: "48px" });
    this.add(nameText);

    const recordText = addTextObject(220, 0, `${ranking.wins}W ${ranking.losses}L`, TextStyle.WINDOW, {
      fontSize: "48px",
    });
    this.add(recordText);
  }
}

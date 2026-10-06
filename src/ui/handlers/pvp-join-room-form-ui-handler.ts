import { globalScene } from "#app/global-scene";
import { UiMode } from "#enums/ui-mode";
import { getPvpSession } from "#net/pvp-session";
import type { ModalConfig } from "#types/ui-types";
import type { InputFieldConfig } from "#ui/form-modal-ui-handler";
import { FormModalUiHandler } from "#ui/form-modal-ui-handler";

/**
 * A small text-entry form used to join an existing PvP room by its room code.
 *
 * Expects a {@linkcode PvpRoomManager} to already have been created and registered via
 * `setPvpSession` (see `TitlePhase`) before being shown.
 * @see docs/pvp-online-battle-design.md §9.1, §10 (MVP step 1)
 */
export class PvpJoinRoomFormUiHandler extends FormModalUiHandler {
  public override getModalTitle(): string {
    return "Join PvP Room";
  }

  public override getWidth(): number {
    return 160;
  }

  public override getMargin(): [number, number, number, number] {
    return [0, 0, 48, 0];
  }

  public override getButtonLabels(): string[] {
    return ["Join", "Cancel"];
  }

  public override getInputFieldConfigs(): InputFieldConfig[] {
    return [{ label: "Room code" }];
  }

  public override show(args: any[]): boolean {
    if (!super.show(args)) {
      return false;
    }

    const config = args[0] as ModalConfig;
    const originalJoinAction = this.submitAction;
    this.submitAction = () => {
      if (globalScene.tweens.getTweensOf(this.modalContainer).length > 0) {
        return;
      }
      this.submitAction = originalJoinAction;
      this.sanitizeInputs();

      const roomCode = this.inputs[0].text;
      if (!roomCode) {
        globalScene.ui.setMode(UiMode.PVP_JOIN_FORM, Object.assign(config, { errorMessage: "Enter a room code" }));
        globalScene.ui.playError();
        return;
      }

      const session = getPvpSession();
      if (!session) {
        console.error("PvpJoinRoomFormUiHandler shown without an active PvP session");
        return;
      }

      globalScene.ui.setMode(UiMode.LOADING, { buttonActions: [] });
      session
        .joinRoom(roomCode)
        .then(() => originalJoinAction?.())
        .catch((error: Error) => {
          globalScene.ui.setMode(UiMode.PVP_JOIN_FORM, Object.assign(config, { errorMessage: error.message }));
          globalScene.ui.playError();
        });
    };

    return true;
  }
}

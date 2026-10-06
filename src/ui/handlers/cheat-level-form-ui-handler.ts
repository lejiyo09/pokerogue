import { globalScene } from "#app/global-scene";
import { UiMode } from "#enums/ui-mode";
import type { ModalConfig } from "#types/ui-types";
import type { InputFieldConfig } from "#ui/form-modal-ui-handler";
import { FormModalUiHandler } from "#ui/form-modal-ui-handler";

const MIN_LEVEL = 1;
const MAX_LEVEL = 100;

/**
 * A single-field numeric prompt for the cheat menu's "Set Level" action (see
 * `#ui/cheat-menu`). Only reachable for the account with
 * `loggedInUser.cheatsEnabled` - see menu-ui-handler.ts's "Cheats" entry.
 */
export class CheatLevelFormUiHandler extends FormModalUiHandler {
  public override getModalTitle(): string {
    return "Set Level";
  }

  public override getWidth(): number {
    return 160;
  }

  public override getMargin(): [number, number, number, number] {
    return [0, 0, 48, 0];
  }

  public override getButtonLabels(): string[] {
    return ["Set", "Cancel"];
  }

  public override getReadableErrorMessage(error: string): string {
    return error;
  }

  public override getInputFieldConfigs(): InputFieldConfig[] {
    return [{ label: "Level (1-100)" }];
  }

  public override show(args: any[]): boolean {
    if (!super.show(args)) {
      return false;
    }

    const config = args[0] as ModalConfig;
    this.submitAction = () => {
      this.sanitizeInputs();

      const onFail = (error: string) => {
        globalScene.ui.playError();
        globalScene.ui.setMode(UiMode.CHEAT_LEVEL_FORM, Object.assign(config, { errorMessage: error }));
      };

      const level = Number(this.inputs[0].text);
      if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
        return onFail(`Enter a whole number from ${MIN_LEVEL} to ${MAX_LEVEL}`);
      }

      config.buttonActions[0](level);
      return true;
    };

    return true;
  }
}

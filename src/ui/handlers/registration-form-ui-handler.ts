import { pokerogueApi } from "#api/api";
import { isAllowedSchoolEmail, registerWithFirebaseEmail } from "#app/firebase";
import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { ModalConfig } from "#types/ui-types";
import type { InputFieldConfig } from "#ui/form-modal-ui-handler";
import { LoginRegisterInfoContainerUiHandler } from "#ui/login-register-info-container-ui-handler";
import { addTextObject } from "#ui/text";
import i18next from "i18next";

// TODO: Consider replacing server error strings with numeric error codes for better maintainability
// TODO: Centralize server error constants
const ERR_INVALID_NICKNAME = "invalid nickname";
const ERR_NICKNAME_IN_USE = "failed to add account record";
const ERR_FAILED_TO_GENERATE_UUID = "failed to generate uuid";
const ERR_FAILED_TO_GENERATE_PASSWORD = "failed to generate salt";

/** Maps a `registerWithFirebaseEmail` failure to a readable message. */
function readableFirebaseRegisterError(err: unknown): string {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  switch (code) {
    case "auth/invalid-email":
      return "The provided email is invalid";
    case "auth/email-already-in-use":
      return "An account already exists for this email";
    case "auth/weak-password":
      return i18next.t("menu:invalidRegisterPassword");
    case "auth/too-many-requests":
      return i18next.t("menu:pleaseTryAgainLater");
    default:
      return i18next.t("menu:pleaseTryAgainLater");
  }
}

export class RegistrationFormUiHandler extends LoginRegisterInfoContainerUiHandler {
  public override getModalTitle(): string {
    return i18next.t("menu:register");
  }

  public override getWidth(): number {
    return 160;
  }

  public override getMargin(): [number, number, number, number] {
    return [0, 20, 48, 0];
  }

  public override getButtonTopMargin(): number {
    return 12;
  }

  public override getButtonLabels(): string[] {
    return [i18next.t("menu:register"), i18next.t("menu:goBack")];
  }

  public override getReadableErrorMessage(error: string): string {
    const colonIndex = error?.indexOf(":");
    if (colonIndex > 0) {
      error = error.slice(0, colonIndex);
    }

    switch (error) {
      case ERR_INVALID_NICKNAME:
        return i18next.t("menu:invalidRegisterUsername");
      case ERR_NICKNAME_IN_USE:
        return i18next.t("menu:usernameAlreadyUsed");
      case ERR_FAILED_TO_GENERATE_UUID:
        return `${i18next.t("menu:serverErrorGenerateUuid")}\n${i18next.t("menu:pleaseTryAgainLater")}`;
      case ERR_FAILED_TO_GENERATE_PASSWORD:
        return `${i18next.t("menu:serverErrorGenerateSalt")}\n${i18next.t("menu:pleaseTryAgainLater")}`;
    }

    return super.getReadableErrorMessage(error);
  }

  public override getInputFieldConfigs(): InputFieldConfig[] {
    const inputFieldConfigs: InputFieldConfig[] = [];
    // No locales entry exists for a generic "Email" label (this fork's
    // school-email-only registration is a local customization, not
    // something the upstream locales repo covers).
    inputFieldConfigs.push({ label: "Email" });
    inputFieldConfigs.push({ label: i18next.t("menu:nickname") });
    inputFieldConfigs.push({
      label: i18next.t("menu:password"),
      isPassword: true,
    });
    inputFieldConfigs.push({
      label: i18next.t("menu:confirmPassword"),
      isPassword: true,
    });
    return inputFieldConfigs;
  }

  public override setup(): void {
    super.setup();

    const label = addTextObject(10, 87, i18next.t("menu:registrationAgeWarning"), TextStyle.TOOLTIP_CONTENT, {
      fontSize: "42px",
      wordWrap: { width: 850 },
    });

    this.modalContainer.add(label);
  }

  public override show(args: [ModalConfig, ...any[]]): boolean {
    if (!super.show(args)) {
      return false;
    }

    const config = args[0];
    this.showInfoContainer(config);

    const originalRegistrationAction = this.submitAction;
    this.submitAction = () => {
      if (globalScene.tweens.getTweensOf(this.modalContainer).length === 0) {
        // Prevent overlapping overrides on action modification
        this.submitAction = originalRegistrationAction;
        this.sanitizeInputs();
        globalScene.ui.setMode(UiMode.LOADING, { buttonActions: [] });
        const onFail = (error: string) => {
          globalScene.ui.setMode(UiMode.REGISTRATION_FORM, Object.assign(config, { errorMessage: error?.trim() }));
          globalScene.ui.playError();
        };
        if (!this.inputs[0].text) {
          return onFail("Email must not be empty");
        }
        if (!isAllowedSchoolEmail(this.inputs[0].text)) {
          return onFail("This email is not allowed to register");
        }
        if (!this.inputs[1].text) {
          return onFail("Nickname must not be empty");
        }
        if (!this.inputs[2].text) {
          return onFail(i18next.t("menu:invalidRegisterPassword"));
        }
        if (this.inputs[2].text !== this.inputs[3].text) {
          return onFail(i18next.t("menu:passwordNotMatchingConfirmPassword"));
        }
        const [emailInput, nicknameInput, passwordInput] = this.inputs;

        registerWithFirebaseEmail(emailInput.text, passwordInput.text)
          .then(idToken => pokerogueApi.account.loginWithFirebase(idToken, nicknameInput.text))
          .then(error => {
            if (!error && originalRegistrationAction) {
              originalRegistrationAction();
            } else {
              onFail(error ?? "");
            }
          })
          .catch(err => {
            console.warn("Firebase registration failed!", err);
            onFail(readableFirebaseRegisterError(err));
          });
      }
    };

    return true;
  }
}

import { pokerogueApi } from "#api/api";
import { isAllowedSchoolEmail, registerWithFirebaseEmail, signInWithFirebaseEmail } from "#app/firebase";
import { globalScene } from "#app/global-scene";
import { UiMode } from "#enums/ui-mode";
import type { ModalConfig } from "#types/ui-types";
import type { InputFieldConfig } from "#ui/form-modal-ui-handler";
import { LoginRegisterInfoContainerUiHandler } from "#ui/login-register-info-container-ui-handler";
import i18next from "i18next";

// TODO: Consider replacing server error strings with numeric error codes for better maintainability
// TODO: Centralize server error constants
const ERR_INVALID_NICKNAME = "invalid nickname";
const ERR_NICKNAME_IN_USE = "failed to add account record";
const ERR_FAILED_TO_GENERATE_UUID = "failed to generate uuid";
const ERR_FAILED_TO_GENERATE_PASSWORD = "failed to generate salt";

/** Maps a `registerWithFirebaseEmail`/`signInWithFirebaseEmail` failure to a readable message. */
function readableFirebaseRegisterError(err: unknown): string {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  switch (code) {
    case "auth/invalid-email":
      return "The provided email is invalid";
    case "auth/weak-password":
      return i18next.t("menu:invalidRegisterPassword");
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      // Only reachable via getOrCreateFirebaseIdToken's sign-in fallback:
      // an account already exists for this email, and this password isn't
      // its password.
      return "An account already exists for this email, and this password doesn't match it";
    case "auth/too-many-requests":
      return i18next.t("menu:pleaseTryAgainLater");
    default:
      return i18next.t("menu:pleaseTryAgainLater");
  }
}

/**
 * Registers a new Firebase account for `email`/`password`, or - if one
 * already exists (`auth/email-already-in-use`) - signs into it instead. That
 * case happens whenever a Firebase account was created but its matching
 * rogueserver account never finished registering (e.g. the account's very
 * first login was tried from the Login screen, which never sends a nickname
 * - see loginWithIdentity's doc comment); without this fallback, that
 * account could never register OR log in again. Either way, returns an ID
 * token to exchange with the server via `loginWithFirebase(idToken, nickname)`.
 */
async function getOrCreateFirebaseIdToken(email: string, password: string): Promise<string> {
  try {
    return await registerWithFirebaseEmail(email, password);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : "";
    if (code !== "auth/email-already-in-use") {
      throw err;
    }
    return await signInWithFirebaseEmail(email, password);
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
    // Registration grew a 4th input field (nickname) versus upstream, which
    // grows getHeight() by 20 and was pushing the window's top off-screen at
    // the old margin - a non-zero top margin moves it back down.
    return [20, 20, 48, 0];
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
    // something the upstream locales repo covers). maxLength: the default
    // (20) is too short for "2026####@hanilgo.cnehs.kr" (25 chars).
    inputFieldConfigs.push({ label: "Email", maxLength: 40 });
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

        getOrCreateFirebaseIdToken(emailInput.text, passwordInput.text)
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

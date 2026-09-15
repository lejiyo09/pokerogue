import { pokerogueApi } from "#api/api";
import { updateUserInfo } from "#app/account";
import { signInWithGoogle as googleSignIn } from "#app/firebase";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { Phase } from "#app/phase";
import { handleTutorial, Tutorial } from "#app/tutorial";
import { bypassLogin } from "#constants/app-constants";
import { PlayerGender } from "#enums/player-gender";
import { UiMode } from "#enums/ui-mode";
import type { FormModalConfig } from "#types/ui-types";
import { executeIf, sessionIdKey } from "#utils/common";
import { getCookie, removeCookie } from "#utils/cookies";
import i18next, { t } from "i18next";

export class LoginPhase extends Phase {
  public readonly phaseName = "LoginPhase";

  /**
   * Whether to load the "login or register" text.
   * Only `true` the first time the phase runs, the text stays on screen after that.
   * @defaultValue `true`
   */
  private readonly showText: boolean;

  constructor(showText = true) {
    super();

    this.showText = showText;
  }

  public override async start(): Promise<void> {
    const { gameData, ui } = globalScene;

    super.start();

    const hasSession = !!getCookie(sessionIdKey);

    ui.setMode(UiMode.LOADING, { buttonActions: [] });

    const response = await executeIf(bypassLogin || hasSession, updateUserInfo);
    const success = response?.[0] ?? false;
    const statusCode = response ? response[1] : null;

    if (!success) {
      this.checkStatus(statusCode);
      return;
    }

    await gameData.loadSystem();
    if (success || bypassLogin) {
      await this.end();
      return;
    }
    ui.setMode(UiMode.MESSAGE);
    ui.showText(t("menu:failedToLoadSaveData"));
  }

  public override async end(): Promise<void> {
    globalScene.ui.setMode(UiMode.MESSAGE);

    if (settings.general.playerGender === PlayerGender.UNSET) {
      globalScene.phaseManager.unshiftNew("SelectGenderPhase");
    }

    await handleTutorial(Tutorial.INTRO);
    super.end();
  }

  private checkStatus(statusCode: number | null): void {
    if (!statusCode || statusCode === 400) {
      this.showLoginRegister();
      return;
    }

    if (statusCode === 401) {
      removeCookie(sessionIdKey);
      globalScene.reset(true, true);
      return;
    }

    globalScene.phaseManager.unshiftNew("UnavailablePhase");
    super.end();
  }

  /**
   * Shows the single "sign in with Google" button. Accounts are Google-only
   * (see docs on {@linkcode PokerogueAccountApi.loginWithGoogle} for why
   * there's no separate registration step) and Discord sign-in is disabled.
   * @param errorMessage - Shown above the button, e.g. after a failed sign-in attempt.
   */
  private showLoginRegister(errorMessage?: string): void {
    const { ui } = globalScene;

    const signInButton = () => {
      this.signInWithGoogle();
    };

    if (this.showText) {
      ui.showText(i18next.t("menu:logInOrCreateAccount"));
    }

    audioManager.playSound("ui/menu_open");

    const config: FormModalConfig = { buttonActions: [signInButton] };
    if (errorMessage) {
      config.errorMessage = errorMessage;
    }

    ui.setMode(UiMode.LOGIN_OR_REGISTER, config);
  }

  /**
   * Opens the Google sign-in popup, exchanges the resulting ID token for a
   * session with the server, then loads the account's save data - or, on
   * any failure, returns to {@linkcode showLoginRegister} with an error.
   */
  private async signInWithGoogle(): Promise<void> {
    const { ui, gameData } = globalScene;

    ui.setMode(UiMode.LOADING, { buttonActions: [] });

    let idToken: string;
    try {
      idToken = await googleSignIn();
    } catch (err) {
      console.warn("Google sign-in was cancelled or failed!", err);
      this.showLoginRegister();
      return;
    }

    const loginError = await pokerogueApi.account.loginWithGoogle(idToken);
    if (loginError) {
      ui.playError();
      this.showLoginRegister(loginError.trim());
      return;
    }

    const success = await this.checkUserInfo();
    if (!success) {
      return;
    }

    await gameData.loadSystem();
    this.end();
  }

  private async checkUserInfo(): Promise<boolean> {
    globalScene.ui.playSelect();
    const success = await updateUserInfo();
    if (!success[0]) {
      removeCookie(sessionIdKey);
      globalScene.reset(true, true);
      return false;
    }
    return true;
  }

  public goToLogin(): void {
    const { gameData, ui, phaseManager } = globalScene;

    const backButton = () => {
      phaseManager.unshiftNew("LoginPhase", false);
      this.end();
    };

    const loginButton = async () => {
      const success = await this.checkUserInfo();
      if (!success) {
        return;
      }
      await gameData.loadSystem();
      this.end();
    };
    audioManager.playSound("ui/menu_open");

    ui.setMode(UiMode.LOGIN_FORM, { buttonActions: [loginButton, backButton] });
  }

  public goToRegister(): void {
    const { phaseManager, ui } = globalScene;

    const backButton = () => {
      phaseManager.unshiftNew("LoginPhase", false);
      this.end();
    };

    const registerButton = async () => {
      const success = await this.checkUserInfo();
      if (!success) {
        return;
      }
      this.end();
    };
    audioManager.playSound("ui/menu_open");

    ui.setMode(UiMode.REGISTRATION_FORM, { buttonActions: [registerButton, backButton] });
  }
}

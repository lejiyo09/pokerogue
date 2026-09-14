import { ApiBase } from "#api/api-base";
import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import type {
  AccountChangePwRequest,
  AccountInfoResponse,
  AccountLoginRequest,
  AccountLoginResponse,
  AccountRegisterRequest,
} from "#types/api";
import { removeCookie, setCookie } from "#utils/cookies";

/** A wrapper for PokéRogue account API requests. */
export class PokerogueAccountApi extends ApiBase {
  /**
   * Request the {@linkcode AccountInfoResponse | UserInfo} of the logged in user.
   * The user is identified by the {@linkcode SESSION_ID_COOKIE_NAME | session cookie}.
   */
  public async getInfo(): Promise<[data: AccountInfoResponse | null, status: number]> {
    try {
      const response = await this.doGet("/account/info");

      if (response.ok) {
        const resData = (await response.json()) as AccountInfoResponse;
        return [resData, response.status];
      }
      console.warn("Could not get account info!", response.status, response.statusText);
      return [null, response.status];
    } catch (err) {
      console.warn("Could not get account info!", err);
      return [null, 500];
    }
  }

  /**
   * Register a new account.
   * @param registerData The {@linkcode AccountRegisterRequest} to send
   * @returns An error message if something went wrong
   */
  public async register(registerData: AccountRegisterRequest): Promise<string | null> {
    try {
      const response = await this.doPost("/account/register", registerData, "form-urlencoded");

      if (response.ok) {
        return null;
      }
      return response.text();
    } catch (err) {
      console.warn("Register failed!", err);
    }

    return "Unknown registration error!";
  }

  /**
   * Send a login request.
   * Sets the session cookie on success.
   *
   * Retries with a fixed delay on a network-level failure (e.g. a blocked
   * `fetch`) only - never on a real rejection the server sent back, like a
   * wrong password. Some hosting platforms' free tiers spin an idle backend
   * down and take 50+ seconds to wake it back up on the next request, during
   * which the first request of a session can fail this way before the
   * backend is reachable at all.
   * @param loginData The {@linkcode AccountLoginRequest} to send
   * @param maxAttempts Maximum number of attempts, including the first - exposed for testing
   * @param retryDelayMs Delay between attempts in milliseconds - exposed for testing
   * @returns An error message if something went wrong
   */
  public async login(loginData: AccountLoginRequest, maxAttempts = 12, retryDelayMs = 5_000): Promise<string | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.doPost("/account/login", loginData, "form-urlencoded");

        if (response.ok) {
          const loginResponse = (await response.json()) as AccountLoginResponse;
          setCookie(SESSION_ID_COOKIE_NAME, loginResponse.token);
          return null;
        }
        console.warn("Login failed!", response.status, response.statusText);
        return response.text();
      } catch (err) {
        console.warn("Login failed!", err);
        if (attempt === maxAttempts) {
          return "Unknown login error!";
        }
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }

    return "Unknown login error!";
  }

  /**
   * Send a logout request.
   * @remarks
   * **Always** (no matter if failed or not) removes the session cookie.
   */
  public async logout(): Promise<void> {
    try {
      const response = await this.doGet("/account/logout");

      if (!response.ok) {
        throw new Error(`${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      console.warn("Log out failed!", err);
    }

    removeCookie(SESSION_ID_COOKIE_NAME); // we are always clearing the cookie.
  }

  public async changePassword(changePwData: AccountChangePwRequest): Promise<string | null> {
    try {
      const response = await this.doPost("/account/changepw", changePwData, "form-urlencoded");
      if (response.ok) {
        return null;
      }
      console.warn("Change password failed!", response.status, response.statusText);
      return response.text();
    } catch (err) {
      console.warn("Change password failed!", err);
    }

    return "Unknown error!";
  }
}

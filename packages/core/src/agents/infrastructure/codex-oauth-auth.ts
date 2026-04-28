import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { KilnError } from "../../engine/errors.js";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE = "https://auth.openai.com";
const DEVICE_VERIFICATION_URI = "https://auth.openai.com/codex/device";
const DEVICE_CALLBACK_URI = "https://auth.openai.com/deviceauth/callback";
const DEFAULT_TOKEN_PATH = join(homedir(), ".kiln", "auth", "codex-oauth.json");
const AUTO_REFRESH_BUFFER_SECONDS = 120;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

interface DeviceAuthorizationApiResponse {
  readonly device_auth_id?: string;
  readonly user_code?: string;
  readonly interval?: number | string;
  readonly expires_at?: string;
  readonly error?: string;
}

interface DeviceTokenPollResponse {
  readonly authorization_code?: string;
  readonly code_verifier?: string;
  readonly error?: unknown;
}

interface OAuthTokenResponse {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly error?: string;
}

export interface CodexOAuthTokenFile {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_at: string;
  readonly client_id: string;
}

export interface DeviceAuthorizationResult {
  readonly deviceAuthId: string;
  readonly userCode: string;
  readonly intervalSeconds: number;
}

export interface PollAuthorizationParams {
  readonly deviceAuthId: string;
  readonly userCode: string;
  readonly intervalSeconds: number;
}

export interface CodexOAuthAuthOptions {
  readonly tokenPath?: string;
}

export class CodexOAuthAuth {
  private readonly tokenPath: string;

  constructor(options: CodexOAuthAuthOptions = {}) {
    this.tokenPath = options.tokenPath ?? DEFAULT_TOKEN_PATH;
  }

  async startDeviceAuthorization(): Promise<DeviceAuthorizationResult> {
    const body = JSON.stringify({
      client_id: CLIENT_ID,
    });

    const response = await fetch(`${AUTH_BASE}/api/accounts/deviceauth/usercode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const data = await this.parseJson<DeviceAuthorizationApiResponse>(response);
    if (!response.ok || !data.device_auth_id || !data.user_code) {
      throw this.authError("Failed to start Codex OAuth device authorization", {
        status: response.status,
        error: data.error,
      });
    }

    return {
      deviceAuthId: data.device_auth_id,
      userCode: data.user_code,
      intervalSeconds: this.parseIntervalSeconds(data.interval),
    };
  }

  async pollForAuthorization(params: PollAuthorizationParams): Promise<CodexOAuthTokenFile> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await this.sleep(params.intervalSeconds * 1000);

      const body = JSON.stringify({
        device_auth_id: params.deviceAuthId,
        user_code: params.userCode,
      });
      const response = await fetch(`${AUTH_BASE}/api/accounts/deviceauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (response.status === 403 || response.status === 404) {
        continue;
      }

      const data = await this.parseJson<DeviceTokenPollResponse>(response);
      if (!response.ok) {
        throw this.authError("Failed while polling Codex OAuth authorization", {
          status: response.status,
          error: data.error,
        });
      }

      if (!data.authorization_code || !data.code_verifier) {
        throw this.authError("Codex OAuth polling response missing authorization code", {
          status: response.status,
          error: data.error,
        });
      }

      return this.exchangeAuthorizationCode(data.authorization_code, data.code_verifier);
    }

    throw this.authError("Codex OAuth device authorization timed out", {
      timeoutMs: POLL_TIMEOUT_MS,
    });
  }

  async refreshToken(tokenFile: CodexOAuthTokenFile): Promise<CodexOAuthTokenFile> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenFile.refresh_token,
      client_id: CLIENT_ID,
    });

    const response = await fetch(`${AUTH_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await this.parseJson<OAuthTokenResponse>(response);
    if (!response.ok || !data.access_token || !data.refresh_token || typeof data.expires_in !== "number") {
      throw this.authError("Failed to refresh Codex OAuth token", {
        status: response.status,
        error: data.error,
      });
    }

    return this.toTokenFile(data);
  }

  async getValidAccessToken(): Promise<string> {
    const tokenFile = await this.loadTokenFile();
    if (!tokenFile) {
      throw this.authError("Codex OAuth token file not found", {
        tokenPath: this.tokenPath,
      });
    }
    const tokenValidationError = this.validateStoredCredentials(tokenFile);
    if (tokenValidationError) {
      throw this.authError("Codex OAuth token file has invalid credentials", {
        tokenPath: this.tokenPath,
        reason: tokenValidationError,
      });
    }

    if (!this.expiresWithinBuffer(tokenFile, AUTO_REFRESH_BUFFER_SECONDS)) {
      return tokenFile.access_token;
    }

    const refreshed = await this.refreshToken(tokenFile);
    await this.saveTokenFile(refreshed);
    return refreshed.access_token;
  }

  async saveTokenFile(tokenFile: CodexOAuthTokenFile): Promise<void> {
    await mkdir(dirname(this.tokenPath), { recursive: true });
    await writeFile(this.tokenPath, JSON.stringify(tokenFile, null, 2), "utf8");
  }

  async loadTokenFile(): Promise<CodexOAuthTokenFile | null> {
    try {
      const contents = await readFile(this.tokenPath, "utf8");
      return JSON.parse(contents) as CodexOAuthTokenFile;
    } catch (error) {
      if (this.isEnoent(error)) {
        return null;
      }
      throw this.authError("Failed to load Codex OAuth token file", {
        tokenPath: this.tokenPath,
      }, error);
    }
  }

  async clearTokenFile(): Promise<void> {
    try {
      await unlink(this.tokenPath);
    } catch (error) {
      if (!this.isEnoent(error)) {
        throw this.authError("Failed to clear Codex OAuth token file", {
          tokenPath: this.tokenPath,
        }, error);
      }
    }
  }

  async hasValidCredentials(): Promise<boolean> {
    const tokenFile = await this.loadTokenFile();
    if (!tokenFile) {
      return false;
    }

    return this.validateStoredCredentials(tokenFile) === null;
  }

  private async exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
  ): Promise<CodexOAuthTokenFile> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: DEVICE_CALLBACK_URI,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    });

    const response = await fetch(`${AUTH_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await this.parseJson<OAuthTokenResponse>(response);
    if (!response.ok || !data.access_token || !data.refresh_token || typeof data.expires_in !== "number") {
      throw this.authError("Failed to exchange Codex OAuth authorization code", {
        status: response.status,
        error: data.error,
      });
    }

    return this.toTokenFile(data);
  }

  private toTokenFile(token: OAuthTokenResponse): CodexOAuthTokenFile {
    return {
      access_token: token.access_token!,
      refresh_token: token.refresh_token!,
      expires_at: new Date(Date.now() + token.expires_in! * 1000).toISOString(),
      client_id: CLIENT_ID,
    };
  }

  private parseIntervalSeconds(interval: number | string | undefined): number {
    if (typeof interval === "number" && Number.isFinite(interval)) {
      return Math.max(3, interval);
    }

    if (typeof interval === "string") {
      const parsed = Number.parseInt(interval, 10);
      if (Number.isFinite(parsed)) {
        return Math.max(3, parsed);
      }
    }

    return 5;
  }

  private expiresWithinBuffer(tokenFile: CodexOAuthTokenFile, bufferSeconds: number): boolean {
    return new Date(tokenFile.expires_at).getTime() <= Date.now() + bufferSeconds * 1000;
  }

  private validateStoredCredentials(tokenFile: CodexOAuthTokenFile): string | null {
    if (!this.isNonEmptyTokenString(tokenFile.access_token)) {
      return "access_token must be a non-empty string";
    }
    if (!this.isNonEmptyTokenString(tokenFile.refresh_token)) {
      return "refresh_token must be a non-empty string";
    }
    const expiresAtMs = new Date(tokenFile.expires_at).getTime();
    if (!Number.isFinite(expiresAtMs)) {
      return "expires_at must be a valid timestamp";
    }
    if (expiresAtMs <= Date.now()) {
      return "expires_at must be in the future";
    }
    return null;
  }

  private isNonEmptyTokenString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }

  private async parseJson<T>(response: Response): Promise<T> {
    return await response.json() as T;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isEnoent(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
  }

  private authError(message: string, context: Record<string, unknown>, cause?: unknown): KilnError {
    return new KilnError("PROVIDER_AUTH_FAILED", message, { context, cause });
  }
}

export const CODEX_DEVICE_VERIFICATION_URI = DEVICE_VERIFICATION_URI;

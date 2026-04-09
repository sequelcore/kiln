import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { KilnError } from "../../engine/errors.js";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE = "https://auth.openai.com";
const DEFAULT_TOKEN_PATH = join(homedir(), ".kiln", "auth", "codex-oauth.json");
const AUTO_REFRESH_BUFFER_SECONDS = 120;

interface DeviceAuthorizationApiResponse {
  readonly device_code?: string;
  readonly user_code?: string;
  readonly verification_uri?: string;
  readonly interval?: number;
  readonly error?: string;
}

interface DeviceTokenPollResponse {
  readonly code?: string;
  readonly error?: string;
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
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly intervalSeconds: number;
  readonly codeVerifier: string;
}

export interface PollAuthorizationParams {
  readonly deviceCode: string;
  readonly intervalSeconds: number;
  readonly codeVerifier: string;
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
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const response = await fetch(`${AUTH_BASE}/api/accounts/deviceauth/usercode`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await this.parseJson<DeviceAuthorizationApiResponse>(response);
    if (!response.ok || !data.device_code || !data.user_code || !data.verification_uri) {
      throw this.authError("Failed to start Codex OAuth device authorization", {
        status: response.status,
        error: data.error,
      });
    }

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      intervalSeconds: data.interval ?? 5,
      codeVerifier,
    };
  }

  async pollForAuthorization(params: PollAuthorizationParams): Promise<CodexOAuthTokenFile> {
    while (true) {
      const body = new URLSearchParams({
        client_id: CLIENT_ID,
        device_code: params.deviceCode,
      });
      const response = await fetch(`${AUTH_BASE}/api/accounts/deviceauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      const data = await this.parseJson<DeviceTokenPollResponse>(response);
      if (!response.ok) {
        throw this.authError("Failed while polling Codex OAuth authorization", {
          status: response.status,
          error: data.error,
        });
      }

      if (data.code) {
        return this.exchangeAuthorizationCode(data.code, params.codeVerifier);
      }

      if (data.error === "authorization_pending") {
        await this.sleep(params.intervalSeconds * 1000);
        continue;
      }

      if (data.error === "expired_token") {
        throw this.authError("Codex OAuth device code expired", {
          error: data.error,
        });
      }

      throw this.authError("Unexpected Codex OAuth polling response", {
        error: data.error,
      });
    }
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

    return new Date(tokenFile.expires_at).getTime() > Date.now();
  }

  private async exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
  ): Promise<CodexOAuthTokenFile> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      client_id: CLIENT_ID,
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

  private generateCodeVerifier(): string {
    return randomBytes(32).toString("base64url");
  }

  private generateCodeChallenge(codeVerifier: string): string {
    return createHash("sha256").update(codeVerifier).digest("base64url");
  }

  private expiresWithinBuffer(tokenFile: CodexOAuthTokenFile, bufferSeconds: number): boolean {
    return new Date(tokenFile.expires_at).getTime() <= Date.now() + bufferSeconds * 1000;
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

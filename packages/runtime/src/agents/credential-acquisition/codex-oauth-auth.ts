import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { KilnError } from "@kilnai/core/engine";
import { CREDENTIAL_FILE_MODE, applyCredentialFileMode } from "./credential-file-mode.js";
import { resolveRuntimeKilnHome } from "../../kiln-home.js";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE = "https://auth.openai.com";
const DEVICE_VERIFICATION_URI = "https://auth.openai.com/codex/device";
const DEVICE_CALLBACK_URI = "https://auth.openai.com/deviceauth/callback";
const AUTO_REFRESH_BUFFER_SECONDS = 120;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const BROWSER_AUTHORIZATION_TIMEOUT_MS = 15 * 60 * 1000;
const BROWSER_CALLBACK_PORTS = [1455, 1457] as const;
const BROWSER_CALLBACK_PATH = "/auth/callback";
const OAUTH_SCOPE = "openid profile email offline_access api.connectors.read api.connectors.invoke";

function providerAuthDebug(message: string, context?: Record<string, unknown>): void {
  if (!/^(1|true|yes)$/i.test(process.env.KILN_PROVIDER_AUTH_DEBUG?.trim() ?? "")) {
    return;
  }
  console.warn(`[codex-oauth-auth][debug] ${message}`, context ?? {});
}

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
  readonly id_token?: string;
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
  /** Carried only for native-harness projection (e.g. `~/.codex/auth.json`); never required for Kiln's own API calls. */
  readonly id_token?: string;
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
  /** Canonical operator Kiln home supplied by CLI/Runtime composition. */
  readonly kilnHome?: string;
  readonly browserCallbackPorts?: readonly number[];
  readonly browserAuthorizationTimeoutMs?: number;
}

export interface BrowserAuthorizationResult {
  readonly authorizationUri: string;
  complete(): Promise<CodexOAuthTokenFile>;
  cancel(): void;
}

export class CodexOAuthAuth {
  private readonly tokenPath: string;
  private readonly browserCallbackPorts: readonly number[];
  private readonly browserAuthorizationTimeoutMs: number;

  constructor(options: CodexOAuthAuthOptions = {}) {
    this.tokenPath = options.tokenPath ?? join(resolveRuntimeKilnHome(options.kilnHome), "auth", "codex-oauth.json");
    this.browserCallbackPorts = options.browserCallbackPorts ?? BROWSER_CALLBACK_PORTS;
    this.browserAuthorizationTimeoutMs = options.browserAuthorizationTimeoutMs ?? BROWSER_AUTHORIZATION_TIMEOUT_MS;
  }

  async startBrowserAuthorization(): Promise<BrowserAuthorizationResult> {
    const codeVerifier = randomBytes(64).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const state = randomBytes(32).toString("base64url");
    let redirectUri = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let resolveCompletion!: (token: CodexOAuthTokenFile) => void;
    let rejectCompletion!: (error: unknown) => void;
    const completion = new Promise<CodexOAuthTokenFile>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    let settle!: (token?: CodexOAuthTokenFile, error?: unknown) => void;

    const server = createServer((request, response) => {
      void (async () => {
        const requestUrl = new URL(request.url ?? "/", redirectUri || "http://localhost");
        if (request.method !== "GET" || requestUrl.pathname !== BROWSER_CALLBACK_PATH) {
          this.respondToBrowser(response, 404, "Not found");
          return;
        }
        if (requestUrl.searchParams.get("state") !== state) {
          const error = this.authError("Codex OAuth callback state did not match", {
            callbackPath: BROWSER_CALLBACK_PATH,
          });
          this.respondToBrowser(response, 400, "Sign-in could not be verified. Return to Kiln and retry.");
          settle(undefined, error);
          return;
        }
        const oauthError = requestUrl.searchParams.get("error");
        if (oauthError) {
          const error = this.authError("Codex OAuth browser authorization was rejected", {
            error: oauthError,
            errorDescription: requestUrl.searchParams.get("error_description") ?? undefined,
          });
          this.respondToBrowser(response, 400, "Sign-in was not completed. Return to Kiln and retry.");
          settle(undefined, error);
          return;
        }
        const authorizationCode = requestUrl.searchParams.get("code")?.trim();
        if (!authorizationCode) {
          const error = this.authError("Codex OAuth callback did not include an authorization code", {
            callbackPath: BROWSER_CALLBACK_PATH,
          });
          this.respondToBrowser(response, 400, "Sign-in did not return an authorization code. Return to Kiln and retry.");
          settle(undefined, error);
          return;
        }
        try {
          const token = await this.exchangeAuthorizationCode(authorizationCode, codeVerifier, redirectUri);
          this.respondToBrowser(response, 200, "Sign-in complete. You can close this window and return to Kiln.");
          settle(token);
        } catch (error) {
          this.respondToBrowser(response, 502, "Sign-in completed, but Kiln could not exchange the authorization code. Return to Kiln and retry.");
          settle(undefined, error);
        }
      })();
    });

    const closeServer = (): void => {
      if (timeout) clearTimeout(timeout);
      server.close();
    };
    settle = (token?: CodexOAuthTokenFile, error?: unknown): void => {
      if (settled) return;
      settled = true;
      closeServer();
      if (token) resolveCompletion(token);
      else rejectCompletion(error ?? this.authError("Codex OAuth browser authorization failed", {}));
    };

    const port = await this.listenOnFirstAvailablePort(server);
    redirectUri = `http://localhost:${port}${BROWSER_CALLBACK_PATH}`;
    const authorizationUri = new URL(`${AUTH_BASE}/oauth/authorize`);
    authorizationUri.search = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      scope: OAUTH_SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      state,
      originator: "kiln",
    }).toString();
    timeout = setTimeout(() => {
      settle(undefined, this.authError("Codex OAuth browser authorization timed out", {
        timeoutMs: this.browserAuthorizationTimeoutMs,
      }));
    }, this.browserAuthorizationTimeoutMs);
    timeout.unref?.();

    providerAuthDebug("browser authorization started", {
      callbackPort: port,
      timeoutMs: this.browserAuthorizationTimeoutMs,
    });
    return {
      authorizationUri: authorizationUri.toString(),
      complete: () => completion,
      cancel: () => settle(undefined, this.authError("Codex OAuth browser authorization was cancelled", {})),
    };
  }

  async startDeviceAuthorization(): Promise<DeviceAuthorizationResult> {
    providerAuthDebug("starting device authorization", {
      tokenPath: this.tokenPath,
      endpoint: "/api/accounts/deviceauth/usercode",
    });
    const body = JSON.stringify({
      client_id: CLIENT_ID,
    });

    const response = await fetch(`${AUTH_BASE}/api/accounts/deviceauth/usercode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const data = await this.parseJson<DeviceAuthorizationApiResponse>(response);
    providerAuthDebug("device authorization response", {
      status: response.status,
      ok: response.ok,
      hasDeviceAuthId: Boolean(data.device_auth_id),
      hasUserCode: Boolean(data.user_code),
      interval: data.interval,
      expiresAt: data.expires_at,
      error: data.error,
    });
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
    let attempt = 0;
    providerAuthDebug("polling device authorization", {
      intervalSeconds: params.intervalSeconds,
      timeoutMs: POLL_TIMEOUT_MS,
    });

    while (Date.now() < deadline) {
      attempt += 1;
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
        providerAuthDebug("device authorization pending", {
          attempt,
          status: response.status,
        });
        continue;
      }

      const data = await this.parseJson<DeviceTokenPollResponse>(response);
      providerAuthDebug("device authorization poll response", {
        attempt,
        status: response.status,
        ok: response.ok,
        hasAuthorizationCode: Boolean(data.authorization_code),
        hasCodeVerifier: Boolean(data.code_verifier),
        error: data.error,
      });
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

      providerAuthDebug("device authorization approved; exchanging authorization code", {
        attempt,
      });
      return this.exchangeAuthorizationCode(data.authorization_code, data.code_verifier);
    }

    throw this.authError("Codex OAuth device authorization timed out", {
      timeoutMs: POLL_TIMEOUT_MS,
    });
  }

  async refreshToken(tokenFile: CodexOAuthTokenFile): Promise<CodexOAuthTokenFile> {
    providerAuthDebug("refreshing token", {
      tokenPath: this.tokenPath,
      expiresAt: tokenFile.expires_at,
    });
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
    providerAuthDebug("refresh token response", {
      status: response.status,
      ok: response.ok,
      hasAccessToken: Boolean(data.access_token),
      hasRefreshToken: Boolean(data.refresh_token),
      hasIdToken: Boolean(data.id_token),
      expiresIn: data.expires_in,
      error: data.error,
    });
    if (!response.ok || !data.access_token || !data.refresh_token) {
      throw this.authError("Failed to refresh Codex OAuth token", {
        status: response.status,
        error: data.error,
      });
    }

    return this.toTokenFile(data, tokenFile.id_token);
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
    providerAuthDebug("saving token file", {
      tokenPath: this.tokenPath,
      expiresAt: tokenFile.expires_at,
      hasAccessToken: this.isNonEmptyTokenString(tokenFile.access_token),
      hasRefreshToken: this.isNonEmptyTokenString(tokenFile.refresh_token),
    });
    await mkdir(dirname(this.tokenPath), { recursive: true });
    await writeFile(this.tokenPath, JSON.stringify(tokenFile, null, 2), {
      encoding: "utf8",
      mode: CREDENTIAL_FILE_MODE,
    });
    // Creation mode does not cover a file that already existed, so a credential
    // written before this invariant repairs itself on its next refresh.
    await applyCredentialFileMode(this.tokenPath);
    providerAuthDebug("token file saved", {
      tokenPath: this.tokenPath,
    });
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
    redirectUri = DEVICE_CALLBACK_URI,
  ): Promise<CodexOAuthTokenFile> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    });

    const response = await fetch(`${AUTH_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await this.parseJson<OAuthTokenResponse>(response);
    providerAuthDebug("authorization code exchange response", {
      status: response.status,
      ok: response.ok,
      hasAccessToken: Boolean(data.access_token),
      hasRefreshToken: Boolean(data.refresh_token),
      hasIdToken: Boolean(data.id_token),
      expiresIn: data.expires_in,
      error: data.error,
    });
    if (!response.ok || !data.access_token || !data.refresh_token) {
      throw this.authError("Failed to exchange Codex OAuth authorization code", {
        status: response.status,
        error: data.error,
      });
    }

    return this.toTokenFile(data);
  }

  private toTokenFile(token: OAuthTokenResponse, previousIdToken?: string): CodexOAuthTokenFile {
    const expiresAt = this.resolveExpiresAt(token);
    providerAuthDebug("resolved token expiry", {
      expiresAt,
      hadExpiresIn: typeof token.expires_in === "number",
      hasAccessTokenJwtExpiry: Boolean(this.readJwtExpiry(token.access_token)),
      hasIdTokenJwtExpiry: Boolean(this.readJwtExpiry(token.id_token)),
    });
    // Refresh responses sometimes omit id_token and expect the prior one to remain valid.
    const idToken = token.id_token ?? previousIdToken;
    return {
      access_token: token.access_token!,
      refresh_token: token.refresh_token!,
      expires_at: expiresAt,
      client_id: CLIENT_ID,
      ...(idToken ? { id_token: idToken } : {}),
    };
  }

  private resolveExpiresAt(token: OAuthTokenResponse): string {
    if (typeof token.expires_in === "number" && Number.isFinite(token.expires_in) && token.expires_in > 0) {
      return new Date(Date.now() + token.expires_in * 1000).toISOString();
    }
    const accessTokenExpiry = this.readJwtExpiry(token.access_token);
    if (accessTokenExpiry) {
      return accessTokenExpiry;
    }
    const idTokenExpiry = this.readJwtExpiry(token.id_token);
    if (idTokenExpiry) {
      return idTokenExpiry;
    }
    return new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }

  private readJwtExpiry(token: string | undefined): string | null {
    const payload = token?.split(".")[1];
    if (!payload) {
      return null;
    }
    try {
      const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
      const decoded = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      const parsed = JSON.parse(decoded) as { exp?: unknown };
      if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp) || parsed.exp <= 0) {
        return null;
      }
      return new Date(parsed.exp * 1000).toISOString();
    } catch {
      return null;
    }
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
    const body = await response.text();
    try {
      return JSON.parse(body) as T;
    } catch (cause) {
      throw this.authError("Codex OAuth endpoint returned a non-JSON response", {
        status: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
        bodyLength: body.length,
      }, cause);
    }
  }

  private async listenOnFirstAvailablePort(server: Server): Promise<number> {
    let lastError: unknown;
    for (const port of this.browserCallbackPorts) {
      try {
        return await new Promise<number>((resolve, reject) => {
          const onError = (error: unknown): void => {
            server.off("listening", onListening);
            reject(error);
          };
          const onListening = (): void => {
            server.off("error", onError);
            const address = server.address();
            if (!address || typeof address === "string") {
              reject(new Error("Unable to resolve Codex OAuth callback port"));
              return;
            }
            resolve(address.port);
          };
          server.once("error", onError);
          server.once("listening", onListening);
          server.listen(port, "127.0.0.1");
        });
      } catch (error) {
        lastError = error;
      }
    }
    throw this.authError("Unable to start the Codex OAuth browser callback", {
      callbackPorts: this.browserCallbackPorts,
    }, lastError);
  }

  private respondToBrowser(response: ServerResponse, status: number, message: string): void {
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Kiln sign-in</title><body><main><h1>${message}</h1></main></body></html>`);
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
export const CODEX_OAUTH_CLIENT_ID = CLIENT_ID;

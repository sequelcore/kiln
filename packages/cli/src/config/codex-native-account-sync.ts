import type { CodexOAuthTokenFile } from "@kilnai/core";
import { CODEX_OAUTH_CLIENT_ID } from "@kilnai/core";

/**
 * Shape of `~/.codex/auth.json` as written/read by the native Codex CLI/App
 * (see `codex-rs/login/src/token_data.rs` `TokenData` / `AuthDotJson`).
 * Kiln never assumes this is stable across upstream Codex releases beyond
 * what's validated here.
 */
export interface NativeCodexAuthFile {
  readonly auth_mode: "chatgpt";
  readonly OPENAI_API_KEY: string | null;
  readonly tokens: {
    readonly id_token?: string;
    readonly access_token: string;
    readonly refresh_token: string;
    readonly account_id: string | null;
  };
  readonly last_refresh: string;
}

export function parseNativeCodexAuthFile(value: unknown): NativeCodexAuthFile | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const tokens = record.tokens;
  if (typeof tokens !== "object" || tokens === null) return null;
  const tokensRecord = tokens as Record<string, unknown>;
  const accessToken = tokensRecord.access_token;
  const refreshToken = tokensRecord.refresh_token;
  if (typeof accessToken !== "string" || accessToken.trim().length === 0) return null;
  if (typeof refreshToken !== "string" || refreshToken.trim().length === 0) return null;
  const idToken = typeof tokensRecord.id_token === "string" && tokensRecord.id_token.trim().length > 0
    ? tokensRecord.id_token
    : undefined;
  const accountId = typeof tokensRecord.account_id === "string" ? tokensRecord.account_id : null;
  return {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      ...(idToken ? { id_token: idToken } : {}),
      access_token: accessToken,
      refresh_token: refreshToken,
      account_id: accountId,
    },
    last_refresh: typeof record.last_refresh === "string" ? record.last_refresh : new Date(0).toISOString(),
  };
}

/** Absorb whatever account is currently active in native `auth.json` into Kiln's pool shape. */
export function fromNativeCodexAuthFile(native: NativeCodexAuthFile): CodexOAuthTokenFile {
  return {
    access_token: native.tokens.access_token,
    refresh_token: native.tokens.refresh_token,
    expires_at: readJwtExpiry(native.tokens.access_token) ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    client_id: CODEX_OAUTH_CLIENT_ID,
    ...(native.tokens.id_token ? { id_token: native.tokens.id_token } : {}),
  };
}

/** Project a pooled Kiln credential into the shape native Codex CLI/App expects at `~/.codex/auth.json`. */
export function toNativeCodexAuthFile(tokenFile: CodexOAuthTokenFile, nowIso: string): NativeCodexAuthFile {
  return {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      ...(tokenFile.id_token ? { id_token: tokenFile.id_token } : {}),
      access_token: tokenFile.access_token,
      refresh_token: tokenFile.refresh_token,
      account_id: readChatgptAccountId(tokenFile.access_token),
    },
    last_refresh: nowIso,
  };
}

function readChatgptAccountId(accessToken: string): string | null {
  const claims = decodeJwtPayload(accessToken);
  const auth = claims?.["https://api.openai.com/auth"];
  if (typeof auth !== "object" || auth === null || Array.isArray(auth)) return null;
  const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
  return typeof accountId === "string" && accountId.trim().length > 0 ? accountId.trim() : null;
}

function readJwtExpiry(accessToken: string): string | null {
  const claims = decodeJwtPayload(accessToken);
  const exp = claims?.exp;
  return typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000).toISOString() : null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

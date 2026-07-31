import { describe, expect, it } from "vitest";
import {
  fromNativeCodexAuthFile,
  parseNativeCodexAuthFile,
  toNativeCodexAuthFile,
} from "../../src/config/codex-native-account-sync.js";

function jwtWithClaims(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

describe("codex-native-account-sync", () => {
  it("round-trips a pooled credential into native shape and back with account id and expiry preserved", () => {
    const accessToken = jwtWithClaims({
      exp: 4_070_908_800,
      "https://api.openai.com/auth": { chatgpt_account_id: "account-uuid" },
    });
    const pooled = {
      access_token: accessToken,
      refresh_token: "refresh",
      expires_at: "2099-01-01T00:00:00.000Z",
      client_id: "client",
      id_token: "id-token-value",
    };

    const native = toNativeCodexAuthFile(pooled, "2026-07-31T00:00:00.000Z");
    expect(native).toEqual({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: "id-token-value",
        access_token: accessToken,
        refresh_token: "refresh",
        account_id: "account-uuid",
      },
      last_refresh: "2026-07-31T00:00:00.000Z",
    });

    const parsed = parseNativeCodexAuthFile(native);
    expect(parsed).not.toBeNull();
    const absorbed = fromNativeCodexAuthFile(parsed!);
    expect(absorbed.access_token).toBe(accessToken);
    expect(absorbed.refresh_token).toBe("refresh");
    expect(absorbed.id_token).toBe("id-token-value");
    expect(absorbed.expires_at).toBe(new Date(4_070_908_800 * 1000).toISOString());
  });

  it("rejects native files missing required token fields", () => {
    expect(parseNativeCodexAuthFile({ tokens: { access_token: "only-access" } })).toBeNull();
    expect(parseNativeCodexAuthFile({})).toBeNull();
    expect(parseNativeCodexAuthFile(null)).toBeNull();
  });

  it("omits account_id when the access token carries no chatgpt_account_id claim", () => {
    const pooled = {
      access_token: jwtWithClaims({ exp: 4_070_908_800 }),
      refresh_token: "refresh",
      expires_at: "2099-01-01T00:00:00.000Z",
      client_id: "client",
    };
    const native = toNativeCodexAuthFile(pooled, "2026-07-31T00:00:00.000Z");
    expect(native.tokens.account_id).toBeNull();
    expect(native.tokens.id_token).toBeUndefined();
  });
});

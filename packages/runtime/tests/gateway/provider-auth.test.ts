import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startProviderAuthRequest } from "../../src/gateway/provider-auth.js";

const coreMocks = vi.hoisted(() => {
  const startDeviceAuthorization = vi.fn();
  const pollForAuthorization = vi.fn();
  const linkCodexCredential = vi.fn();
  const linkOpenCodeCredential = vi.fn();

  return {
    startDeviceAuthorization,
    pollForAuthorization,
    linkCodexCredential,
    linkOpenCodeCredential,
    CodexOAuthAuth: vi.fn(function CodexOAuthAuth() {
      return {
        startDeviceAuthorization,
        pollForAuthorization,
      };
    }),
  };
});

vi.mock("@kilnai/core", () => ({
  CODEX_DEVICE_VERIFICATION_URI: "https://mock.openai.com/activate",
  CodexOAuthAuth: coreMocks.CodexOAuthAuth,
}));

vi.mock("../../src/agents/credential-pool/index.js", () => ({
  CodexOAuthCredentialPoolService: class MockCodexOAuthCredentialPoolService {
    linkCredential(options: unknown) {
      return coreMocks.linkCodexCredential(options);
    }
  },
  OpenCodeCredentialPoolService: class MockOpenCodeCredentialPoolService {
    linkCredential(options: unknown) {
      return coreMocks.linkOpenCodeCredential(options);
    }
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-28T20:00:00.000Z"));
  coreMocks.startDeviceAuthorization.mockReset();
  coreMocks.pollForAuthorization.mockReset();
  coreMocks.linkCodexCredential.mockReset();
  coreMocks.linkOpenCodeCredential.mockReset();
  coreMocks.CodexOAuthAuth.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startProviderAuthRequest", () => {
  it("starts Codex OAuth device-code authentication and saves the completed token", async () => {
    coreMocks.startDeviceAuthorization.mockResolvedValueOnce({
      deviceAuthId: "device-auth-1",
      userCode: "ABCD-EFGH",
      intervalSeconds: 5,
    });
    coreMocks.pollForAuthorization.mockResolvedValueOnce({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_at: "2026-04-28T21:00:00.000Z",
      client_id: "client-id",
    });

    const auth = await startProviderAuthRequest({
      provider: "codex-oauth",
      requestId: "provider-auth-1",
    });

    expect(auth.ok).toBe(true);
    if (!auth.ok) throw new Error(auth.error);
    expect(auth.started).toEqual({
      type: "provider_auth_started",
      provider: "codex-oauth",
      requestId: "provider-auth-1",
      method: "device_code",
      verificationUri: "https://mock.openai.com/activate",
      userCode: "ABCD-EFGH",
      message: "Complete Codex sign-in in the browser, then return to Kiln.",
    });

    await auth.complete();

    expect(coreMocks.CodexOAuthAuth).toHaveBeenCalledTimes(1);
    expect(coreMocks.pollForAuthorization).toHaveBeenCalledWith({
      deviceAuthId: "device-auth-1",
      userCode: "ABCD-EFGH",
      intervalSeconds: 5,
    });
    expect(coreMocks.linkCodexCredential).toHaveBeenCalledWith({
      tokenFile: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: "2026-04-28T21:00:00.000Z",
        client_id: "client-id",
      },
    });
  });

  it("saves OpenCode API-key authentication using provider metadata tier", async () => {
    const auth = await startProviderAuthRequest({
      provider: "opencode-zen",
      requestId: "provider-auth-2",
      apiKey: "  sk-test  ",
    });

    expect(auth.ok).toBe(true);
    if (!auth.ok) throw new Error(auth.error);

    await auth.complete();

    expect(coreMocks.linkOpenCodeCredential).toHaveBeenCalledWith({
      apiKey: "sk-test",
      tier: "zen",
      createdAt: "2026-04-28T20:00:00.000Z",
    });
  });

  it("rejects providers without an interactive authentication method", async () => {
    const auth = await startProviderAuthRequest({
      provider: "anthropic",
      requestId: "provider-auth-3",
    });

    expect(auth).toEqual({
      ok: false,
      provider: "anthropic",
      requestId: "provider-auth-3",
      error: "Provider 'anthropic' does not support interactive authentication",
    });
  });

  it("rejects CLI harness providers because Kiln-managed auth cannot satisfy their discovery", async () => {
    await expect(startProviderAuthRequest({
      provider: "codex",
      requestId: "provider-auth-4",
    })).resolves.toEqual({
      ok: false,
      provider: "codex",
      requestId: "provider-auth-4",
      error: "Provider 'codex' does not support interactive authentication",
    });

    await expect(startProviderAuthRequest({
      provider: "opencode",
      requestId: "provider-auth-5",
      apiKey: "sk-test",
    })).resolves.toEqual({
      ok: false,
      provider: "opencode",
      requestId: "provider-auth-5",
      error: "Provider 'opencode' does not support interactive authentication",
    });
  });
});

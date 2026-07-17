import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentResponse, CodexOAuthTokenFile, CreateMessageOptions, ProviderAdapter } from "@kilnai/core";
import { AllCredentialsExhaustedError, KilnError } from "@kilnai/core";
import {
  CodexOAuthCredentialPoolService,
  mapCodexOAuthProviderError,
} from "../../src/agents/credential-pool/codex-oauth-credential-pool.js";

function token(overrides: Partial<CodexOAuthTokenFile> = {}): CodexOAuthTokenFile {
  return {
    access_token: "access",
    refresh_token: "refresh",
    expires_at: "2099-01-01T00:00:00.000Z",
    client_id: "client",
    ...overrides,
  };
}

function makeOptions(): CreateMessageOptions {
  return {
    system: "system",
    messages: [],
  };
}

function makeResponse(text: string): AgentResponse {
  return {
    parts: [{ type: "text", text }],
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: [],
    stopReason: "stop",
  };
}

class TestAdapter implements ProviderAdapter {
  readonly name = "test";

  constructor(
    private readonly handler: () => Promise<AgentResponse>,
  ) {}

  createMessage(): Promise<AgentResponse> {
    return this.handler();
  }

  async *streamMessage() {
    yield { type: "done" as const, content: "" };
  }
}

describe("CodexOAuthCredentialPoolService", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kiln-codex-oauth-pool-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("links Codex OAuth credentials as raw token files and projects secret-free status", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });

    await service.linkCredential({
      id: "work",
      tokenFile: token({ access_token: "access-work", refresh_token: "refresh-work" }),
    });

    const raw = JSON.parse(await readFile(join(rootDir, "codex-oauth", "work.json"), "utf8"));
    expect(raw).toEqual({
      access_token: "access-work",
      refresh_token: "refresh-work",
      expires_at: "2099-01-01T00:00:00.000Z",
      client_id: "client",
    });

    const status = await service.listStatus();
    expect(status).toEqual([{
      id: "work",
      label: "work",
      expiresAt: "2099-01-01T00:00:00.000Z",
      status: "valid",
      health: undefined,
    }]);
    expect(JSON.stringify(status)).not.toContain("access-work");
    expect(JSON.stringify(status)).not.toContain("refresh-work");
  });

  it("ignores unrelated singleton files and only reads directory credentials", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await mkdir(join(rootDir, "codex-oauth"), { recursive: true });
    await writeFile(join(rootDir, "codex-oauth", "existing.json"), JSON.stringify(token({
      access_token: "access-existing",
      refresh_token: "refresh-existing",
    })), "utf8");
    await writeFile(join(rootDir, "codex-oauth.json"), JSON.stringify(token({
      access_token: "access-singleton",
      refresh_token: "refresh-singleton",
    })), "utf8");

    await expect(service.listStatus()).resolves.toEqual([expect.objectContaining({
      id: "existing",
      status: "valid",
    })]);
    expect(await readFile(join(rootDir, "codex-oauth.json"), "utf8")).toContain("access-singleton");
  });

  it("resolves valid access tokens from canonical pooled credential files", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "pooled", tokenFile: token({ access_token: "access-pooled" }) });
    await writeFile(join(rootDir, "codex-oauth.json"), JSON.stringify(token({
      access_token: "access-singleton",
    })), "utf8");

    await expect(service.getValidAccessToken()).resolves.toBe("access-pooled");
  });

  it("keeps expired credentials visible in status but excludes them from execution pools", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({
      id: "expired",
      tokenFile: token({
        access_token: "access-expired",
        expires_at: "2020-01-01T00:00:00.000Z",
      }),
    });
    await service.linkCredential({ id: "valid", tokenFile: token({ access_token: "access-valid" }) });
    const calls: string[] = [];

    const adapter = await service.createPooledAdapter({
      defaultModel: "model",
      createAdapter: (credential) => new TestAdapter(async () => {
        calls.push(credential.tokenFile.access_token);
        return makeResponse("ok");
      }),
    });

    await expect(adapter.createMessage(makeOptions())).resolves.toEqual(makeResponse("ok"));
    expect(calls).toEqual(["access-valid"]);
    await expect(service.listStatus()).resolves.toEqual([
      expect.objectContaining({ id: "expired", status: "expired" }),
      expect.objectContaining({ id: "valid", status: "valid" }),
    ]);
  });

  it("fails fast with secret-free diagnostics when no Codex OAuth credential is executable", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({
      id: "expired",
      tokenFile: token({
        access_token: "access-expired",
        refresh_token: "refresh-expired",
        expires_at: "2020-01-01T00:00:00.000Z",
      }),
    });
    await mkdir(join(rootDir, "codex-oauth"), { recursive: true });
    await writeFile(join(rootDir, "codex-oauth", "invalid.json"), JSON.stringify({
      access_token: "",
      refresh_token: "refresh-invalid",
      expires_at: "2099-01-01T00:00:00.000Z",
      client_id: "client",
    }), "utf8");

    await expect(service.createPooledAdapter({ defaultModel: "gpt-5.5" }))
      .rejects.toMatchObject({
        name: "AllCredentialsExhaustedError",
        diagnostic: {
          providerId: "codex-oauth",
          reason: "no-executable-credentials",
          totalCredentials: 2,
          availableCredentials: 0,
          unavailableCredentials: 2,
          entries: [
            expect.objectContaining({
              id: "expired",
              health: "expired",
              expiresAt: "2020-01-01T00:00:00.000Z",
            }),
            expect.objectContaining({
              id: "invalid",
              health: "invalid",
              expiresAt: "unknown",
              invalidReason: expect.stringContaining("Malformed Codex OAuth credential file"),
            }),
          ],
        },
      });

    try {
      await service.createPooledAdapter({ defaultModel: "gpt-5.5" });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("access-expired");
      expect(JSON.stringify(error)).not.toContain("refresh-expired");
      expect(JSON.stringify(error)).not.toContain("refresh-invalid");
    }
  });

  it("projects malformed credentials as invalid status and excludes them from execution pools", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await mkdir(join(rootDir, "codex-oauth"), { recursive: true });
    await writeFile(join(rootDir, "codex-oauth", "invalid.json"), JSON.stringify({
      access_token: "",
      refresh_token: "refresh",
      expires_at: "2099-01-01T00:00:00.000Z",
      client_id: "client",
    }), "utf8");
    await service.linkCredential({ id: "valid", tokenFile: token({ access_token: "access-valid" }) });
    const calls: string[] = [];

    const adapter = await service.createPooledAdapter({
      defaultModel: "model",
      createAdapter: (credential) => new TestAdapter(async () => {
        calls.push(credential.tokenFile.access_token);
        return makeResponse("ok");
      }),
    });

    await expect(adapter.createMessage(makeOptions())).resolves.toEqual(makeResponse("ok"));
    expect(calls).toEqual(["access-valid"]);
    const status = await service.listStatus();
    expect(status).toEqual([
      expect.objectContaining({
        id: "invalid",
        status: "invalid",
        expiresAt: "unknown",
        invalidReason: expect.stringContaining("Malformed Codex OAuth credential file"),
      }),
      expect.objectContaining({ id: "valid", status: "valid" }),
    ]);
    expect(JSON.stringify(status)).not.toContain("refresh");
  });

  it("creates a pooled adapter that rotates on rate limits and binds each token path", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "first", tokenFile: token({ access_token: "access-first" }) });
    await service.linkCredential({ id: "second", tokenFile: token({ access_token: "access-second" }) });
    const calls: string[] = [];
    const tokenPaths: string[] = [];

    const adapter = await service.createPooledAdapter({
      defaultModel: "model",
      createAdapter: (credential) => {
        tokenPaths.push(credential.tokenPath);
        return new TestAdapter(async () => {
          calls.push(credential.tokenFile.access_token);
          if (credential.tokenFile.access_token === "access-first") {
            const error = new Error("rate limited");
            (error as { status?: number }).status = 429;
            throw error;
          }
          return makeResponse("ok");
        });
      },
    });

    await expect(adapter.createMessage(makeOptions())).resolves.toEqual(makeResponse("ok"));
    expect(calls).toEqual(["access-first", "access-second"]);
    expect(tokenPaths).toEqual([
      join(rootDir, "codex-oauth", "first.json"),
      join(rootDir, "codex-oauth", "second.json"),
    ]);
  });

  it("rotates on auth failures so stale Codex OAuth credentials do not block fresh credentials", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "first", tokenFile: token({ access_token: "access-invalidated" }) });
    await service.linkCredential({ id: "second", tokenFile: token({ access_token: "access-fresh" }) });
    const calls: string[] = [];

    const adapter = await service.createPooledAdapter({
      defaultModel: "model",
      createAdapter: (credential) => new TestAdapter(async () => {
        calls.push(credential.tokenFile.access_token);
        if (credential.tokenFile.access_token === "access-invalidated") {
          const error = new Error("token invalidated");
          (error as { status?: number }).status = 401;
          throw error;
        }
        return makeResponse("ok");
      }),
    });

    await expect(adapter.createMessage(makeOptions())).resolves.toEqual(makeResponse("ok"));
    expect(calls).toEqual(["access-invalidated", "access-fresh"]);
    await expect(service.listStatus()).resolves.toEqual([
      expect.objectContaining({
        id: "first",
        status: "invalid",
        invalidReason: "Provider rejected this credential. Sign in again.",
      }),
      expect.objectContaining({ id: "second", status: "valid" }),
    ]);
    await expect(service.listValidAccessTokenCandidates()).resolves.toEqual([
      { credentialId: "second", accessToken: "access-fresh" },
    ]);
  });

  it("resets persisted authentication failure when the operator relinks the same credential", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "work", tokenFile: token({ access_token: "access-revoked" }) });
    await service.recordAuthenticationFailure("work");

    await expect(service.listStatus()).resolves.toEqual([
      expect.objectContaining({ id: "work", status: "invalid" }),
    ]);

    await service.linkCredential({ id: "work", tokenFile: token({ access_token: "access-new" }) });

    await expect(service.listStatus()).resolves.toEqual([
      expect.objectContaining({ id: "work", status: "valid", health: undefined }),
    ]);
    await expect(service.getValidAccessToken()).resolves.toBe("access-new");
  });

  it("throws AllCredentialsExhaustedError when all Codex OAuth entries are exhausted", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "only", tokenFile: token() });

    const adapter = await service.createPooledAdapter({
      defaultModel: "model",
      createAdapter: () => new TestAdapter(async () => {
        const error = new Error("rate limited");
        (error as { status?: number }).status = 429;
        throw error;
      }),
    });

    await expect(adapter.createMessage(makeOptions())).rejects.toBeInstanceOf(AllCredentialsExhaustedError);
  });

  it("maps provider failures into credential outcomes", () => {
    expect(mapCodexOAuthProviderError(Object.assign(new Error("rate"), { status: 429 }))).toEqual({ type: "rate-limited" });
    expect(mapCodexOAuthProviderError(Object.assign(new Error("quota"), { status: 402 }))).toEqual({ type: "quota-exceeded" });
    expect(mapCodexOAuthProviderError(Object.assign(new Error("auth"), { status: 401 }))).toEqual({ type: "auth-failed" });
    expect(mapCodexOAuthProviderError(new TypeError("fetch failed"))).toEqual({ type: "connection-failed" });
    expect(mapCodexOAuthProviderError(new KilnError("PROVIDER_AUTH_FAILED", "failed", { context: { status: 429 } })))
      .toEqual({ type: "rate-limited" });
    expect(mapCodexOAuthProviderError(new KilnError("PROVIDER_AUTH_FAILED", "invalid credentials")))
      .toEqual({ type: "auth-failed" });
  });

  it("can use a custom adapter factory for direct Codex OAuth adapters", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "only", tokenFile: token({ access_token: "access-only" }) });
    const createAdapter = vi.fn((credential) => new TestAdapter(async () => makeResponse(credential.tokenFile.access_token)));

    const adapter = await service.createPooledAdapter({
      defaultModel: "model",
      createAdapter,
    });

    await adapter.createMessage(makeOptions());
    expect(createAdapter).toHaveBeenCalledWith({
      tokenFile: token({ access_token: "access-only" }),
      tokenPath: join(rootDir, "codex-oauth", "only.json"),
    });
  });
});

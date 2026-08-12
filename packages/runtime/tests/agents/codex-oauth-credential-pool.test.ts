import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
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

function accountToken(accountId: string, overrides: Partial<CodexOAuthTokenFile> = {}): CodexOAuthTokenFile {
  const payload = Buffer.from(JSON.stringify({
    exp: 4_070_908_800,
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  })).toString("base64url");
  return token({ access_token: `header.${payload}.signature`, ...overrides });
}

function tokenWithEmail(email: string, overrides: Partial<CodexOAuthTokenFile> = {}): CodexOAuthTokenFile {
  const payload = Buffer.from(JSON.stringify({
    exp: 4_070_908_800,
    "https://api.openai.com/profile": { email },
  })).toString("base64url");
  return token({ access_token: `header.${payload}.signature`, ...overrides });
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
    vi.unstubAllGlobals();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("enumerates exact accounts without secrets and resolves only the selected credential", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "selected", tokenFile: accountToken("account-a") });
    await mkdir(join(rootDir, "codex-oauth"), { recursive: true });
    await writeFile(join(rootDir, "codex-oauth", "unselected.json"), "{malformed", "utf8");

    const accounts = await service.listExecutionAccounts();
    expect(accounts.map((entry) => entry.credentialId)).toEqual(["selected", "unselected"]);
    expect(accounts.every((entry) => /^[a-f0-9]{64}$/.test(entry.revision))).toBe(true);
    expect(JSON.stringify(accounts)).not.toMatch(/access|refresh|token/i);
    await expect(service.listExecutableAccounts()).resolves.toEqual([
      expect.objectContaining({ credentialId: "selected" }),
    ]);
    await expect(service.resolveExecutionCredential(accounts.find((entry) => entry.credentialId === "selected")!)).resolves.toMatchObject({ credentialId: "selected", chatgptAccountId: "account-a", accessToken: expect.any(String) });
    await expect(service.resolveExecutionCredential({ credentialId: "missing", fileIdentity: "0".repeat(64), revision: "0".repeat(64) })).rejects.toThrow("unavailable");
    await expect(service.resolveExecutionCredential({ credentialId: "../escape", fileIdentity: "0".repeat(64), revision: "0".repeat(64) })).rejects.toThrow("Invalid");
  });

  it("fails closed for unhealthy selected credentials", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "work", tokenFile: accountToken("account-a") });
    const [selected] = await service.listExecutionAccounts();
    await service.recordAuthenticationFailure("work");
    await expect(service.listExecutionAccounts()).resolves.toEqual([]);
    await expect(service.resolveExecutionCredential(selected!)).rejects.toThrow("unhealthy");
  });

  it("refreshes opt-in usage per exact credential and removes only selected credential state", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "work", tokenFile: accountToken("account-a") });
    await service.linkCredential({ id: "free", tokenFile: accountToken("account-b") });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const accountId = headers.get("chatgpt-account-id");
      return new Response(JSON.stringify({
        plan_type: accountId === "account-a" ? "plus" : "free",
        rate_limit: { allowed: true, limit_reached: false, primary_window: { used_percent: 20, reset_at: 4_070_908_800 } },
      }), { status: 200 });
    }));

    const usage = await service.refreshUsage();
    expect(usage.map((entry) => [entry.credentialId, entry.plan])).toEqual([["free", "free"], ["work", "plus"]]);
    await service.recordProviderOutcome("work", { status: 402 });
    await service.removeCredential("work");

    expect((await service.listStatus()).map((entry) => entry.id)).toEqual(["free"]);
    expect((await service.listUsage()).map((entry) => entry.credentialId)).toEqual(["free"]);
    const health = JSON.parse(await readFile(join(rootDir, ".health", "codex-oauth.json"), "utf8"));
    expect(health).not.toEqual(expect.arrayContaining([expect.objectContaining({ credentialId: "work" })]));
  });

  it("refreshes usage only for explicitly scoped credentials", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "policy-a", tokenFile: accountToken("account-a") });
    await service.linkCredential({ id: "policy-b", tokenFile: accountToken("account-b") });
    await service.linkCredential({ id: "outside-policy", tokenFile: accountToken("account-c") });
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      plan_type: "plus",
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: { used_percent: 20, reset_at: 4_070_908_800 },
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    const usage = await service.refreshUsageForCredentials(["policy-a", "policy-b"]);

    expect(usage.map((entry) => entry.credentialId)).toEqual(["policy-a", "policy-b"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await service.listUsage()).map((entry) => entry.credentialId))
      .toEqual(["policy-a", "policy-b"]);
  });

  it("refreshes and persists only an expired selected credential", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "expired", tokenFile: accountToken("account-a", { expires_at: "2020-01-01T00:00:00.000Z" }) });
    const [selected] = await service.listExecutionAccounts();
    const refreshedToken = accountToken("account-a").access_token;
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: refreshedToken, refresh_token: "refresh-new", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    await expect(service.resolveExecutionCredential(selected!)).resolves.toEqual({ credentialId: "expired", chatgptAccountId: "account-a", accessToken: refreshedToken });
    expect(fetch).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(await readFile(join(rootDir, "codex-oauth", "expired.json"), "utf8"));
    expect(persisted).toMatchObject({ access_token: refreshedToken, refresh_token: "refresh-new" });
  });

  it("refreshes a selected credential inside the existing expiry safety window", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "soon", tokenFile: accountToken("account-a", { expires_at: new Date(Date.now() + 60_000).toISOString() }) });
    const [selected] = await service.listExecutionAccounts();
    const refreshedToken = accountToken("account-a").access_token;
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: refreshedToken, refresh_token: "refresh-safe", expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(service.resolveExecutionCredential(selected!)).resolves.toMatchObject({ accessToken: refreshedToken });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects replacement after enumeration and never resolves by stale metadata", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "work", tokenFile: accountToken("account-a") });
    const [selected] = await service.listExecutionAccounts();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(join(rootDir, "codex-oauth", "work.json"), JSON.stringify(accountToken("account-b")), "utf8");
    await expect(service.resolveExecutionCredential(selected!)).rejects.toThrow("revision changed");
  });

  it("rejects a same-size rewrite after enumeration using nanosecond metadata", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "work", tokenFile: accountToken("account-a", { refresh_token: "refresh-aa" }) });
    const [selected] = await service.listExecutionAccounts();
    const path = join(rootDir, "codex-oauth", "work.json");
    const before = await readFile(path, "utf8");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const after = before.replace("refresh-aa", "refresh-bb");
    expect(Buffer.byteLength(after)).toBe(Buffer.byteLength(before));
    await writeFile(path, after, "utf8");
    await expect(service.resolveExecutionCredential(selected!)).rejects.toThrow("revision changed");
  });

  it("never follows a selected credential symlink where the platform permits creating one", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "work", tokenFile: accountToken("account-a") });
    await service.linkCredential({ id: "target", tokenFile: accountToken("account-a") });
    const [targetSelection, workSelection] = (await service.listExecutionAccounts()).sort((a, b) => a.credentialId.localeCompare(b.credentialId));
    const linkPath = join(rootDir, "codex-oauth", "work.json");
    try {
      await rm(linkPath);
      await symlink(join(rootDir, "codex-oauth", "target.json"), linkPath, "file");
    } catch (error) {
      if (error instanceof Error && "code" in error && ["EPERM", "EACCES", "ENOTSUP"].includes(String((error as NodeJS.ErrnoException).code))) return;
      throw error;
    }
    expect((await service.listExecutionAccounts()).map((entry) => entry.credentialId)).not.toContain("work");
    expect(targetSelection?.credentialId).toBe("target");
    await expect(service.resolveExecutionCredential(workSelection!)).rejects.toThrow("invalid");
  });

  it("does not overwrite replacement while selected refresh is in flight", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "work", tokenFile: accountToken("account-a", { expires_at: "2020-01-01T00:00:00.000Z" }) });
    const [selected] = await service.listExecutionAccounts();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const fetch = vi.fn(async () => {
      await blocked;
      return new Response(JSON.stringify({ access_token: accountToken("account-a").access_token, refresh_token: "refresh-new", expires_in: 3600 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const resolving = service.resolveExecutionCredential(selected!);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const replacement = accountToken("account-b");
    await writeFile(join(rootDir, "codex-oauth", "work.json"), JSON.stringify(replacement), "utf8");
    release();
    await expect(resolving).rejects.toThrow("revision changed");
    expect(JSON.parse(await readFile(join(rootDir, "codex-oauth", "work.json"), "utf8"))).toEqual(replacement);
  });

  it("serializes refresh and relink for one credential while unrelated ids remain independent", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "work", tokenFile: accountToken("account-a", { expires_at: "2020-01-01T00:00:00.000Z" }) });
    await service.linkCredential({ id: "unrelated", tokenFile: accountToken("account-c") });
    const accounts = await service.listExecutionAccounts();
    const selected = accounts.find((entry) => entry.credentialId === "work")!;
    const unrelated = accounts.find((entry) => entry.credentialId === "unrelated")!;
    let releaseRefresh!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const fetch = vi.fn(async () => {
      await blocked;
      return new Response(JSON.stringify({ access_token: accountToken("account-a").access_token, refresh_token: "refresh-after", expires_in: 3600 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const resolving = service.resolveExecutionCredential(selected!);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    let relinked = false;
    const relinking = service.linkCredential({ id: "work", tokenFile: accountToken("account-b") }).then(() => { relinked = true; });
    let catalogLinked = false;
    const catalogLinking = service.linkCredential({ id: "new-account", tokenFile: accountToken("account-d") }).then(() => { catalogLinked = true; });
    await expect(service.resolveExecutionCredential(unrelated)).resolves.toMatchObject({ chatgptAccountId: "account-c" });
    expect(relinked).toBe(false);
    expect(catalogLinked).toBe(false);
    releaseRefresh();
    await expect(resolving).resolves.toMatchObject({ credentialId: "work", chatgptAccountId: "account-a" });
    await relinking;
    await catalogLinking;
    const final = JSON.parse(await readFile(join(rootDir, "codex-oauth", "work.json"), "utf8"));
    expect(final.access_token).toBe(accountToken("account-b").access_token);
    expect((await readdir(join(rootDir, "codex-oauth"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
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
    expect((await readdir(join(rootDir, "codex-oauth"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);

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

  it("decodes credential emails from local token claims only when explicitly requested, and keeps listStatus silent on it", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "work", tokenFile: tokenWithEmail("operator@example.test") });
    await service.linkCredential({ id: "no-profile", tokenFile: token() });

    const emails = await service.listCredentialEmails();
    expect(emails.get("work")).toBe("operator@example.test");
    expect(emails.has("no-profile")).toBe(false);

    expect(JSON.stringify(await service.listStatus())).not.toContain("operator@example.test");
  });

  it("cleans secret-bearing temporary files when atomic link replacement fails", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await mkdir(join(rootDir, "codex-oauth", "blocked.json"), { recursive: true });
    await expect(service.linkCredential({ id: "blocked", tokenFile: accountToken("account-a") })).rejects.toThrow();
    expect((await readdir(join(rootDir, "codex-oauth"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("relinks the same ChatGPT account into one stable credential and removes rotated predecessors", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await mkdir(join(rootDir, "codex-oauth"), { recursive: true });
    await writeFile(
      join(rootDir, "codex-oauth", "account-1712345678901.json"),
      JSON.stringify(accountToken("account-a", { refresh_token: "old-refresh" })),
      "utf8",
    );
    await service.recordAuthenticationFailure("account-1712345678901");

    await service.linkCredential({
      tokenFile: accountToken("account-a", { refresh_token: "new-refresh" }),
    });

    const status = await service.listStatus();
    expect(status).toEqual([expect.objectContaining({
      id: expect.stringMatching(/^account-[a-f0-9]{16}$/),
      status: "valid",
      health: undefined,
    })]);
    const raw = JSON.parse(await readFile(join(rootDir, "codex-oauth", `${status[0]!.id}.json`), "utf8"));
    expect(raw.refresh_token).toBe("new-refresh");
  });

  it("serializes concurrent same-account catalog links into one deterministic credential", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    const first = service.linkCredential({ tokenFile: accountToken("shared-account", { refresh_token: "refresh-first" }) });
    const second = service.linkCredential({ tokenFile: accountToken("shared-account", { refresh_token: "refresh-second" }) });
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    const files = (await readdir(join(rootDir, "codex-oauth"))).filter((name) => name.endsWith(".json"));
    expect(files).toHaveLength(1);
    const persisted = JSON.parse(await readFile(join(rootDir, "codex-oauth", files[0]!), "utf8"));
    expect(persisted.refresh_token).toBe("refresh-second");
  });

  it("keeps distinct ChatGPT accounts as distinct pooled credentials", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });

    await service.linkCredential({ tokenFile: accountToken("account-a") });
    await service.linkCredential({ tokenFile: accountToken("account-b") });

    const status = await service.listStatus();
    expect(status).toHaveLength(2);
    expect(new Set(status.map((entry) => entry.id)).size).toBe(2);
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

  it("records Codex OAuth rate limits without rotating across subscription accounts", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "first", tokenFile: token({ access_token: "access-first" }) });
    const calls: string[] = [];
    const tokenPaths: string[] = [];

    const adapter = await service.createPooledAdapter({
      defaultModel: "model",
      createAdapter: (credential) => {
        tokenPaths.push(credential.tokenPath);
        return new TestAdapter(async () => {
          calls.push(credential.tokenFile.access_token);
          const error = new Error("rate limited");
          (error as { status?: number }).status = 429;
          throw error;
        });
      },
    });

    await expect(adapter.createMessage(makeOptions())).rejects.toThrow("rate limited");
    expect(calls).toEqual(["access-first"]);
    expect(tokenPaths).toEqual([join(rootDir, "codex-oauth", "first.json")]);
  });

  it("surfaces auth failure from the explicitly executable Codex OAuth credential", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "first", tokenFile: token({ access_token: "access-invalidated" }) });
    const calls: string[] = [];

    const adapter = await service.createPooledAdapter({
      defaultModel: "model",
      createAdapter: (credential) => new TestAdapter(async () => {
        calls.push(credential.tokenFile.access_token);
        const error = new Error("token invalidated");
        (error as { status?: number }).status = 401;
        throw error;
      }),
    });

    await expect(adapter.createMessage(makeOptions())).rejects.toThrow("token invalidated");
    expect(calls).toEqual(["access-invalidated"]);
    await expect(service.listStatus()).resolves.toEqual([
      expect.objectContaining({
        id: "first",
        status: "invalid",
        invalidReason: "Provider rejected this credential. Sign in again.",
      }),
    ]);
    await expect(service.listValidAccessTokenCandidates()).resolves.toEqual([]);
  });

  it("rejects pooled execution when multiple Codex OAuth subscriptions are executable", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "first", tokenFile: token({ access_token: "access-first" }) });
    await service.linkCredential({ id: "second", tokenFile: token({ access_token: "access-second" }) });

    await expect(service.createPooledAdapter({ defaultModel: "model" })).rejects.toThrow("exactly one executable credential");

    try {
      await service.createPooledAdapter({ defaultModel: "model" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KilnError);
      const kilnError = error as KilnError;
      expect(kilnError.code).toBe("CONFIG_INVALID");
      // The repair points to the canonical execution catalog and names the
      // executable credential ids without making credentials a surface choice.
      expect(kilnError.suggestion).toContain("first");
      expect(kilnError.suggestion).toContain("second");
      expect(kilnError.suggestion).toContain("executionCatalog.accounts");
      expect(kilnError.suggestion).toContain("account policy");
      expect(kilnError.suggestion).toContain("execution route");
      expect(kilnError.suggestion).not.toContain("kiln model bind");
    }
  });

  it("materializes only an exact selected Codex OAuth account revision", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "first", tokenFile: accountToken("account-a") });
    await service.linkCredential({ id: "second", tokenFile: accountToken("account-b") });
    const selected = (await service.listExecutionAccounts()).find((entry) => entry.credentialId === "second")!;
    const materialized: string[] = [];

    const adapter = await service.createExactAdapter({
      selected,
      defaultModel: "model",
      createAdapter: (credential) => new TestAdapter(async () => {
        materialized.push(credential.credentialId);
        return makeResponse(credential.accessToken);
      }),
    });

    await expect(adapter.createMessage(makeOptions())).resolves.toEqual(makeResponse(accountToken("account-b").access_token));
    expect(materialized).toEqual(["second"]);
    await expect(service.createPooledAdapter({ defaultModel: "model" })).rejects.toThrow("exactly one executable credential");
  });

  it("rejects stale exact Codex OAuth account evidence before adapter construction", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "selected", tokenFile: accountToken("account-a") });
    const [selected] = await service.listExecutionAccounts();
    await service.linkCredential({ id: "selected", tokenFile: accountToken("account-a", { refresh_token: "replacement" }) });

    await expect(service.createExactAdapter({
      selected: selected!,
      defaultModel: "model",
    })).rejects.toThrow("revision changed");
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

  it("surfaces the original rate-limit error after recording cooldown", async () => {
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

    await expect(adapter.createMessage(makeOptions())).rejects.toThrow("rate limited");
  });

  it("maps provider failures into credential outcomes", () => {
    expect(mapCodexOAuthProviderError(Object.assign(new Error("rate"), { status: 429 }))).toEqual({ type: "rate-limited" });
    expect(mapCodexOAuthProviderError(Object.assign(new Error("quota"), { status: 402 }))).toEqual({ type: "quota-exceeded" });
    expect(mapCodexOAuthProviderError(Object.assign(new Error("auth"), { status: 401 }))).toEqual({ type: "auth-failed" });
    expect(mapCodexOAuthProviderError(Object.assign(new Error("forbidden"), { status: 403 }))).toEqual({ type: "auth-failed" });
    expect(mapCodexOAuthProviderError(Object.assign(new Error("unavailable"), { status: 503 }))).toEqual({ type: "connection-failed" });
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

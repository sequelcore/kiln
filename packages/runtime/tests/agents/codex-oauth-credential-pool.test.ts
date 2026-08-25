import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentResponse,
  type CodexOAuthTokenFile,
  type CreateMessageOptions,
  type ProviderAdapter,
} from "@kilnai/core/agents";
import { KilnError } from "@kilnai/core/engine";
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
  readonly communicationTransport = "native" as const;

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

  it("refreshes expiring credentials before admission and returns the refreshed revision", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "soon", tokenFile: accountToken("account-a", { expires_at: new Date(Date.now() + 60_000).toISOString() }) });
    const [before] = await service.listExecutionAccounts();
    const refreshedToken = accountToken("account-a").access_token;
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: refreshedToken, refresh_token: "refresh-safe", expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    const [prepared] = await service.prepareExecutionAccounts();

    expect(prepared).toEqual(expect.objectContaining({ credentialId: "soon" }));
    expect(prepared?.revision).not.toBe(before?.revision);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(service.resolveExecutionCredential(prepared!)).resolves.toMatchObject({
      credentialId: "soon",
      accessToken: refreshedToken,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stores credentials below the explicit global Kiln home", async () => {
    const kilnHome = join(rootDir, "xdg", "kiln");
    const service = new CodexOAuthCredentialPoolService({ kilnHome });

    await service.linkCredential({ id: "selected", tokenFile: accountToken("account-a") });

    expect(await readFile(join(kilnHome, "auth", "codex-oauth", "selected.json"), "utf8"))
      .toContain("access");
  });

  it("rejects a post-admission near-expiry credential without refreshing or mutating it", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "soon", tokenFile: accountToken("account-a", { expires_at: new Date(Date.now() + 60_000).toISOString() }) });
    const [selected] = await service.listExecutionAccounts();
    const path = join(rootDir, "codex-oauth", "soon.json");
    const before = await readFile(path, "utf8");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: accountToken("account-a").access_token, refresh_token: "must-not-refresh", expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(service.resolveExecutionCredential(selected!)).rejects.toThrow("requires refresh");

    expect(fetch).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("rejects a post-admission near-expiry rotation before any refresh or revision adoption", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "work", tokenFile: accountToken("account-a") });
    const [selected] = await service.listExecutionAccounts();
    const path = join(rootDir, "codex-oauth", "work.json");
    const replacement = accountToken("account-a", {
      refresh_token: "replacement-refresh",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    await writeFile(path, JSON.stringify(replacement), "utf8");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: accountToken("account-a").access_token, refresh_token: "must-not-refresh", expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(service.resolveExecutionCredential(selected!)).rejects.toThrow("revision changed");

    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(replacement);
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
    const [targetSelection, workSelection] = [...await service.listExecutionAccounts()].sort((a, b) => a.credentialId.localeCompare(b.credentialId));
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

  it("does not overwrite a replacement while pre-admission refresh is in flight", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "work", tokenFile: accountToken("account-a", { expires_at: "2020-01-01T00:00:00.000Z" }) });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const fetch = vi.fn(async () => {
      await blocked;
      return new Response(JSON.stringify({ access_token: accountToken("account-a").access_token, refresh_token: "refresh-new", expires_in: 3600 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const preparing = service.prepareExecutionAccounts();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const replacement = accountToken("account-b");
    await writeFile(join(rootDir, "codex-oauth", "work.json"), JSON.stringify(replacement), "utf8");
    release();
    await expect(preparing).resolves.toEqual([expect.objectContaining({ credentialId: "work" })]);
    expect(JSON.parse(await readFile(join(rootDir, "codex-oauth", "work.json"), "utf8"))).toEqual(replacement);
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
    const validToken = accountToken("valid");
    await service.linkCredential({ id: "valid", tokenFile: validToken });
    const calls: string[] = [];

    const selected = (await service.listExecutableAccounts())[0]!;
    const credential = await service.resolveExecutionCredential(selected);
    const adapter = await service.createAdapterFromCredential({
      credential,
      defaultModel: "model",
      createAdapter: (resolved) => new TestAdapter(async () => {
        calls.push(resolved.accessToken);
        return makeResponse("ok");
      }),
    });

    expect(adapter.communicationTransport).toBe("native");
    await expect(adapter.createMessage(makeOptions())).resolves.toEqual(makeResponse("ok"));
    expect(calls).toEqual([validToken.access_token]);
    await expect(service.listStatus()).resolves.toEqual([
      expect.objectContaining({ id: "expired", status: "expired" }),
      expect.objectContaining({ id: "valid", status: "valid" }),
    ]);
  });

  it("excludes expired and malformed credentials from exact execution selection", async () => {
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

    await expect(service.listExecutableAccounts()).resolves.toEqual([]);
    const status = await service.listStatus();
    expect(status).toEqual([
      expect.objectContaining({ id: "expired", status: "expired" }),
      expect.objectContaining({
        id: "invalid",
        status: "invalid",
        expiresAt: "unknown",
        invalidReason: expect.stringContaining("Malformed Codex OAuth credential file"),
      }),
    ]);
    expect(JSON.stringify(status)).not.toContain("refresh");
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
    const validToken = accountToken("valid");
    await service.linkCredential({ id: "valid", tokenFile: validToken });
    const calls: string[] = [];

    const selected = (await service.listExecutableAccounts())[0]!;
    const credential = await service.resolveExecutionCredential(selected);
    const adapter = await service.createAdapterFromCredential({
      credential,
      defaultModel: "model",
      createAdapter: (resolved) => new TestAdapter(async () => {
        calls.push(resolved.accessToken);
        return makeResponse("ok");
      }),
    });

    await expect(adapter.createMessage(makeOptions())).resolves.toEqual(makeResponse("ok"));
    expect(calls).toEqual([validToken.access_token]);
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
    const firstToken = accountToken("first");
    await service.linkCredential({ id: "first", tokenFile: firstToken });
    const calls: string[] = [];
    const tokenPaths: string[] = [];

    const selected = (await service.listExecutableAccounts())[0]!;
    const credential = await service.resolveExecutionCredential(selected);
    const adapter = await service.createAdapterFromCredential({
      credential,
      defaultModel: "model",
      createAdapter: (resolved) => {
        tokenPaths.push(resolved.credentialId);
        return new TestAdapter(async () => {
          calls.push(resolved.accessToken);
          const error = new Error("rate limited");
          (error as { status?: number }).status = 429;
          throw error;
        });
      },
    });

    await expect(adapter.createMessage(makeOptions())).rejects.toThrow("rate limited");
    expect(calls).toEqual([firstToken.access_token]);
    expect(tokenPaths).toEqual(["first"]);
  });

  it("surfaces auth failure from the explicitly executable Codex OAuth credential", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    const invalidatedToken = accountToken("invalidated");
    await service.linkCredential({ id: "first", tokenFile: invalidatedToken });
    const calls: string[] = [];

    const selected = (await service.listExecutableAccounts())[0]!;
    const credential = await service.resolveExecutionCredential(selected);
    const adapter = await service.createAdapterFromCredential({
      credential,
      defaultModel: "model",
      createAdapter: (resolved) => new TestAdapter(async () => {
        calls.push(resolved.accessToken);
        const error = new Error("token invalidated");
        (error as { status?: number }).status = 401;
        throw error;
      }),
    });

    await expect(adapter.createMessage(makeOptions())).rejects.toThrow("token invalidated");
    expect(calls).toEqual([invalidatedToken.access_token]);
    await expect(service.listStatus()).resolves.toEqual([
      expect.objectContaining({
        id: "first",
        status: "invalid",
        invalidReason: "Provider rejected this credential. Sign in again.",
      }),
    ]);
    await expect(service.listValidAccessTokenCandidates()).resolves.toEqual([]);
  });

  it("enumerates multiple Codex OAuth subscriptions for explicit account admission", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "first", tokenFile: token({ access_token: "access-first" }) });
    await service.linkCredential({ id: "second", tokenFile: token({ access_token: "access-second" }) });

    await expect(service.listExecutableAccounts()).resolves.toEqual([
      expect.objectContaining({ credentialId: "first" }),
      expect.objectContaining({ credentialId: "second" }),
    ]);
  });

  it("preserves native communication transport on the exact built-in Codex adapter", async () => {
    const service = new CodexOAuthCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "selected", tokenFile: accountToken("account-a") });
    const selected = (await service.listExecutableAccounts())[0]!;
    const credential = await service.resolveExecutionCredential(selected);

    const adapter = await service.createAdapterFromCredential({
      credential,
      defaultModel: "gpt-5.6-terra",
    });

    expect(adapter.name).toBe("codex-oauth");
    expect(adapter.communicationTransport).toBe("native");
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
    await service.linkCredential({ id: "only", tokenFile: accountToken("only") });

    const selected = (await service.listExecutableAccounts())[0]!;
    const credential = await service.resolveExecutionCredential(selected);
    const adapter = await service.createAdapterFromCredential({
      credential,
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
    await service.linkCredential({ id: "only", tokenFile: accountToken("only") });
    const selected = (await service.listExecutableAccounts())[0]!;
    const createAdapter = vi.fn((credential) => new TestAdapter(async () => makeResponse(credential.accessToken)));

    const adapter = await service.createExactAdapter({
      selected,
      defaultModel: "model",
      createAdapter,
    });

    await adapter.createMessage(makeOptions());
    expect(createAdapter).toHaveBeenCalledWith(expect.objectContaining({
      credentialId: "only",
      accessToken: accountToken("only").access_token,
      chatgptAccountId: expect.any(String),
    }));
  });
});

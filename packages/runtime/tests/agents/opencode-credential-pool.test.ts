import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentResponse,
  type CreateMessageOptions,
  type ProviderAdapter,
} from "@kilnai/core/agents";
import {
  OpenCodeCredentialPoolService,
  mapOpenCodeProviderError,
} from "../../src/agents/credential-pool/opencode-credential-pool.js";

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

describe("OpenCodeCredentialPoolService", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kiln-opencode-pool-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("links OpenCode credentials as canonical runtime credential files and projects secret-free status", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });

    await service.linkCredential({
      id: "work",
      apiKey: "sk-work",
      tier: "zen",
      createdAt: "2026-05-02T00:00:00.000Z",
    });

    const raw = JSON.parse(await readFile(join(rootDir, "opencode-api", "work.json"), "utf8"));
    expect(raw).toEqual({
      id: "work",
      label: "work",
      providerId: "opencode-api",
      source: "manual",
      priority: 0,
      tier: "zen",
      auth: {
        api_key: "sk-work",
        tier: "zen",
        created_at: "2026-05-02T00:00:00.000Z",
      },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const status = await service.listStatus();
    expect(status).toEqual([{
      id: "work",
      label: "work",
      tier: "zen",
      createdAt: "2026-05-02T00:00:00.000Z",
      key: "****",
      health: undefined,
    }]);
    expect(JSON.stringify(status)).not.toContain("sk-work");
  });

  it("keeps direct OpenCode API credentials out of the native opencode harness namespace", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "existing", apiKey: "sk-existing", tier: "go" });

    await expect(service.listStatus()).resolves.toEqual([expect.objectContaining({
      id: "existing",
      key: "sk-e…ting",
    })]);
    await expect(readFile(join(rootDir, "opencode", "existing.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("clears only credentials matching the requested tier and id", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "go-primary", apiKey: "sk-go", tier: "go" });
    await service.linkCredential({ id: "go-secondary", apiKey: "sk-go-2", tier: "go" });
    await service.linkCredential({ id: "zen-primary", apiKey: "sk-zen", tier: "zen" });

    await service.clearCredentials({ tier: "go", id: "go-primary" });

    await expect(service.listStatus()).resolves.toEqual([
      expect.objectContaining({ id: "go-secondary", tier: "go" }),
      expect.objectContaining({ id: "zen-primary", tier: "zen" }),
    ]);
  });

  it("clears all OpenCode credential files without requiring each file to parse", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "broken", apiKey: "sk-broken", tier: "go" });
    await writeFile(join(rootDir, "opencode-api", "broken.json"), "{", "utf8");

    await service.clearCredentials();

    await expect(service.listStatus()).resolves.toEqual([]);
  });

  it("does not select a successor credential after a productive effect fails", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "first", apiKey: "sk-first", tier: "go" });
    await service.linkCredential({ id: "second", apiKey: "sk-second", tier: "go" });
    const calls: string[] = [];

    const selected = (await service.listExecutionAccounts("go"))[0]!;
    const credential = await service.resolveExecutionCredential(selected);
    const adapter = await service.createAdapterFromCredential({
      credential,
      defaultModel: "model",
      createAdapter: (resolved) => new TestAdapter(async () => {
        calls.push(resolved.auth.api_key);
        if (resolved.auth.api_key === "sk-first") {
          const error = new Error("rate limited");
          (error as { status?: number }).status = 429;
          throw error;
        }
        return makeResponse("ok");
      }),
    });

    expect(adapter.communicationTransport).toBe("native");
    await expect(adapter.createMessage(makeOptions())).rejects.toThrow("rate limited");
    expect(calls).toEqual(["sk-first"]);
  });

  it("excludes a credential after recording its provider failure without dispatching another credential", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "only", apiKey: "sk-only", tier: "go" });

    await service.recordProviderOutcome("opencode-go", "only", Object.assign(new Error("rate limited"), { status: 429 }));
    await expect(service.listExecutionAccounts("go")).resolves.toEqual([]);
  });

  it("maps provider status codes into credential outcomes", () => {
    expect(mapOpenCodeProviderError(Object.assign(new Error("rate"), { status: 429 }))).toEqual({ type: "rate-limited" });
    expect(mapOpenCodeProviderError(Object.assign(new Error("quota"), { status: 402 }))).toEqual({ type: "quota-exceeded" });
    expect(mapOpenCodeProviderError(Object.assign(new Error("auth"), { status: 401 }))).toEqual({ type: "auth-failed" });
    expect(mapOpenCodeProviderError(new TypeError("fetch failed"))).toEqual({ type: "connection-failed" });
  });

  it("can use a custom adapter factory for an exact OpenCode adapter", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "only", apiKey: "sk-only", tier: "zen" });
    const selected = (await service.listExecutionAccounts("zen"))[0]!;
    const createAdapter = vi.fn((credential) => new TestAdapter(async () => makeResponse(credential.auth.tier)));

    const adapter = await service.createExactAdapter({
      selected,
      defaultModel: "model",
      createAdapter,
    });

    await adapter.createMessage(makeOptions());
    expect(createAdapter).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "opencode-zen",
      credentialId: "only",
      auth: {
        api_key: "sk-only",
        tier: "zen",
        created_at: expect.any(String),
      },
    }));
  });

  it("enumerates and resolves one exact OpenCode execution credential without exposing its secret", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "work", apiKey: "sk-private", tier: "zen", createdAt: "2026-05-02T00:00:00.000Z" });

    const accounts = await service.listExecutionAccounts("zen");

    expect(accounts).toEqual([{
      providerId: "opencode-zen",
      credentialId: "work",
      tier: "zen",
      fileIdentity: expect.stringMatching(/^[a-f0-9]{64}$/),
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
    }]);
    expect(JSON.stringify(accounts)).not.toContain("sk-private");
    await expect(service.resolveExecutionCredential(accounts[0]!)).resolves.toEqual({
      providerId: "opencode-zen",
      credentialId: "work",
      tier: "zen",
      auth: {
        api_key: "sk-private",
        tier: "zen",
        created_at: "2026-05-02T00:00:00.000Z",
      },
    });
  });

  it("fails closed when a selected OpenCode execution credential changes", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "work", apiKey: "sk-before", tier: "go" });
    const selected = (await service.listExecutionAccounts("go"))[0]!;
    const path = join(rootDir, "opencode-api", "work.json");
    const document = JSON.parse(await readFile(path, "utf8"));
    document.auth.api_key = "sk-after-with-a-different-length";
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");

    await expect(service.resolveExecutionCredential(selected)).rejects.toThrow("revision changed");
  });

  it("fails closed when a selected OpenCode credential disappears or becomes unhealthy", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "missing", apiKey: "sk-missing", tier: "go" });
    await service.linkCredential({ id: "unhealthy", apiKey: "sk-unhealthy", tier: "go" });
    const accounts = await service.listExecutionAccounts("go");
    const missing = accounts.find((entry) => entry.credentialId === "missing")!;
    const unhealthy = accounts.find((entry) => entry.credentialId === "unhealthy")!;

    await service.clearCredentials({ id: "missing" });
    await service.recordProviderOutcome("opencode-go", "unhealthy", Object.assign(new Error("auth"), { status: 401 }));

    await expect(service.resolveExecutionCredential(missing)).rejects.toThrow("unavailable");
    await expect(service.resolveExecutionCredential(unhealthy)).rejects.toThrow("unhealthy");
    await expect(service.listExecutionAccounts("go")).resolves.toEqual([]);
  });

  it("rejects a selected OpenCode account whose tier and provider disagree", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "work", apiKey: "sk-work", tier: "go" });
    const selected = (await service.listExecutionAccounts("go"))[0]!;

    await expect(service.resolveExecutionCredential({
      ...selected,
      providerId: "opencode-zen",
    })).rejects.toThrow("provider is invalid");
  });

  it("materializes only the exact selected OpenCode account revision", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "first", apiKey: "sk-first", tier: "go" });
    await service.linkCredential({ id: "second", apiKey: "sk-second", tier: "go" });
    const selected = (await service.listExecutionAccounts("go"))
      .find((entry) => entry.credentialId === "second")!;
    const materialized: string[] = [];

    const adapter = await service.createExactAdapter({
      selected,
      defaultModel: "model",
      createAdapter: (credential) => new TestAdapter(async () => {
        materialized.push(credential.credentialId);
        return makeResponse(credential.auth.api_key);
      }),
    });

    await expect(adapter.createMessage(makeOptions())).resolves.toEqual(makeResponse("sk-second"));
    expect(materialized).toEqual(["second"]);
  });

  it("rejects stale exact OpenCode account evidence before adapter construction", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "selected", apiKey: "sk-before", tier: "zen" });
    const [selected] = await service.listExecutionAccounts("zen");
    const createAdapter = vi.fn(() => new TestAdapter(async () => makeResponse("unexpected")));
    await service.linkCredential({ id: "selected", apiKey: "sk-after-with-a-different-length", tier: "zen" });

    await expect(service.createExactAdapter({
      selected: selected!,
      defaultModel: "model",
      createAdapter,
    })).rejects.toThrow("revision changed");
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("records provider outcome against the exact OpenCode credential", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "first", apiKey: "sk-first", tier: "go" });
    await service.linkCredential({ id: "second", apiKey: "sk-second", tier: "go" });
    await service.linkCredential({ id: "third", apiKey: "sk-third", tier: "go" });

    await service.recordProviderOutcome("opencode-go", "second", Object.assign(new Error("auth"), { status: 401 }));
    await service.recordProviderOutcome("opencode-go", "third", new Error("provider reflected private-error-marker"));

    const status = await service.listStatus();
    expect(status.find((entry) => entry.id === "first")?.health).toBeUndefined();
    expect(status.find((entry) => entry.id === "second")?.health?.lastOutcome).toEqual({ type: "auth-failed" });
    expect(status.find((entry) => entry.id === "third")?.health?.lastOutcome).toEqual({ type: "unknown-error" });
    expect(JSON.stringify(status)).not.toContain("private-error-marker");
  });
});

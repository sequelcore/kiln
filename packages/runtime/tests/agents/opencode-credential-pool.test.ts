import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentResponse, CreateMessageOptions, ProviderAdapter } from "@kilnai/core";
import { AllCredentialsExhaustedError } from "@kilnai/core";
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

  it("creates a pooled adapter that rotates on rate limits", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "first", apiKey: "sk-first", tier: "go" });
    await service.linkCredential({ id: "second", apiKey: "sk-second", tier: "go" });
    const calls: string[] = [];

    const adapter = await service.createPooledAdapter({
      tier: "go",
      defaultModel: "model",
      createAdapter: (auth) => new TestAdapter(async () => {
        calls.push(auth.api_key);
        if (auth.api_key === "sk-first") {
          const error = new Error("rate limited");
          (error as { status?: number }).status = 429;
          throw error;
        }
        return makeResponse("ok");
      }),
    });

    await expect(adapter.createMessage(makeOptions())).resolves.toEqual(makeResponse("ok"));
    expect(calls).toEqual(["sk-first", "sk-second"]);
  });

  it("throws AllCredentialsExhaustedError when all matching tier entries are exhausted", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "only", apiKey: "sk-only", tier: "go" });

    const adapter = await service.createPooledAdapter({
      tier: "go",
      defaultModel: "model",
      createAdapter: () => new TestAdapter(async () => {
        const error = new Error("rate limited");
        (error as { status?: number }).status = 429;
        throw error;
      }),
    });

    await expect(adapter.createMessage(makeOptions())).rejects.toBeInstanceOf(AllCredentialsExhaustedError);
  });

  it("maps provider status codes into credential outcomes", () => {
    expect(mapOpenCodeProviderError(Object.assign(new Error("rate"), { status: 429 }))).toEqual({ type: "rate-limited" });
    expect(mapOpenCodeProviderError(Object.assign(new Error("quota"), { status: 402 }))).toEqual({ type: "quota-exceeded" });
    expect(mapOpenCodeProviderError(Object.assign(new Error("auth"), { status: 401 }))).toEqual({ type: "auth-failed" });
    expect(mapOpenCodeProviderError(new TypeError("fetch failed"))).toEqual({ type: "connection-failed" });
  });

  it("can use a custom adapter factory for direct OpenCode adapters", async () => {
    const service = new OpenCodeCredentialPoolService({ rootDir });
    await service.linkCredential({ id: "only", apiKey: "sk-only", tier: "zen" });
    const createAdapter = vi.fn((auth) => new TestAdapter(async () => makeResponse(auth.tier)));

    const adapter = await service.createPooledAdapter({
      tier: "zen",
      defaultModel: "model",
      createAdapter,
    });

    await adapter.createMessage(makeOptions());
    expect(createAdapter).toHaveBeenCalledWith({
      api_key: "sk-only",
      tier: "zen",
      created_at: expect.any(String),
    });
  });
});

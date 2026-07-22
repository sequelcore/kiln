import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentResponse, CreateMessageOptions, ProviderAdapter } from "@kilnai/core";
import { AllCredentialsExhaustedError } from "@kilnai/core";
import {
  CredentialFileStore,
  DirectProviderCredentialPoolService,
  mapDirectProviderError,
  type DirectProviderAuth,
} from "../../src/agents/credential-pool/index.js";

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

  constructor(private readonly handler: () => Promise<AgentResponse>) {}

  createMessage(): Promise<AgentResponse> {
    return this.handler();
  }

  async *streamMessage() {
    yield { type: "done" as const, content: "" };
  }
}

describe("DirectProviderCredentialPoolService", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "kiln-direct-provider-pool-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("uses env-var credentials as a synthetic single-entry pool when no directory credentials exist", async () => {
    const service = new DirectProviderCredentialPoolService({
      rootDir,
      env: { OPENAI_API_KEY: "sk-env" },
    });

    const seen: DirectProviderAuth[] = [];
    const adapter = await service.createPooledAdapter({
      provider: "openai",
      defaultModel: "gpt-5.4",
      createAdapter: (auth) => {
        seen.push(auth);
        return new TestAdapter(async () => makeResponse("ok"));
      },
    });

    await expect(adapter.createMessage(makeOptions())).resolves.toEqual(makeResponse("ok"));
    expect(seen).toEqual([{ apiKey: "sk-env", baseUrl: undefined }]);
    await expect(service.listStatus("openai")).resolves.toEqual([expect.objectContaining({
      id: "env",
      source: "env",
    })]);
  });

  it("prefers directory credentials over env-var credentials", async () => {
    const store = new CredentialFileStore<DirectProviderAuth>({ rootDir });
    await store.writeCredential({
      providerId: "anthropic",
      id: "stored",
      label: "Stored",
      auth: { apiKey: "sk-stored" },
    });
    const service = new DirectProviderCredentialPoolService({
      rootDir,
      env: { ANTHROPIC_API_KEY: "sk-env" },
    });

    const seen: DirectProviderAuth[] = [];
    const adapter = await service.createPooledAdapter({
      provider: "anthropic",
      createAdapter: (auth) => {
        seen.push(auth);
        return new TestAdapter(async () => makeResponse("ok"));
      },
    });

    await adapter.createMessage(makeOptions());
    expect(seen).toEqual([{ apiKey: "sk-stored", baseUrl: undefined }]);
  });

  it("rotates multi-key API providers on rate limits", async () => {
    const store = new CredentialFileStore<DirectProviderAuth>({ rootDir });
    await store.writeCredential({
      providerId: "anthropic",
      id: "first",
      label: "First",
      auth: { apiKey: "sk-first" },
    });
    await store.writeCredential({
      providerId: "anthropic",
      id: "second",
      label: "Second",
      auth: { apiKey: "sk-second" },
    });
    const service = new DirectProviderCredentialPoolService({ rootDir });
    const calls: string[] = [];

    const adapter = await service.createPooledAdapter({
      provider: "anthropic",
      createAdapter: (auth) => new TestAdapter(async () => {
        calls.push(auth.apiKey ?? "");
        if (auth.apiKey === "sk-first") {
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

  it("throws when API-key providers have neither directory nor env credentials", async () => {
    const service = new DirectProviderCredentialPoolService({ rootDir, env: {} });
    const adapter = await service.createPooledAdapter({
      provider: "openai",
      createAdapter: () => new TestAdapter(async () => makeResponse("unreachable")),
    });

    await expect(adapter.createMessage(makeOptions())).rejects.toBeInstanceOf(AllCredentialsExhaustedError);
    await expect(service.listStatus("openai")).resolves.toEqual([]);
  });

  it("creates an Ollama env pool without requiring an API key", async () => {
    const service = new DirectProviderCredentialPoolService({
      rootDir,
      env: { OLLAMA_BASE_URL: "http://127.0.0.1:11435" },
    });
    const seen: DirectProviderAuth[] = [];
    const adapter = await service.createPooledAdapter({
      provider: "ollama",
      createAdapter: (auth) => {
        seen.push(auth);
        return new TestAdapter(async () => makeResponse("ok"));
      },
    });

    await adapter.createMessage(makeOptions());
    expect(seen).toEqual([{ apiKey: undefined, baseUrl: "http://127.0.0.1:11435" }]);
  });

  it("creates an LM Studio env pool without requiring an API key", async () => {
    const service = new DirectProviderCredentialPoolService({
      rootDir,
      env: { LMSTUDIO_BASE_URL: "http://127.0.0.1:1234/v1" },
    });
    const seen: DirectProviderAuth[] = [];
    const adapter = await service.createPooledAdapter({
      provider: "lmstudio",
      createAdapter: (auth) => {
        seen.push(auth);
        return new TestAdapter(async () => makeResponse("ok"));
      },
    });

    await adapter.createMessage(makeOptions());
    expect(seen).toEqual([{ apiKey: undefined, baseUrl: "http://127.0.0.1:1234/v1" }]);
  });

  it("maps provider failures into credential outcomes", () => {
    expect(mapDirectProviderError(Object.assign(new Error("rate"), { status: 429 }))).toEqual({ type: "rate-limited" });
    expect(mapDirectProviderError(Object.assign(new Error("quota"), { status: 402 }))).toEqual({ type: "quota-exceeded" });
    expect(mapDirectProviderError(Object.assign(new Error("auth"), { status: 401 }))).toEqual({ type: "auth-failed" });
    expect(mapDirectProviderError(new TypeError("fetch failed"))).toEqual({ type: "connection-failed" });
  });

  it("enumerates and resolves one exact stored execution credential without exposing its secret", async () => {
    const store = new CredentialFileStore<DirectProviderAuth>({ rootDir });
    await store.writeCredential({
      providerId: "openai",
      id: "work",
      label: "Work",
      tier: "paid",
      auth: { apiKey: "sk-private" },
    });
    const service = new DirectProviderCredentialPoolService({ rootDir, env: {} });

    const accounts = await service.listExecutionAccounts("openai");

    expect(accounts).toEqual([{
      providerId: "openai",
      credentialId: "work",
      tier: "paid",
      fileIdentity: expect.stringMatching(/^[a-f0-9]{64}$/),
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
    }]);
    expect(JSON.stringify(accounts)).not.toContain("sk-private");
    await expect(service.resolveExecutionCredential(accounts[0]!)).resolves.toEqual({
      providerId: "openai",
      credentialId: "work",
      tier: "paid",
      auth: { apiKey: "sk-private", baseUrl: undefined },
    });
  });

  it("fails closed when a selected stored execution credential changes", async () => {
    const store = new CredentialFileStore<DirectProviderAuth>({ rootDir });
    await store.writeCredential({
      providerId: "anthropic",
      id: "work",
      label: "Work",
      auth: { apiKey: "sk-before" },
    });
    const service = new DirectProviderCredentialPoolService({ rootDir, env: {} });
    const selected = (await service.listExecutionAccounts("anthropic"))[0]!;
    const path = join(rootDir, "anthropic", "work.json");
    const document = JSON.parse(await readFile(path, "utf8"));
    document.auth.apiKey = "sk-after-with-a-different-length";
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");

    await expect(service.resolveExecutionCredential(selected)).rejects.toThrow("revision changed");
  });

  it("uses opaque in-memory identity for env execution credentials and rejects changed env auth", async () => {
    const env: Record<string, string | undefined> = { OPENAI_API_KEY: "sk-before" };
    const service = new DirectProviderCredentialPoolService({ rootDir, env });
    const selected = (await service.listExecutionAccounts("openai"))[0]!;
    expect(JSON.stringify(selected)).not.toContain("sk-before");

    env.OPENAI_API_KEY = "sk-after";

    await expect(service.resolveExecutionCredential(selected)).rejects.toThrow("revision changed");
  });

  it("records provider outcome against the exact direct credential", async () => {
    const store = new CredentialFileStore<DirectProviderAuth>({ rootDir });
    await store.writeCredential({ providerId: "openai", id: "first", label: "First", auth: { apiKey: "sk-first" } });
    await store.writeCredential({ providerId: "openai", id: "second", label: "Second", auth: { apiKey: "sk-second" } });
    await store.writeCredential({ providerId: "openai", id: "third", label: "Third", auth: { apiKey: "sk-third" } });
    const service = new DirectProviderCredentialPoolService({ rootDir, env: {} });

    await service.recordProviderOutcome("openai", "second", Object.assign(new Error("rate"), { status: 429 }));
    await service.recordProviderOutcome("openai", "third", new Error("provider reflected private-error-marker"));

    const status = await service.listStatus("openai");
    expect(status.find((entry) => entry.id === "first")?.health).toBeUndefined();
    expect(status.find((entry) => entry.id === "second")?.health?.lastOutcome).toEqual({ type: "rate-limited" });
    expect(status.find((entry) => entry.id === "third")?.health?.lastOutcome).toEqual({ type: "unknown-error" });
    expect(JSON.stringify(status)).not.toContain("private-error-marker");
  });
});

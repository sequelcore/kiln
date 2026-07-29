import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelGatewayConfig, ProviderAdapter } from "@kilnai/core";
import { ManagedDirectProviderRuntimeAdapter } from "../../src/agents/managed-invocation/direct-runtime-adapter.js";
import { ConfiguredManagedAccountRuntime } from "../../src/managed-account-leases/configured-managed-account-runtime.js";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";

const config: ModelGatewayConfig = {
  port: 4819,
  accounts: [{
    id: "primary",
    providerId: "openai",
    credentialId: "env",
    maxConcurrency: 1,
    reservedAffinitySlots: 0,
  }],
  replay: { ttlMs: 60_000, maxEntries: 10, hmacKeyEnv: "REPLAY_SECRET" },
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
  principals: [],
  virtualModels: [{
    id: "managed-openai",
    providerId: "openai",
    providerModelId: "gpt-test",
    accountIds: ["primary"],
    capabilities: ["text"],
    affinity: { continuity: "none" },
  }],
};

describe("ConfiguredManagedAccountRuntime", () => {
  let root: string | undefined;
  const authorities: SqliteManagedAccountLeaseAuthority[] = [];

  afterEach(async () => {
    for (const authority of authorities.splice(0)) authority.close();
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("projects explicit candidates with unknown usage and binds only the leased revision", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-configured-account-"));
    const env: Record<string, string | undefined> = { OPENAI_API_KEY: "synthetic-key-a" };
    const runtime = new ConfiguredManagedAccountRuntime({ config, env });
    const resolution = await runtime.resolve({
      accountPolicyId: "managed-openai",
      providerRoute: { providerId: "openai", surface: "direct", model: "gpt-test" },
    });
    expect(resolution.candidates).toHaveLength(1);
    expect(resolution.affinityPolicy).toEqual({ continuity: "none" });
    expect(resolution.candidates[0]).toMatchObject({
      candidate: { pressure: 1 },
      usageEvidence: { freshness: "missing" },
    });

    const authority = new SqliteManagedAccountLeaseAuthority({
      path: join(root, "leases.sqlite"),
      ownerId: "owner-a",
    });
    authorities.push(authority);
    const acquired = await authority.acquire({
      accountPolicyId: "managed-openai",
      route: resolution.route,
      jobId: "job-a",
      runtimeInvocationId: "job-a",
      affinityRequest: { continuity: "none" },
      candidates: resolution.candidates,
    });
    if (acquired.status !== "acquired") throw new Error("expected account lease");

    const template = directTemplate();
    const crossModuleTemplate = {
      descriptor: template.descriptor,
      invoke: template.invoke.bind(template),
      bindProvider: template.bindProvider.bind(template),
    };
    expect(crossModuleTemplate).not.toBeInstanceOf(ManagedDirectProviderRuntimeAdapter);

    const bound = await runtime.bind({ lease: acquired.lease, adapter: crossModuleTemplate });
    expect(bound).toBeInstanceOf(ManagedDirectProviderRuntimeAdapter);
    expect(bound).not.toBe(template);
    expect(bound.descriptor).toEqual(template.descriptor);
  });

  it("rejects credential revision drift instead of rebinding silently", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-configured-account-"));
    const env: Record<string, string | undefined> = { OPENAI_API_KEY: "synthetic-key-a" };
    const runtime = new ConfiguredManagedAccountRuntime({ config, env });
    const resolution = await runtime.resolve({
      accountPolicyId: "managed-openai",
      providerRoute: { providerId: "openai", surface: "direct", model: "gpt-test" },
    });
    const authority = new SqliteManagedAccountLeaseAuthority({
      path: join(root, "leases.sqlite"),
      ownerId: "owner-a",
    });
    authorities.push(authority);
    const acquired = await authority.acquire({
      accountPolicyId: "managed-openai",
      route: resolution.route,
      jobId: "job-a",
      runtimeInvocationId: "job-a",
      affinityRequest: { continuity: "none" },
      candidates: resolution.candidates,
    });
    if (acquired.status !== "acquired") throw new Error("expected account lease");

    env.OPENAI_API_KEY = "synthetic-key-b";
    await expect(runtime.bind({ lease: acquired.lease, adapter: directTemplate() }))
      .rejects.toThrow("revision changed");
  });

  it("uses one injected clock for configured two-account usage and projects affinity policy", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-configured-account-"));
    await mkdir(join(root, "codex-oauth"), { recursive: true });
    await Promise.all([
      writeFile(join(root, "codex-oauth", "credential-a.json"), "{}"),
      writeFile(join(root, "codex-oauth", "credential-b.json"), "{}"),
      writeFile(join(root, "codex-oauth", "unconfigured.json"), "{}"),
    ]);
    await writeUsage(root, [
      usage("credential-a", "exhausted"),
      usage("credential-b", "available"),
    ]);
    let now = new Date("2026-07-22T12:00:00.000Z");
    const runtime = new ConfiguredManagedAccountRuntime({
      config: twoAccountConfig(),
      credentialRootDir: root,
      now: () => now,
    });

    const fresh = await runtime.resolve({
      accountPolicyId: "managed-codex",
      providerRoute: { providerId: "codex-oauth", surface: "direct", model: "gpt-test" },
    });

    expect(fresh.affinityPolicy).toEqual({
      continuity: "prefer",
      scope: "session",
      allowRebind: true,
    });
    expect(fresh.candidates).toHaveLength(2);
    expect(fresh.candidates.map((candidate) => candidate.capacityIdentity)).toEqual(["account-a", "account-b"]);
    expect(fresh.candidates.map((candidate) => candidate.usageEvidence)).toMatchObject([
      { health: "unhealthy", freshness: "fresh", availability: "exhausted" },
      { health: "healthy", freshness: "fresh", availability: "available" },
    ]);

    now = new Date("2026-07-22T12:05:01.000Z");
    const expired = await runtime.resolve({
      accountPolicyId: "managed-codex",
      providerRoute: { providerId: "codex-oauth", surface: "direct", model: "gpt-test" },
    });
    expect(expired.candidates.map((candidate) => ({
      health: candidate.candidate.health,
      pressure: candidate.candidate.pressure,
      usage: candidate.usageEvidence,
    }))).toEqual([
      { health: "healthy", pressure: 1, usage: { health: "healthy", freshness: "missing" } },
      { health: "healthy", pressure: 1, usage: { health: "healthy", freshness: "missing" } },
    ]);

    await writeUsage(root, [
      {
        ...usage("credential-a", "available"),
        observedAt: "2026-07-22T12:05:01.000Z",
        validUntil: "2026-07-22T12:10:01.000Z",
      },
    ]);
    const refreshed = await runtime.resolve({
      accountPolicyId: "managed-codex",
      providerRoute: { providerId: "codex-oauth", surface: "direct", model: "gpt-test" },
    });
    expect(refreshed.candidates.map((candidate) => candidate.candidate.pressure)).toEqual([0, 1]);
    expect(refreshed.candidates[0]?.usageEvidence).toMatchObject({
      health: "healthy",
      freshness: "fresh",
      availability: "available",
    });
  });

  it("uses the injected Codex pool for selection and exact revision binding", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-configured-account-"));
    const execution = {
      credentialId: "credential-a",
      fileIdentity: "a".repeat(64),
      revision: "b".repeat(64),
    };
    const codexPool = {
      listExecutionAccounts: vi.fn(async () => [execution]),
      listUsage: vi.fn(async () => [usage("credential-a", "available")]),
      resolveExecutionCredential: vi.fn(async () => ({
        credentialId: execution.credentialId,
        accessToken: "synthetic-access-token",
        chatgptAccountId: "synthetic-account",
      })),
    };
    const runtime = new ConfiguredManagedAccountRuntime({
      config: {
        ...twoAccountConfig(),
        accounts: [twoAccountConfig().accounts[0]!],
        virtualModels: [{
          ...twoAccountConfig().virtualModels[0]!,
          accountIds: ["account-a"],
        }],
      },
      codexPool,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });
    const resolution = await runtime.resolve({
      accountPolicyId: "managed-codex",
      providerRoute: { providerId: "codex-oauth", surface: "direct", model: "gpt-test" },
    });
    const authority = new SqliteManagedAccountLeaseAuthority({
      path: join(root, "injected-pool-leases.sqlite"),
      ownerId: "owner-a",
    });
    authorities.push(authority);
    const acquired = await authority.acquire({
      accountPolicyId: "managed-codex",
      route: resolution.route,
      jobId: "job-a",
      runtimeInvocationId: "job-a",
      affinityRequest: { continuity: "none" },
      candidates: resolution.candidates,
    });
    if (acquired.status !== "acquired") throw new Error("expected account lease");

    await runtime.bind({ lease: acquired.lease, adapter: directTemplate("codex-oauth") });

    expect(codexPool.listExecutionAccounts).toHaveBeenCalled();
    expect(codexPool.listUsage).toHaveBeenCalled();
    expect(codexPool.resolveExecutionCredential).toHaveBeenCalledExactlyOnceWith({
      providerId: "codex-oauth",
      ...execution,
    });
  });
});

function twoAccountConfig(): ModelGatewayConfig {
  return {
    ...config,
    accounts: [
      { id: "account-a", providerId: "codex-oauth", credentialId: "credential-a", maxConcurrency: 1, reservedAffinitySlots: 0 },
      { id: "account-b", providerId: "codex-oauth", credentialId: "credential-b", maxConcurrency: 1, reservedAffinitySlots: 0 },
    ],
    virtualModels: [{
      id: "managed-codex",
      providerId: "codex-oauth",
      providerModelId: "gpt-test",
      accountIds: ["account-a", "account-b"],
      capabilities: ["text"],
      affinity: { continuity: "prefer", scope: "session", allowRebind: true },
    }],
  };
}

function usage(credentialId: string, availability: "available" | "exhausted") {
  return {
    provider: "codex-oauth" as const,
    credentialId,
    availability,
    observedAt: "2026-07-22T11:59:00.000Z",
    validUntil: "2026-07-22T12:05:00.000Z",
    source: "provider-endpoint" as const,
    confidence: "authoritative" as const,
  };
}

async function writeUsage(directory: string, snapshots: readonly ReturnType<typeof usage>[]): Promise<void> {
  const usageDirectory = join(directory, "provider-usage");
  await mkdir(usageDirectory, { recursive: true });
  await writeFile(join(usageDirectory, "codex-oauth.json"), JSON.stringify(snapshots));
}

function directTemplate(providerId = "openai"): ManagedDirectProviderRuntimeAdapter {
  const provider: ProviderAdapter = {
    name: "unbound",
    createMessage: async () => {
      throw new Error("unbound");
    },
    streamMessage: async function* () {
      throw new Error("unbound");
    },
  };
  return new ManagedDirectProviderRuntimeAdapter({
    providerId,
    model: "gpt-test",
    provider,
    tools: [],
    builtinTools: new Map(),
  });
}

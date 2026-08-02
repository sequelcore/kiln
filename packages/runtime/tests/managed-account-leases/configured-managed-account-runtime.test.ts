import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ModelGatewayConfig,
} from "@kilnai/core";
import { ConfiguredManagedAccountRuntime } from "../../src/managed-account-leases/configured-managed-account-runtime.js";
import { OpenCodeCredentialPoolService } from "../../src/agents/credential-pool/opencode-credential-pool.js";

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
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("projects explicit candidates with unknown usage without materializing credentials", async () => {
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

  it("uses the injected Codex pool for selection without credential materialization", async () => {
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

    expect(codexPool.listExecutionAccounts).toHaveBeenCalled();
    expect(codexPool.listUsage).toHaveBeenCalled();
    expect(resolution.candidates).toHaveLength(1);
    expect(codexPool.resolveExecutionCredential).not.toHaveBeenCalled();
  });

  it("binds authoritative provider quota to configured economic capacity", async () => {
    const execution = {
      credentialId: "credential-a",
      fileIdentity: "a".repeat(64),
      revision: "b".repeat(64),
    };
    const economicConfig: ModelGatewayConfig = {
      ...twoAccountConfig(),
      accounts: [{
        ...twoAccountConfig().accounts[0]!,
        economics: {
          capacityIdentity: "codex-capacity-a",
          subscriptionClass: "subscription",
          quotaClassId: "codex-five-hour-window",
          creditPosture: "committed",
          overagePosture: "disabled",
        },
      }],
      virtualModels: [{
        ...twoAccountConfig().virtualModels[0]!,
        accountIds: ["account-a"],
      }],
    };
    const runtime = new ConfiguredManagedAccountRuntime({
      config: economicConfig,
      codexPool: {
        listExecutionAccounts: vi.fn(async () => [execution]),
        listUsage: vi.fn(async () => [{
          ...usage("credential-a", "available"),
          primary: {
            bucketId: "primary" as const,
            usedPercent: 37.5,
            windowDurationMinutes: 300,
            resetsAt: "2026-07-22T13:00:00.000Z",
          },
          credits: {
            status: "available" as const,
            balance: {
              atoms: "175",
              scale: 1,
              unit: "credit",
              scheme: { kind: "credit" as const, creditSchemeId: "codex-oauth" },
            },
          },
          exhaustionReason: null,
        }]),
      },
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    const resolution = await runtime.resolve({
      accountPolicyId: "managed-codex",
      providerRoute: { providerId: "codex-oauth", surface: "direct", model: "gpt-test" },
    });

    expect(resolution.candidates).toHaveLength(1);
    expect(resolution.candidates[0]).toMatchObject({
      capacityIdentity: "codex-capacity-a",
      accountEconomics: {
        capacityIdentity: "codex-capacity-a",
        subscriptionClass: "subscription",
        quotaClassId: "codex-five-hour-window",
        creditPosture: "committed",
        overagePosture: "disabled",
      },
      quotaEvidence: {
        kind: "known",
        capacityIdentity: "codex-capacity-a",
        subscriptionClass: "subscription",
        quotaClassId: "codex-five-hour-window",
        buckets: [{
          bucketId: "primary",
          dimension: "percent",
          remaining: { atoms: "625", scale: 1, unit: "percent", scheme: { kind: "unit" } },
          windowDurationMinutes: 300,
          resetsAt: "2026-07-22T13:00:00.000Z",
        }],
        credits: {
          status: "available",
          balance: {
            atoms: "175",
            scale: 1,
            unit: "credit",
            scheme: { kind: "credit", creditSchemeId: "codex-oauth" },
          },
        },
        exhaustionReason: null,
        evidence: {
          observedAt: "2026-07-22T11:59:00.000Z",
          validUntil: "2026-07-22T12:05:00.000Z",
          confidence: "high",
          authority: "provider-reported",
        },
      },
    });

    const selected = resolution.candidates[0]!;
    await expect(runtime.resolveCommittedAccountBinding({
      accountPolicyId: "managed-codex",
      providerId: "codex-oauth",
      model: "gpt-test",
      capacityIdentity: selected.capacityIdentity,
      accountRef: selected.candidate.account,
      credentialRevisionId: selected.credentialRevisionId,
    })).resolves.toMatchObject({ accountId: "account-a" });
  });

  it("keeps OpenCode Go quota unknown when the provider exposes no authoritative snapshot", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-configured-opencode-economic-"));
    const pool = new OpenCodeCredentialPoolService({ rootDir: root });
    await pool.linkCredential({ id: "go-primary", apiKey: "sk-synthetic", tier: "go" });
    const base = openCodeConfig();
    const runtime = new ConfiguredManagedAccountRuntime({
      config: {
        ...base,
        accounts: [{
          ...base.accounts[0]!,
          economics: {
            capacityIdentity: "opencode-go-capacity",
            subscriptionClass: "subscription",
            quotaClassId: "opencode-go-subscription",
            creditPosture: "disabled",
            overagePosture: "disabled",
          },
        }],
      },
      credentialRootDir: root,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    const resolution = await runtime.resolve({
      accountPolicyId: "managed-go",
      providerRoute: { providerId: "opencode-go", surface: "direct", model: "glm-test" },
    });

    expect(resolution.candidates).toHaveLength(1);
    expect(resolution.candidates[0]).toMatchObject({
      capacityIdentity: "opencode-go-capacity",
      accountEconomics: {
        capacityIdentity: "opencode-go-capacity",
        creditPosture: "disabled",
        overagePosture: "disabled",
      },
      quotaEvidence: {
        kind: "unknown",
        capacityIdentity: "opencode-go-capacity",
        subscriptionClass: "unknown",
        reason: "provider-quota-missing",
      },
    });
  });

  it("materializes only the exact committed account revision from a two-account policy", async () => {
    const accounts = [
      { credentialId: "credential-a", fileIdentity: "a".repeat(64), revision: "1".repeat(64) },
      { credentialId: "credential-b", fileIdentity: "b".repeat(64), revision: "2".repeat(64) },
    ];
    const runtime = new ConfiguredManagedAccountRuntime({
      config: twoAccountConfig(),
      codexPool: {
        listExecutionAccounts: vi.fn(async () => accounts),
        listUsage: vi.fn(async () => []),
      },
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });
    const resolution = await runtime.resolve({
      accountPolicyId: "managed-codex",
      providerRoute: { providerId: "codex-oauth", surface: "direct", model: "gpt-test" },
    });
    const selected = resolution.candidates.find((candidate) => candidate.capacityIdentity === "account-b");
    if (!selected) throw new Error("fixture");
    expect(selected.credentialRevisionId).not.toBe(accounts[1]!.revision);

    await expect(runtime.resolveCommittedAccountBinding({
      accountPolicyId: "managed-codex",
      providerId: "codex-oauth",
      model: "gpt-test",
      capacityIdentity: selected.capacityIdentity,
      accountRef: selected.candidate.account,
      credentialRevisionId: selected.credentialRevisionId,
    })).resolves.toEqual({
      virtualModelId: "managed-codex",
      accountId: "account-b",
      credentialId: "credential-b",
      credentialRevision: accounts[1]!.revision,
    });

    await expect(runtime.resolveCommittedAccountBinding({
      accountPolicyId: "managed-codex",
      providerId: "codex-oauth",
      model: "gpt-test",
      capacityIdentity: selected.capacityIdentity,
      accountRef: selected.candidate.account,
      credentialRevisionId: "f".repeat(64),
    })).rejects.toThrow("revision");
  });

  it("carries the committed OpenCode revision from account selection to execution binding", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-configured-opencode-account-"));
    const pool = new OpenCodeCredentialPoolService({ rootDir: root });
    await pool.linkCredential({ id: "go-primary", apiKey: "sk-synthetic", tier: "go" });
    const runtime = new ConfiguredManagedAccountRuntime({
      config: openCodeConfig(),
      credentialRootDir: root,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });
    const resolution = await runtime.resolve({
      accountPolicyId: "managed-go",
      providerRoute: { providerId: "opencode-go", surface: "direct", model: "glm-test" },
    });
    const selected = resolution.candidates[0]!;
    const physicalRevision = (await pool.listExecutionAccounts("go"))[0]!.revision;
    expect(selected.credentialRevisionId).not.toBe(physicalRevision);

    await expect(runtime.resolveCommittedAccountBinding({
      accountPolicyId: "managed-go",
      providerId: "opencode-go",
      model: "glm-test",
      capacityIdentity: selected.capacityIdentity,
      accountRef: selected.candidate.account,
      credentialRevisionId: selected.credentialRevisionId,
    })).resolves.toEqual({
      virtualModelId: "managed-go",
      accountId: "go-account",
      credentialId: "go-primary",
      credentialRevision: physicalRevision,
    });

    await pool.linkCredential({ id: "go-primary", apiKey: "sk-replaced-with-different-length", tier: "go" });
    await expect(runtime.resolveCommittedAccountBinding({
      accountPolicyId: "managed-go",
      providerId: "opencode-go",
      model: "glm-test",
      capacityIdentity: selected.capacityIdentity,
      accountRef: selected.candidate.account,
      credentialRevisionId: selected.credentialRevisionId,
    })).rejects.toThrow("no longer executable");
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

function openCodeConfig(): ModelGatewayConfig {
  return {
    ...config,
    accounts: [{
      id: "go-account",
      providerId: "opencode-go",
      credentialId: "go-primary",
      maxConcurrency: 1,
      reservedAffinitySlots: 0,
    }],
    virtualModels: [{
      id: "managed-go",
      providerId: "opencode-go",
      providerModelId: "glm-test",
      accountIds: ["go-account"],
      capabilities: ["text"],
      affinity: { continuity: "none" },
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
    exhaustionReason: availability === "exhausted" ? "rate-limit-reached" as const : null,
  };
}

async function writeUsage(directory: string, snapshots: readonly ReturnType<typeof usage>[]): Promise<void> {
  const usageDirectory = join(directory, "provider-usage");
  await mkdir(usageDirectory, { recursive: true });
  await writeFile(join(usageDirectory, "codex-oauth.json"), JSON.stringify(snapshots));
}

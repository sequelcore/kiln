import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
      work: "new",
      candidates: resolution.candidates,
    });
    if (acquired.status !== "acquired") throw new Error("expected account lease");

    const template = directTemplate();
    const bound = await runtime.bind({ lease: acquired.lease, adapter: template });
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
      work: "new",
      candidates: resolution.candidates,
    });
    if (acquired.status !== "acquired") throw new Error("expected account lease");

    env.OPENAI_API_KEY = "synthetic-key-b";
    await expect(runtime.bind({ lease: acquired.lease, adapter: directTemplate() }))
      .rejects.toThrow("revision changed");
  });
});

function directTemplate(): ManagedDirectProviderRuntimeAdapter {
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
    providerId: "openai",
    model: "gpt-test",
    provider,
    tools: [],
    builtinTools: new Map(),
  });
}

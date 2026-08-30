import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deriveMcpCapabilityIdentityDigest,
  deriveMcpServerBindingDigest,
  MCP_CAPABILITY_IDENTITY_PROJECTION_REVISION,
  projectMcpToolCapabilityDiscovery,
  projectMcpToolCapabilityDiscoveryInput,
  type McpAuthorizationContextEvidence,
  type McpToolCapabilityProjectionInput,
} from "../../src/capabilities/mcp-tool-capability-projection.js";
import {
  MCP_AUTHORIZATION_CONTEXT_PROJECTION_REVISION,
  MCP_SERVER_BINDING_PROJECTION_REVISION,
  MCP_TOOL_PROTOCOL_REVISION,
} from "../../src/capabilities/mcp-tool-capability-discovery.js";
import {
  KilnMcpClient,
  type McpDiscoverySnapshot,
  type McpSdkClient,
  type McpTransportHandle,
} from "../../src/mcp/client/index.js";
import type {
  McpToolCapabilityBindingConfiguration,
  ResolvedMcpServer,
} from "../../src/mcp/index.js";

const EVALUATED_AT = "2026-08-28T10:05:00.000Z";
const OBSERVED_AT = "2026-08-28T10:00:00.000Z";
const VALID_UNTIL = "2026-08-28T11:00:00.000Z";
const SERVER_ID = "fixture";
const SELECTOR = "mcp:fixture:tool:search";
const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;
const AUTH_REVISION = MCP_AUTHORIZATION_CONTEXT_PROJECTION_REVISION;

function binding(
  overrides: Partial<McpToolCapabilityBindingConfiguration> = {},
): McpToolCapabilityBindingConfiguration {
  return {
    capabilityId: "mcp.docs.search",
    kind: "hosted-tool",
    ownerKind: "service",
    implementationKind: "provider-tool",
    contractRevision: "search-contract/v1",
    permissions: ["network-access"],
    approval: "none",
    network: "restricted",
    data: { input: "public", output: "public", retention: "ephemeral" },
    supportedCallers: ["kiln-runtime"],
    limits: {
      maxInputBytes: 8_192,
      maxOutputBytes: 64_000,
      maxDurationMs: 10_000,
      maxArtifacts: 1,
    },
    requiresStructuredOutput: true,
    ...overrides,
  };
}

function server(overrides: Partial<ResolvedMcpServer> = {}): ResolvedMcpServer {
  return {
    id: SERVER_ID,
    enabled: true,
    transport: "streamable-http",
    url: "https://mcp.example.test/mcp",
    admission: {
      state: "admitted",
      effects: {
        search: {
          operation: "observe",
          boundaries: ["network"],
          reversibility: "reversible",
          dataEgress: "none",
          identityUse: "none",
          consequences: [],
          idempotency: "idempotent",
        },
      },
    },
    headers: {
      authorization: { fromCredential: "fixture-token" },
      "x-request-id": { value: "request-a" },
    },
    capabilityBindings: { search: binding() },
    source: "global",
    provenance: {},
    connection: { state: "not-tested" },
    projection: { state: "not-synchronized" },
    ...overrides,
  };
}

function snapshotData(overrides: Partial<McpDiscoverySnapshot> = {}): McpDiscoverySnapshot {
  return {
    serverId: SERVER_ID,
    tools: [{
      serverId: SERVER_ID,
      kind: "tool",
      selector: SELECTOR,
      descriptor: {
        name: "search",
        description: "Search indexed project documents.",
        inputSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
        outputSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: { matches: { type: "array" } },
          required: ["matches"],
          additionalProperties: false,
        },
      },
    }],
    resources: [],
    prompts: [],
    protocolRevision: MCP_TOOL_PROTOCOL_REVISION,
    completeness: "complete",
    invalidated: false,
    discoveredAt: OBSERVED_AT,
    freshness: {
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      ttlMs: 3_600_000,
      cacheScope: "private",
    },
    serverIdentity: { name: "fixture-server", version: "1.0.0" },
    catalog: [{ selector: SELECTOR, kind: "tool", name: "search", admitted: true }],
    ...overrides,
  };
}

async function snapshot(overrides: Partial<McpDiscoverySnapshot> = {}): Promise<McpDiscoverySnapshot> {
  const data = snapshotData(overrides);
  const snapshotServer = server({ id: data.serverId });
  const pageMetadata = data.freshness.validUntil !== undefined && data.freshness.ttlMs === undefined
    ? { ttlMs: 1, cacheScope: "private" as const }
    : data.freshness.ttlMs === undefined
    ? {}
    : {
        ttlMs: data.freshness.ttlMs,
        ...(data.freshness.cacheScope === undefined ? {} : { cacheScope: data.freshness.cacheScope }),
      };
  const sdk = {
    connect: async () => undefined,
    close: async () => undefined,
    listTools: async () => ({
      tools: data.tools.map((tool) => ({
        ...tool.descriptor,
        ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
      })),
      ...pageMetadata,
    }),
    listResources: async () => ({ resources: [], ...pageMetadata }),
    listPrompts: async () => ({ prompts: [], ...pageMetadata }),
    callTool: async () => ({ content: [] }),
    readResource: async () => ({ contents: [] }),
    getPrompt: async () => ({ messages: [] }),
    getServerVersion: () => data.serverIdentity,
    getNegotiatedProtocolVersion: () => MCP_TOOL_PROTOCOL_REVISION,
    getProtocolEra: () => "modern",
  } as unknown as McpSdkClient;
  let listChanged: (() => Promise<void>) | undefined;
  let changedSnapshot: McpDiscoverySnapshot | undefined;
  const client = new KilnMcpClient(snapshotServer, {
    sdkClient: sdk,
    makeTransport: (): McpTransportHandle => ({ close: async () => undefined }),
    credentialResolver: () => "fixture-token",
    discoveryAttestation: {
      bindingDigest: deriveMcpServerBindingDigest(snapshotServer),
      bindingRevision: MCP_SERVER_BINDING_PROJECTION_REVISION,
      authorizationDigest: DIGEST_A,
      authorizationRevision: AUTH_REVISION,
    },
    installListChangedHandler: (handler) => { listChanged = handler; },
    onDiscoveryChanged: (settled) => { changedSnapshot = settled; },
  });
  const settled = await client.discover();
  if (overrides.invalidated) {
    await listChanged?.();
    if (!changedSnapshot) throw new Error("Expected the MCP list-change callback to settle a snapshot.");
    await client.disconnect();
    return changedSnapshot;
  }
  await client.disconnect();
  return settled;
}

async function input(overrides: {
  readonly server?: Partial<ResolvedMcpServer>;
  readonly snapshot?: Partial<McpDiscoverySnapshot>;
  readonly authorization?: Partial<McpAuthorizationContextEvidence>;
  readonly evaluatedAt?: string;
} = {}): Promise<McpToolCapabilityProjectionInput> {
  const resolvedServer = server(overrides.server);
  return {
    evaluatedAt: overrides.evaluatedAt
      ?? (overrides.snapshot?.freshness?.validUntil === EVALUATED_AT
        ? "2026-08-28T10:05:00.001Z"
        : EVALUATED_AT),
    server: resolvedServer,
    snapshot: await snapshot(overrides.snapshot),
    authorization: {
      digest: DIGEST_A,
      revision: AUTH_REVISION,
      ...overrides.authorization,
    },
  };
}

function diagnosticCodes(result: ReturnType<typeof projectMcpToolCapabilityDiscovery>): readonly string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(EVALUATED_AT));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("MCP tool capability projection", () => {
  it("rejects a fabricated or replayed plain snapshot at the productive boundary", async () => {
    const lifecycleInput = await input();
    const fabricated = {
      ...lifecycleInput,
      snapshot: { ...lifecycleInput.snapshot },
    };

    expect(() => projectMcpToolCapabilityDiscovery(fabricated)).toThrow(TypeError);
  });

  it("deterministically admits a complete fresh snapshot with an explicit config binding", async () => {
    const first = projectMcpToolCapabilityDiscovery(await input());
    const second = projectMcpToolCapabilityDiscovery(await input());

    expect(second).toEqual(first);
    expect(first.candidates).toHaveLength(1);
    expect(first.catalog.descriptors).toHaveLength(1);
    expect(first.catalog.decisions).toMatchObject([{ status: "eligible", reasons: ["eligible"] }]);
    expect(first.catalog.descriptors[0]?.capabilityId).toBe("mcp.docs.search");
    expect(first.catalog.descriptors[0]?.effect.operation).toBe("observe");
  });

  it("changes the binding digest and candidate revision when config binding changes", async () => {
    const first = projectMcpToolCapabilityDiscovery(await input());
    const second = projectMcpToolCapabilityDiscovery(await input({
      server: { capabilityBindings: { search: binding({ capabilityId: "mcp.docs.lookup" }) } },
    }));
    const firstProjected = projectMcpToolCapabilityDiscoveryInput(await input());
    const secondProjected = projectMcpToolCapabilityDiscoveryInput(await input({
      server: { capabilityBindings: { search: binding({ capabilityId: "mcp.docs.lookup" }) } },
    }));

    expect(second.candidates[0]?.revision).not.toBe(first.candidates[0]?.revision);
    const firstDigest = firstProjected.snapshot.bindingDigest;
    const secondDigest = secondProjected.snapshot.bindingDigest;
    expect(secondDigest).toBe(firstDigest);
    expect(secondProjected.bindings).toHaveLength(1);
    expect(firstProjected.bindings).toHaveLength(1);
    expect(secondProjected.bindings[0]?.bindingDigest).not.toBe(secondDigest);
    expect(secondProjected.bindings[0]?.ownerIdentityDigest).not.toBe(firstProjected.bindings[0]?.ownerIdentityDigest);
    expect(secondProjected.bindings[0]?.sourceIdentityDigest).not.toBe(firstProjected.bindings[0]?.sourceIdentityDigest);
    expect(secondProjected.bindings[0]?.implementationIdentityDigest).not.toBe(firstProjected.bindings[0]?.implementationIdentityDigest);
  });

  it("projects deterministic role-separated opaque identities from the server binding digest", async () => {
    const first = projectMcpToolCapabilityDiscoveryInput(await input());
    const second = projectMcpToolCapabilityDiscoveryInput(await input());
    const firstBinding = first.bindings[0]!;
    const secondBinding = second.bindings[0]!;
    const identities = [
      firstBinding.ownerIdentityDigest,
      firstBinding.sourceIdentityDigest,
      firstBinding.implementationIdentityDigest,
    ];

    expect(MCP_CAPABILITY_IDENTITY_PROJECTION_REVISION).toBe("mcp-capability-identity/v1");
    expect(identities).toEqual([
      deriveMcpCapabilityIdentityDigest(first.snapshot.bindingDigest, "owner"),
      deriveMcpCapabilityIdentityDigest(first.snapshot.bindingDigest, "source"),
      deriveMcpCapabilityIdentityDigest(first.snapshot.bindingDigest, "implementation"),
    ]);
    expect(new Set(identities).size).toBe(3);
    for (const identity of identities) expect(identity).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(secondBinding.ownerIdentityDigest).toBe(firstBinding.ownerIdentityDigest);
    expect(secondBinding.sourceIdentityDigest).toBe(firstBinding.sourceIdentityDigest);
    expect(secondBinding.implementationIdentityDigest).toBe(firstBinding.implementationIdentityDigest);
  });

  it("binds reference names into identity while excluding resolved secret values", async () => {
    const credentialA = server({ headers: { authorization: { fromCredential: "credential-a" } } });
    const credentialB = server({ headers: { authorization: { fromCredential: "credential-b" } } });
    const environmentA = server({ env: { SEARCH_TOKEN: { fromEnv: "MCP_TOKEN" } } });
    const environmentB = server({ env: { SEARCH_TOKEN: { fromEnv: "MCP_OTHER_TOKEN" } } });

    expect(deriveMcpServerBindingDigest(credentialA)).not.toBe(deriveMcpServerBindingDigest(credentialB));
    expect(deriveMcpServerBindingDigest(environmentA)).not.toBe(deriveMcpServerBindingDigest(environmentB));
    expect(deriveMcpServerBindingDigest(credentialA)).not.toContain("credential-a");
    expect(deriveMcpServerBindingDigest(environmentA)).not.toContain("MCP_TOKEN");

    const projected = projectMcpToolCapabilityDiscoveryInput(await input({
      snapshot: { serverIdentity: { name: "resolved-secret-name", version: "resolved-secret-value" } },
    }));
    expect(JSON.stringify(projected)).not.toContain("resolved-secret-value");
  });

  it("keeps same-shape literal values out of binding identity", () => {
    const first = server({ env: { MODE: { value: "alpha" } } });
    const second = server({ env: { MODE: { value: "beta" } } });
    const firstDigest = deriveMcpServerBindingDigest(first);
    const secondDigest = deriveMcpServerBindingDigest(second);

    // Literal/resolved value rotation is represented by the authorization
    // authority's keyed opaque digest, not by this server-binding projection.
    expect(secondDigest).toBe(firstDigest);
    expect(firstDigest).not.toContain("alpha");
    expect(secondDigest).not.toContain("beta");
  });

  it("keeps raw transport values out of the binding digest", () => {
    const firstStdio = server({
      transport: "stdio",
      command: "runner --token=alpha",
      args: ["--opaque-flag=first", "--mode=stable"],
      cwd: "C:\\mcp\\alpha",
      url: undefined,
      headers: undefined,
    });
    const secondStdio = server({
      transport: "stdio",
      command: "runner --token=beta",
      args: ["--opaque-flag=second", "--mode=stable"],
      cwd: "D:\\mcp\\beta",
      url: undefined,
      headers: undefined,
    });
    expect(deriveMcpServerBindingDigest(secondStdio)).toBe(deriveMcpServerBindingDigest(firstStdio));

    const firstHttp = server({
      url: "https://endpoint-a.example.test/mcp?sig=alpha&session=one",
      headers: undefined,
    });
    const secondHttp = server({
      url: "https://endpoint-b.example.test/other?sig=beta&session=two",
      headers: undefined,
    });
    expect(deriveMcpServerBindingDigest(secondHttp)).toBe(deriveMcpServerBindingDigest(firstHttp));
    expect(JSON.stringify(deriveMcpServerBindingDigest(firstStdio))).not.toContain("alpha");
    expect(JSON.stringify(deriveMcpServerBindingDigest(firstHttp))).not.toContain("endpoint-a");
  });

  it("does not project a binding without an exact admitted server effect", async () => {
    const withoutAdmission = projectMcpToolCapabilityDiscovery(await input({ server: { admission: undefined } }));
    expect(withoutAdmission.candidates).toHaveLength(0);
    expect(withoutAdmission.catalog.decisions).toEqual([
      { status: "ineligible", reasons: ["malformed-descriptor"] },
    ]);
    expect(diagnosticCodes(withoutAdmission)).toContain("binding_missing");

    const malformedAdmission = projectMcpToolCapabilityDiscovery(await input({
      server: {
        admission: {
          state: "admitted",
          effects: {
            search: {
              operation: "observe",
              boundaries: ["network"],
              reversibility: "reversible",
              dataEgress: "none",
              identityUse: "none",
              consequences: [],
              idempotency: "idempotent",
              extra: "must-fail",
            } as never,
          },
        },
      },
    }));
    expect(malformedAdmission.candidates).toHaveLength(0);
    expect(diagnosticCodes(malformedAdmission)).toContain("binding_missing");
  });

  it("does not project a replayed snapshot after the server is disabled", async () => {
    const disabled = projectMcpToolCapabilityDiscovery(await input({ server: { enabled: false } }));

    expect(disabled.candidates).toHaveLength(0);
    expect(disabled.catalog.descriptors).toHaveLength(0);
    expect(diagnosticCodes(disabled)).toContain("binding_missing");
  });

  it("ignores provenance, source paths, connection/projection status, and server identity metadata", async () => {
    const first = projectMcpToolCapabilityDiscovery(await input());
    const second = projectMcpToolCapabilityDiscovery(await input({
      server: {
        source: "overridden",
        provenance: {
          url: { scope: "project", sourcePath: "synthetic/other.yaml", field: "url" },
        },
        connection: { state: "disabled" },
        projection: { state: "not-synchronized" },
      },
      snapshot: { serverIdentity: { name: "different-server", version: "9.9.9" } },
    }));

    expect(second).toEqual(first);
    expect(deriveMcpServerBindingDigest(server())).toBe(deriveMcpServerBindingDigest(server({
      source: "overridden",
      provenance: {
        url: { scope: "project", sourcePath: "synthetic/other.yaml", field: "url" },
      },
      connection: { state: "disabled" },
      projection: { state: "not-synchronized" },
    })));
  });

  it("invalidates a settled snapshot when auth evidence rotates and requires bounded auth evidence revision", async () => {
    const first = projectMcpToolCapabilityDiscovery(await input());
    const rotated = projectMcpToolCapabilityDiscovery(await input({ authorization: { digest: DIGEST_B } }));
    expect(rotated.catalog.descriptors).toHaveLength(0);
    expect(rotated.candidates[0]?.revision).toBe(first.candidates[0]?.revision);
    expect(diagnosticCodes(rotated)).toContain("snapshot_invalidated");

    const malformed = projectMcpToolCapabilityDiscovery(await input({
      authorization: { revision: "x".repeat(128) },
    }));
    expect(malformed.catalog.descriptors).toHaveLength(0);
    expect(diagnosticCodes(malformed)).toContain("snapshot_invalidated");

    const missingRevision = await input();
    const missing = {
      ...missingRevision,
      authorization: { digest: missingRevision.authorization.digest },
    } as unknown as McpToolCapabilityProjectionInput;
    const missingResult = projectMcpToolCapabilityDiscovery(missing);
    expect(missingResult.catalog.descriptors).toHaveLength(0);
    expect(diagnosticCodes(missingResult)).toContain("snapshot_invalidated");
  });

  it("uses the exact server binding projection revision and preserves no-TTL evidence", async () => {
    const noTtlInput = await input({
      snapshot: { freshness: { observedAt: OBSERVED_AT } },
    });
    const projected = projectMcpToolCapabilityDiscoveryInput(noTtlInput);
    expect(projected.snapshot.bindingRevision).toBe(MCP_SERVER_BINDING_PROJECTION_REVISION);
    expect(projected.snapshot.freshness).toEqual({ observedAt: EVALUATED_AT });

    const result = projectMcpToolCapabilityDiscovery(noTtlInput);
    expect(result.catalog.descriptors).toHaveLength(0);
    expect(diagnosticCodes(result)).toContain("snapshot_freshness_invalid");
  });

  it.each([
    ["invalidated", { invalidated: true }, "snapshot_invalidated"],
    ["expired", { freshness: { observedAt: OBSERVED_AT, validUntil: EVALUATED_AT } }, "snapshot_stale"],
  ] as const)("keeps %s snapshots ineligible", async (_label, snapshotOverrides, diagnosticCode) => {
    const result = projectMcpToolCapabilityDiscovery(await input({ snapshot: snapshotOverrides }));

    expect(result.catalog.descriptors).toHaveLength(0);
    expect(result.catalog.decisions[0]?.status).toBe("ineligible");
    expect(diagnosticCodes(result)).toContain(diagnosticCode);
  });

  it("keeps missing bindings and cross-server snapshots ineligible", async () => {
    const missingBinding = projectMcpToolCapabilityDiscovery(await input({ server: { capabilityBindings: {} } }));
    expect(missingBinding.catalog.descriptors).toHaveLength(0);
    expect(diagnosticCodes(missingBinding)).toContain("binding_missing");

    const crossServer = projectMcpToolCapabilityDiscovery(await input({
      snapshot: {
        serverId: "other-server",
        tools: [{
          serverId: "other-server",
          kind: "tool",
          selector: "mcp:other-server:tool:search",
          descriptor: snapshotData().tools[0]!.descriptor,
        }],
      },
    }));
    expect(crossServer.catalog.descriptors).toHaveLength(0);
    expect(crossServer.catalog.decisions).toEqual([
      { status: "ineligible", reasons: ["malformed-descriptor"] },
    ]);
    expect(diagnosticCodes(crossServer)).toContain("binding_missing");
  });
});

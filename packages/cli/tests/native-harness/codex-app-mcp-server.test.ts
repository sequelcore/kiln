import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { KilnConfigStatusSnapshot } from "@kilnai/gateway-contracts";
import type { ManagedJobRecord } from "@kilnai/runtime";
import { discoverNativeHarnessProjectRoot } from "../../src/application/native-harness-project-root.js";
import {
  CodexAppMcpServer,
  createNativeHarnessInspectionService,
  type CodexAppMcpSdk,
} from "../../src/native-harness/codex-app-mcp-server.js";

const OBSERVED_AT = "2026-07-13T18:01:00.000Z";
const TEMPORARY_CWD = join(tmpdir(), "kiln-codex-app-mcp-unrelated-cwd");

function snapshot(overrides: Partial<KilnConfigStatusSnapshot> = {}): KilnConfigStatusSnapshot {
  return {
    evidenceVersion: 1,
    generatedAt: "2026-07-13T18:00:00.000Z",
    project: {
      rootPath: "C:\\workspace\\kiln",
      projectName: "kiln",
      hasGitRoot: true,
      hasKilnYaml: true,
      kilnYaml: { path: "C:\\workspace\\kiln\\.kiln\\kiln.yaml", status: "valid" },
      projectContext: { path: "C:\\workspace\\kiln\\.kiln\\project-context.md", status: "valid" },
    },
    global: { path: "C:\\Users\\operator\\.kiln\\config.yaml", status: "valid" },
    effectiveConfigStatus: "valid",
    effectiveConfig: {
      workGovernance: {
        defaultPosture: "orchestrate",
        directExecution: { maxFiles: 1, maxRisk: "low" },
        requireDelegationFor: ["architecture"],
        requiredEvidence: ["surface-map", "tests"],
      },
    },
    errors: [],
    projections: [],
    permissionIntegrity: [],
    setup: {
      projectRoot: "C:\\workspace\\kiln",
      projectContext: { path: "C:\\workspace\\kiln\\.kiln\\project-context.md", status: "valid", recommendation: "none" },
      repoShims: [],
      globalInstructionShims: [],
      nativeProjections: [],
      permissionIntegrity: [],
      recommendedActions: ["none"],
    },
    harnessCapabilities: [{
      harness: "codex",
      displayName: "Codex",
      runtimeConfigInjection: "supported",
      nativeProjection: "install-state",
      nativeConfigImport: "supported",
      mcpRuntimeTools: "supported",
      hooks: "supported",
      crossHarnessManagedInvocation: { adapterId: "kiln-managed-invocation", supportedProviderIds: ["opencode-go"] },
    }],
    ...overrides,
  };
}

function createServer(
  status = snapshot(),
  options: Parameters<typeof createNativeHarnessInspectionService>[0] = {},
): CodexAppMcpServer {
  return new CodexAppMcpServer({
    inspection: createNativeHarnessInspectionService({
      readStatus: async () => status,
      readBridgeProjection: async () => "current",
      readProjectRoot: async () => ({ status: "resolved", rootPath: "C:\\workspace\\kiln" }),
      now: () => new Date(OBSERVED_AT),
      ...options,
    }),
  });
}

function managedJob(overrides: Partial<ManagedJobRecord> = {}): ManagedJobRecord {
  return {
    version: 1,
    id: "managed-job-0001",
    state: "succeeded",
    projectId: "trusted-project",
    configuredAgentProfileId: "scout",
    admissionProfileId: "foundation-readonly-plan",
    routeId: "route-go",
    providerId: "opencode-go",
    governanceSource: "kiln-governance",
    admissionId: "admission-001",
    timeoutSource: "default",
    requestFingerprint: "a".repeat(64),
    idempotencyKeyHash: "b".repeat(64),
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
    ...overrides,
  };
}

describe("CodexAppMcpServer", () => {
  afterEach(() => {
    rmSync(TEMPORARY_CWD, { recursive: true, force: true });
  });
  it("discovers the three inspection tools and exactly two managed-job tools", () => {
    expect(createServer().listTools().map((tool) => tool.name)).toEqual([
      "kiln_status_inspect",
      "kiln_work_governance_inspect",
      "kiln_capability_inspect",
      "kiln_managed_agent_invoke",
      "kiln_managed_agent_status",
    ]);
  });

  it("narrows invoke to safely admitted configured agents without exposing route configuration", () => {
    const server = new CodexAppMcpServer({
      configuredAgents: [{
        configuredAgentProfileId: "scout",
        displayName: "Scout",
        role: "Read-only scout",
        availability: "admitted",
        providerFamily: "opencode-go",
        admissionProfileId: "foundation-readonly-plan",
      }],
    });
    const tool = server.listTools().find((candidate) => candidate.name === "kiln_managed_agent_invoke");

    expect(tool?.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ["objective", "configuredAgentProfileId", "idempotencyKey"],
      properties: { configuredAgentProfileId: { enum: ["scout"] } },
    });
    expect(JSON.stringify(tool?.inputSchema)).not.toContain("route");
    expect(JSON.stringify(tool?.inputSchema)).not.toContain("foundation-readonly-plan");
  });

  it("projects only trusted request identity into the canonical managed-job submit", async () => {
    const submitted: unknown[] = [];
    const server = new CodexAppMcpServer({
      inspection: createNativeHarnessInspectionService(),
      managedJobs: {
        submit: async (input) => { submitted.push(input); return managedJob(); },
        status: async () => managedJob(),
      },
      requestIdentity: () => ({ callerId: "trusted-codex-user", requestId: "trusted-request" }),
    });

    const result = await server.callTool("kiln_managed_agent_invoke", { objective: "  inspect bounded work  ", configuredAgentProfileId: "scout", idempotencyKey: "retry-1" });
    expect(submitted).toEqual([{ objective: "inspect bounded work", configuredAgentProfileId: "scout", idempotencyKey: "retry-1", callerId: "trusted-codex-user" }]);
    expect(result.structuredContent).toMatchObject({ job: { id: "managed-job-0001", routeId: "route-go" }, evidence: { callerId: "trusted-codex-user", requestId: "trusted-request" } });
    expect(JSON.stringify(result)).not.toContain("objective");
  });

  it("rejects unknown invoke fields and malformed status identifiers before the application owner", async () => {
    let calls = 0;
    const server = new CodexAppMcpServer({ managedJobs: { submit: async () => { calls++; return managedJob(); }, status: async () => { calls++; return managedJob(); } } });
    await expect(server.callTool("kiln_managed_agent_invoke", { objective: "work", configuredAgentProfileId: "scout", idempotencyKey: "key", provider: "opencode-go" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
    await expect(server.callTool("kiln_managed_agent_invoke", { objective: "work", configuredAgentProfileId: "scout", idempotencyKey: "key", admissionProfileId: "foundation-readonly-plan" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
    await expect(server.callTool("kiln_managed_agent_status", { jobId: "not valid" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
    expect(calls).toBe(0);
  });

  it("maps application diagnostics without exposing internal error text", async () => {
    const server = new CodexAppMcpServer({ managedJobs: { submit: async () => { throw Object.assign(new Error("C:\\secrets\\provider payload"), { code: "provider_rejected" }); }, status: async () => managedJob() } });
    const result = await server.callTool("kiln_managed_agent_invoke", { objective: "work", configuredAgentProfileId: "scout", idempotencyKey: "key" });
    expect(result).toMatchObject({ isError: true, structuredContent: { error: { code: "provider_rejected" } } });
    expect(JSON.stringify(result)).not.toContain("secrets");
  });

  it("returns curated canonical status with Codex App evidence and no config paths", async () => {
    const result = await createServer().callTool("kiln_status_inspect", {});

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      operation: "status",
      evidence: {
        harness: { kind: "native-harness", harness: "codex", channel: "app" },
        authoritySource: "kiln-config-status",
        directProviderAuthority: "kiln-runtime",
        nativeHarnessPermissionAuthority: "native-harness-only",
        observedAt: "2026-07-13T18:00:00.000Z",
      },
      status: { projectName: "kiln", effectiveConfigStatus: "valid" },
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("C:\\Users");
    expect(result.content[0]?.text).toBe(JSON.stringify(result.structuredContent));
  });

  it("returns the resolved governance policy without invoking work-item tools", async () => {
    const result = await createServer().callTool("kiln_work_governance_inspect", {});

    expect(result.structuredContent).toMatchObject({
      operation: "work-governance",
      policy: { defaultPosture: "orchestrate", directExecution: { maxFiles: 1, maxRisk: "low" } },
    });
  });

  it("reports capability availability from the canonical capability projection", async () => {
    const result = await createServer().callTool("kiln_capability_inspect", {});

    expect(result.structuredContent).toMatchObject({
      operation: "capability",
      capability: { availability: "available", capabilitySource: "kiln-harness-integration-capabilities" },
    });
  });

  it("projects only safe configured-agent admission summaries through capability inspection", async () => {
    const result = await createServer(snapshot(), {
      managedAgents: [{
        configuredAgentProfileId: "scout",
        availability: "unavailable",
        providerFamily: "opencode-go",
        admissionProfileId: "foundation-readonly-plan",
        diagnostic: "route_unavailable",
        operatorAction: "Restore the configured route hint for this agent.",
      }],
    }).callTool("kiln_capability_inspect", {});

    expect(result.structuredContent).toMatchObject({
      capability: {
        managedAgents: [{
          configuredAgentProfileId: "scout",
          availability: "unavailable",
          providerFamily: "opencode-go",
          admissionProfileId: "foundation-readonly-plan",
          diagnostic: "route_unavailable",
        }],
      },
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("model");
  });

  it("fails closed when a managed-agent summary contains noncanonical metadata", async () => {
    const result = await createServer(snapshot(), {
      managedAgents: [{
        configuredAgentProfileId: "scout",
        availability: "unresolved",
        providerFamily: "opencode-go",
        admissionProfileId: "foundation-readonly-plan",
        diagnostic: "eligibility_unresolved",
      }, {
        configuredAgentProfileId: "poisoned-agent",
        availability: "admitted",
        providerFamily: "C:\\secret-model",
        admissionProfileId: "foundation-readonly-plan",
      } as never],
    }).callTool("kiln_capability_inspect", {});
    expect(result.structuredContent).toMatchObject({
      capability: { managedAgents: [{ configuredAgentProfileId: "scout", availability: "unresolved" }] },
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("poisoned-agent");
    expect(JSON.stringify(result.structuredContent)).not.toContain("secret-model");
  });

  it("fails closed for malformed input, unsupported operations, and mutation attempts", async () => {
    await expect(createServer().callTool("kiln_status_inspect", { extra: true })).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "KILN_TOOL_INVALID_REQUEST" } },
    });
    await expect(createServer().callTool("unknown", {})).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "KILN_TOOL_UNSUPPORTED" } },
    });
    await expect(createServer().callTool("managed_agent.invoke", {})).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "KILN_TOOL_READ_ONLY" } },
    });
  });

  it("returns the live stale-projection condition as a degraded, actionable status snapshot", async () => {
    const stale = await createServer(snapshot({ projections: [{ targetId: "codex-global-instructions", path: "secret-path", kind: "global-instruction-shim", status: "stale" }] })).callTool("kiln_status_inspect", {});

    expect(stale).toMatchObject({
      structuredContent: {
        operation: "status",
        status: { completeness: "degraded" },
        diagnostics: [expect.objectContaining({ code: "KILN_PROJECTION_STALE", targetId: "codex-global-instructions" })],
      },
    });
    expect(JSON.stringify(stale)).not.toContain("secret-path");
  });

  it("refuses governance authority while returning a typed diagnostic envelope", async () => {
    const result = await createServer(snapshot({ effectiveConfig: {} })).callTool("kiln_work_governance_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { operation: "work-governance", authority: "unresolved", diagnostics: [expect.objectContaining({ code: "KILN_GOVERNANCE_EVIDENCE_MALFORMED" })] },
    });
  });

  it("rejects malformed resolved governance policy instead of authorizing it", async () => {
    const malformed = snapshot({
      effectiveConfig: {
        workGovernance: {
          defaultPosture: "direct",
          directExecution: { maxFiles: 0, maxRisk: "low" },
          requireDelegationFor: ["not-a-trigger"],
          requiredEvidence: ["surface-map"],
        },
      },
    });

    const result = await createServer(malformed).callTool("kiln_work_governance_inspect", {});

    expect(result).toMatchObject({
      structuredContent: {
        operation: "work-governance",
        authority: "unresolved",
        diagnostics: [expect.objectContaining({ code: "KILN_GOVERNANCE_EVIDENCE_MALFORMED" })],
      },
    });
    expect(JSON.stringify(result)).not.toContain("not-a-trigger");
  });

  it.each([
    ["missing required discriminants", { defaultPosture: "direct" }],
    ["fractional direct file limit", { defaultPosture: "direct", directExecution: { maxFiles: 1.5, maxRisk: "low" }, requireDelegationFor: [], requiredEvidence: [] }],
    ["unsupported risk", { defaultPosture: "direct", directExecution: { maxFiles: 1, maxRisk: "critical" }, requireDelegationFor: [], requiredEvidence: [] }],
    ["duplicated authority trigger", { defaultPosture: "direct", directExecution: { maxFiles: 1, maxRisk: "low" }, requireDelegationFor: ["security", "security"], requiredEvidence: [] }],
    ["unsupported evidence", { defaultPosture: "direct", directExecution: { maxFiles: 1, maxRisk: "low" }, requireDelegationFor: [], requiredEvidence: ["operator-says-so"] }],
  ])("rejects %s governance evidence", async (_, workGovernance) => {
    const result = await createServer(snapshot({ effectiveConfig: { workGovernance } })).callTool("kiln_work_governance_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { authority: "unresolved", diagnostics: [expect.objectContaining({ code: "KILN_GOVERNANCE_EVIDENCE_MALFORMED" })] },
    });
  });

  it("returns observed capabilities while classifying bridge and projection evidence as unresolved", async () => {
    const inspection = createNativeHarnessInspectionService({
      readStatus: async () => snapshot({ projections: [{ targetId: "codex-config", path: "ignored", kind: "native", status: "drifted" }] }),
      readBridgeProjection: async () => "invalid",
      readProjectRoot: async () => ({ status: "resolved", rootPath: "C:\\workspace\\kiln" }),
      now: () => new Date(OBSERVED_AT),
    });
    const result = await new CodexAppMcpServer({ inspection }).callTool("kiln_capability_inspect", {});

    expect(result).toMatchObject({
      structuredContent: {
        operation: "capability",
        capability: { availability: "unresolved" },
        diagnostics: expect.arrayContaining([expect.objectContaining({ code: "KILN_BRIDGE_PROJECTION_UNRESOLVED" })]),
      },
    });
  });

  it("keeps independently observed Codex capability available when an unrelated projection is stale", async () => {
    const result = await createServer(snapshot({
      projections: [{ targetId: "claude-global-instructions", path: "ignored", kind: "global-instruction-shim", status: "stale" }],
    })).callTool("kiln_capability_inspect", {});

    expect(result).toMatchObject({
      structuredContent: {
        operation: "capability",
        capability: { availability: "available", bridgeProjection: "current" },
        diagnostics: [expect.objectContaining({ code: "KILN_PROJECTION_STALE", targetId: "claude-global-instructions" })],
      },
    });
  });

  it("returns a typed unresolved capability envelope when the bridge read fails", async () => {
    const result = await createServer(snapshot(), {
      readBridgeProjection: async () => {
        throw new Error("C:\\secrets\\config.toml token=super-secret");
      },
    }).callTool("kiln_capability_inspect", {});

    expect(result).toMatchObject({
      structuredContent: {
        operation: "capability",
        capability: { availability: "unresolved" },
        diagnostics: expect.arrayContaining([expect.objectContaining({ code: "KILN_BRIDGE_READ_FAILED" })]),
      },
    });
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(JSON.stringify(result)).not.toContain("C:\\secrets");
  });

  it("fails closed for malformed canonical evidence and never reflects secrets", async () => {
    const result = await createServer(snapshot({ errors: ["token=super-secret"] })).callTool("kiln_status_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { operation: "status", status: { completeness: "degraded" }, diagnostics: [expect.objectContaining({ code: "KILN_STATUS_EVIDENCE_INCOMPLETE" })] },
    });
    expect(JSON.stringify(result)).not.toContain("super-secret");
  });

  it("reports a missing inspection owner through a stable unresolved envelope", async () => {
    const server = new CodexAppMcpServer({ inspection: createNativeHarnessInspectionService({
      readStatus: null,
      readBridgeProjection: async () => "current",
      readProjectRoot: async () => ({ status: "resolved", rootPath: "C:\\workspace\\kiln" }),
      now: () => new Date(OBSERVED_AT),
    }) });

    await expect(server.callTool("kiln_status_inspect", {})).resolves.toMatchObject({
      structuredContent: {
        operation: "status",
        status: { completeness: "unresolved" },
        diagnostics: [expect.objectContaining({ code: "KILN_RUNTIME_OWNER_MISSING" })],
      },
    });
  });

  it.each([
    ["missing", "KILN_PROJECT_ROOT_UNRESOLVED"],
    ["ambiguous", "KILN_PROJECT_ROOT_AMBIGUOUS"],
  ] as const)("keeps %s project discovery unavailable without reading the caller CWD", async (status, code) => {
    const readStatus = async () => snapshot();
    const result = await createServer(snapshot(), {
      readStatus,
      readProjectRoot: async () => ({ status }),
    }).callTool("kiln_status_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { status: { completeness: "unresolved" }, diagnostics: [expect.objectContaining({ code })] },
    });
  });

  it("contains project-discovery initialization failures in a stable unresolved envelope", async () => {
    const result = await createServer(snapshot(), {
      readProjectRoot: async () => { throw new Error("C:\\private\\project identity"); },
    }).callTool("kiln_status_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { status: { completeness: "unresolved" }, diagnostics: [expect.objectContaining({ code: "KILN_INTERNAL_ADAPTER_FAILURE" })] },
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("validates evidence versions and observation freshness before projecting authority", async () => {
    const cases: readonly [string, KilnConfigStatusSnapshot, string][] = [
      ["missing version", snapshot({ evidenceVersion: undefined }), "KILN_EVIDENCE_MALFORMED"],
      ["missing observation", snapshot({ generatedAt: undefined } as unknown as Partial<KilnConfigStatusSnapshot>), "KILN_EVIDENCE_MALFORMED"],
      ["unsupported version", snapshot({ evidenceVersion: 2 }), "KILN_EVIDENCE_VERSION_UNSUPPORTED"],
      ["future observation", snapshot({ generatedAt: "2026-07-13T18:03:00.000Z" }), "KILN_EVIDENCE_FUTURE"],
      ["stale observation", snapshot({ generatedAt: "2026-07-13T17:50:00.000Z" }), "KILN_EVIDENCE_STALE"],
      ["invalid observation", snapshot({ generatedAt: "not-a-timestamp" }), "KILN_EVIDENCE_MALFORMED"],
    ];

    for (const [, status, code] of cases) {
      const governance = await createServer(status).callTool("kiln_work_governance_inspect", {});
      expect(governance).toMatchObject({
        structuredContent: { authority: "unresolved", diagnostics: [expect.objectContaining({ code })] },
      });
    }
  });

  it("returns a configuration-read diagnostic when the canonical owner throws", async () => {
    const result = await createServer(snapshot(), {
      readStatus: async () => { throw new Error("C:\\private\\config.yaml token=super-secret"); },
    }).callTool("kiln_status_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { status: { completeness: "unresolved" }, diagnostics: [expect.objectContaining({ code: "KILN_CONFIGURATION_READ_FAILED" })] },
    });
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(JSON.stringify(result)).not.toContain("C:\\private");
  });

  it("does not let stale projection evidence grant or revoke independently valid governance authority", async () => {
    const result = await createServer(snapshot({
      projections: [{ targetId: "codex-global-instructions", path: "ignored", kind: "global-instruction-shim", status: "stale" }],
    })).callTool("kiln_work_governance_inspect", {});

    expect(result).toMatchObject({
      structuredContent: {
        authority: "authoritative",
        diagnostics: [expect.objectContaining({ code: "KILN_PROJECTION_STALE" })],
      },
    });
  });

  it("rejects malformed status, projection, route, and capability evidence without leaking it", async () => {
    const malformed = snapshot({
      projections: [{ targetId: "codex", path: "C:\\secret", kind: "native", status: "current", routeIntegrity: { routeStatus: "unknown", credentialStatus: "valid", classification: "x" } }] as KilnConfigStatusSnapshot["projections"],
      harnessCapabilities: [{ harness: "codex", displayName: "Codex", runtimeConfigInjection: "supported", nativeProjection: "install-state", nativeConfigImport: "supported", mcpRuntimeTools: 7, hooks: "supported", crossHarnessManagedInvocation: { adapterId: "a", supportedProviderIds: [] } }] as KilnConfigStatusSnapshot["harnessCapabilities"],
    });

    const result = await createServer(malformed).callTool("kiln_status_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { status: { completeness: "unresolved" }, diagnostics: [expect.objectContaining({ code: "KILN_EVIDENCE_MALFORMED" })] },
    });
    expect(JSON.stringify(result)).not.toContain("C:\\secret");
  });

  it.each([
    ["route classification", snapshot({ projections: [{ targetId: "codex", path: "C:\\secret", kind: "native", status: "current", routeIntegrity: { catalogStatus: { status: "available" }, explicitProbeStatus: "succeeded", credentialSource: "none", bareProofSupported: true, routeStatus: "matches-canonical", credentialStatus: "valid", classification: "token=super-secret" } }] })],
    ["capability status", snapshot({ harnessCapabilities: [{ ...snapshot().harnessCapabilities[0]!, mcpRuntimeTools: "token=super-secret" }] })],
  ])("rejects poisoned %s evidence before it reaches a tool response", async (_, status) => {
    const result = await createServer(status).callTool("kiln_status_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { status: { completeness: "unresolved" }, diagnostics: [expect.objectContaining({ code: "KILN_EVIDENCE_MALFORMED" })] },
    });
    expect(JSON.stringify(result)).not.toContain("super-secret");
  });

  it("discovers this checkout from the adapter module, independent of repository or unrelated process CWD", () => {
    const repositoryRoot = discoverNativeHarnessProjectRoot();
    mkdirSync(TEMPORARY_CWD, { recursive: true });
    const originalCwd = process.cwd();
    try {
      process.chdir(TEMPORARY_CWD);
      expect(discoverNativeHarnessProjectRoot()).toEqual(repositoryRoot);
    } finally {
      process.chdir(originalCwd);
    }
    expect(repositoryRoot).toMatchObject({ status: "resolved" });
  });

  it("uses no CLI subprocess route", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "native-harness", "codex-app-mcp-server.ts"), "utf8");
    expect(source).not.toMatch(/child_process|spawn\(|exec\(|kiln tools|codex exec|opencode run/);
    expect(source).not.toContain("process.cwd()");
  });

  it("registers MCP protocol handlers and closes the connected transport", async () => {
    const handlers = new Map<unknown, (request: { params: Record<string, unknown> }) => unknown>();
    let serverClosed = false;
    let transportClosed = false;
    const listSchema = Symbol("tools/list");
    const callSchema = Symbol("tools/call");
    const sdk: CodexAppMcpSdk = {
      Server: class {
        setRequestHandler(schema: unknown, handler: (request: { params: Record<string, unknown> }) => unknown): void { handlers.set(schema, handler); }
        async connect(): Promise<void> {}
        async close(): Promise<void> { serverClosed = true; }
      },
      ListToolsRequestSchema: listSchema,
      CallToolRequestSchema: callSchema,
    };
    const transport = { close: async () => { transportClosed = true; } } as never;
    const server = new CodexAppMcpServer({
      inspection: createNativeHarnessInspectionService({
        readStatus: async () => snapshot(),
        readBridgeProjection: async () => "current",
        readProjectRoot: async () => ({ status: "resolved", rootPath: "C:\\workspace\\kiln" }),
        now: () => new Date(OBSERVED_AT),
      }),
      sdkLoader: async () => sdk,
      transportFactory: () => transport,
    });

    await server.start();
    await expect(handlers.get(listSchema)!({ params: {} })).resolves.toMatchObject({ tools: expect.any(Array) });
    await expect(handlers.get(callSchema)!({ params: { name: "kiln_status_inspect", arguments: {} } })).resolves.toMatchObject({ structuredContent: { operation: "status" } });
    await server.close();
    expect(serverClosed).toBe(true);
    expect(transportClosed).toBe(true);
  });
});

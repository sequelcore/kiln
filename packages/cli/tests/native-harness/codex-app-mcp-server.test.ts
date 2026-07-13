import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { KilnConfigStatusSnapshot } from "@kilnai/gateway-contracts";
import {
  CodexAppMcpServer,
  createNativeHarnessInspectionService,
  type CodexAppMcpSdk,
} from "../../src/native-harness/codex-app-mcp-server.js";

function snapshot(overrides: Partial<KilnConfigStatusSnapshot> = {}): KilnConfigStatusSnapshot {
  return {
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

function createServer(status = snapshot()): CodexAppMcpServer {
  return new CodexAppMcpServer({
    inspection: createNativeHarnessInspectionService({ readStatus: async () => status, readBridgeProjection: async () => "current" }),
  });
}

describe("CodexAppMcpServer", () => {
  it("discovers only the three read-only inspection tools", () => {
    expect(createServer().listTools().map((tool) => tool.name)).toEqual([
      "kiln_status_inspect",
      "kiln_work_governance_inspect",
      "kiln_capability_inspect",
    ]);
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

  it("fails closed for stale or incomplete evidence and never reflects secrets", async () => {
    const result = await createServer(snapshot({ errors: ["token=super-secret"] })).callTool("kiln_status_inspect", {});

    expect(result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "KILN_STATUS_EVIDENCE_INCOMPLETE" } },
    });
    expect(JSON.stringify(result)).not.toContain("super-secret");
    const stale = await createServer(snapshot({ projections: [{ targetId: "codex", path: "ignored", kind: "native", status: "stale" }] })).callTool("kiln_status_inspect", {});
    expect(stale).toMatchObject({ isError: true, structuredContent: { error: { code: "KILN_STATUS_EVIDENCE_INCOMPLETE" } } });
  });

  it("reports a missing inspection owner as an actionable stable error", async () => {
    const server = new CodexAppMcpServer({ inspection: createNativeHarnessInspectionService({ readBridgeProjection: async () => "current" }) });

    await expect(server.callTool("kiln_status_inspect", {})).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "KILN_RUNTIME_OWNER_MISSING" } },
    });
  });

  it("uses no CLI subprocess route", () => {
    const source = readFileSync(join(process.cwd(), "src", "native-harness", "codex-app-mcp-server.ts"), "utf8");
    expect(source).not.toMatch(/child_process|spawn\(|exec\(|kiln tools|codex exec|opencode run/);
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
      inspection: createNativeHarnessInspectionService({ readStatus: async () => snapshot(), readBridgeProjection: async () => "current" }),
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

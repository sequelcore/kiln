import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KilnMcpClient,
  type McpDiscoverySnapshotAttestation,
  type McpSdkClient,
  type ResolvedMcpServer,
} from "@kilnai/core";
import { mcpConfigCommand } from "../../src/commands/mcp-config.js";
import type { KilnAppConfig } from "../../src/config.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";

const mocks = vi.hoisted(() => {
  const authorizationLease = {
    evidence: {
      digest: `sha256:${"a".repeat(64)}`,
      revision: "mcp-authorization-context/v1",
    },
    credentialResolver: vi.fn(),
    environment: Object.freeze({}),
  };
  const credentialAccess = {
    available: true,
    set: vi.fn(),
    resolve: vi.fn(),
    exists: vi.fn(),
    acquireAuthorizationContext: vi.fn(() => authorizationLease),
  };
  const discover = vi.fn();
  const disconnect = vi.fn(async () => undefined);
  const discoverProviderCapabilities = vi.fn(async () => []);
  const callTool = vi.fn(async () => undefined);
  return {
    load: vi.fn(() => ({ servers: {}, diagnostics: [] })),
    sync: vi.fn(async (_resolution: unknown, root: string, options: { harnesses: readonly string[] }) => ({
      targets: options.harnesses.map((harness) => ({ harness, path: root, status: "current" })),
    })),
    uninstall: vi.fn(async (root: string, options: { harnesses: readonly string[] }) => ({
      targets: options.harnesses.map((harness) => ({ harness, path: root, status: "uninstalled" })),
    })),
    globalSync: vi.fn(async (input: { operation: string; harnesses: readonly string[] }) => ({
      operation: input.operation,
      targets: input.harnesses.map((harness) => ({ harness, path: "global", status: input.operation === "uninstall" ? "uninstalled" : "current", changed: true })),
    })),
    discover,
    discoverProviderCapabilities,
    callTool,
    disconnect,
    credentialAccess,
    authorizationLease,
    createClient: vi.fn(),
    recordDiscovery: vi.fn(() => ({ health: "healthy", discovery: "current" })),
    recordFailure: vi.fn(),
  };
});

vi.mock("../../src/config/config-merger.js", () => ({
  loadResolvedKilnMcpConfiguration: mocks.load,
}));
vi.mock("../../src/config/native-mcp-projection-sync.js", () => ({
  syncNativeMcpProjections: mocks.sync,
  uninstallNativeMcpProjections: mocks.uninstall,
}));
vi.mock("../../src/config/global-control-plane-mcp-projection.js", () => ({
  syncGlobalControlPlaneMcpProjections: mocks.globalSync,
}));
vi.mock("../../src/config/mcp-credentials.js", () => ({
  createCanonicalMcpClient: mocks.createClient,
  createMcpCredentialAccess: vi.fn(() => mocks.credentialAccess),
}));
vi.mock("../../src/config/mcp-runtime-state.js", () => ({
  recordMcpDiscovery: mocks.recordDiscovery,
  recordMcpFailure: mocks.recordFailure,
}));

const APP_CONFIG: KilnAppConfig = {
  createRegistry: () => { throw new Error("not used"); },
};

const PROJECT_PATH = resolveProjectRoot({ cwd: process.cwd() }).rootPath;
const PRIVATE_BINDING = expect.objectContaining({ canonicalRoot: PROJECT_PATH });

describe("mcpConfigCommand", () => {
  beforeEach(() => {
    mocks.load.mockClear();
    mocks.sync.mockClear();
    mocks.uninstall.mockClear();
    mocks.globalSync.mockClear();
    mocks.discover.mockReset();
    mocks.discoverProviderCapabilities.mockClear();
    mocks.callTool.mockClear();
    mocks.disconnect.mockClear();
    mocks.createClient.mockReset();
    mocks.createClient.mockImplementation((
      server: ResolvedMcpServer,
      _kilnHome: string,
      credentialResolver: (credentialId: string) => string | undefined,
      environment: Readonly<Record<string, string | undefined>>,
      discoveryAttestation: McpDiscoverySnapshotAttestation,
    ) => {
      const sdkClient = {
        connect: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
        listTools: vi.fn(async () => ({
          tools: [{
            name: "search",
            description: "Search fixture documents.",
            inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
            outputSchema: { type: "object", properties: { matches: { type: "array" } }, required: ["matches"], additionalProperties: false },
          }],
          ttlMs: 3_600_000,
          cacheScope: "private",
        })),
        listResources: vi.fn(async () => ({ resources: [], ttlMs: 3_600_000, cacheScope: "private" })),
        listPrompts: vi.fn(async () => ({ prompts: [], ttlMs: 3_600_000, cacheScope: "private" })),
        callTool: vi.fn(async () => ({})),
        readResource: vi.fn(async () => ({ contents: [] })),
        getPrompt: vi.fn(async () => ({ messages: [] })),
        getServerVersion: vi.fn(() => ({ name: "fixture", version: "1.0.0" })),
        getNegotiatedProtocolVersion: vi.fn(() => "2026-07-28"),
        getProtocolEra: vi.fn(() => "modern"),
      } as unknown as McpSdkClient;
      const client = new KilnMcpClient(server, {
        sdkClient,
        makeTransport: () => ({ close: async () => undefined }),
        credentialResolver,
        environment,
        discoveryAttestation,
      });
      mocks.discover.mockImplementation(() => client.discover());
      return {
        discover: mocks.discover,
        discoverProviderCapabilities: mocks.discoverProviderCapabilities,
        callTool: mocks.callTool,
        disconnect: async () => {
          await client.disconnect();
          await mocks.disconnect();
        },
      };
    });
    mocks.credentialAccess.acquireAuthorizationContext.mockClear();
    mocks.recordDiscovery.mockClear();
    mocks.recordFailure.mockClear();
  });

  it("syncs every supported harness from canonical effective configuration by default", async () => {
    await mcpConfigCommand(APP_CONFIG, {});

    expect(mocks.load).toHaveBeenCalledWith(
      PROJECT_PATH,
      { projectStateBinding: PRIVATE_BINDING },
    );
    expect(mocks.sync).toHaveBeenCalledWith(
      { servers: {}, diagnostics: [] },
      PROJECT_PATH,
      { harnesses: ["codex", "claude", "opencode"], projectStateBinding: PRIVATE_BINDING },
    );
    expect(mocks.globalSync).toHaveBeenCalledWith({
      operation: "install",
      harnesses: ["codex", "claude", "opencode"],
      projectPath: process.cwd(),
    });
  });

  it.each([
    ["codex", "codex"],
    ["claude-code", "claude"],
    ["opencode", "opencode"],
  ] as const)("installs the control plane when %s is selected alone", async (client, harness) => {
    await mcpConfigCommand(APP_CONFIG, { client });
    expect(mocks.sync).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_PATH,
      { harnesses: [harness], projectStateBinding: PRIVATE_BINDING },
    );
    expect(mocks.globalSync).toHaveBeenCalledWith({ operation: "install", harnesses: [harness], projectPath: process.cwd() });
  });

  it("uninstalls only the selected governed MCP projection", async () => {
    await mcpConfigCommand(APP_CONFIG, { client: "codex", uninstall: true });

    expect(mocks.uninstall).toHaveBeenCalledWith(
      PROJECT_PATH,
      { harnesses: ["codex"], projectStateBinding: PRIVATE_BINDING },
    );
    expect(mocks.globalSync).toHaveBeenCalledWith({ operation: "uninstall", harnesses: ["codex"] });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("rejects the removed unmanaged server-definition flags", async () => {
    await expect(mcpConfigCommand(APP_CONFIG, { command: "bun", args: "run server" }))
      .rejects.toThrow(/define MCP servers in canonical global or project Kiln configuration/);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("safely discovers an admitted canonical server without executing a capability", async () => {
    mocks.load.mockReturnValueOnce({
      diagnostics: [],
      servers: {
        fixture: {
          id: "fixture", enabled: true, transport: "stdio", command: "node", admission: {
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
          capabilityBindings: { search: {
            capabilityId: "mcp.fixture.search",
            kind: "hosted-tool",
            ownerKind: "service",
            implementationKind: "provider-tool",
            contractRevision: "v1",
            permissions: ["network-access"],
            approval: "none",
            network: "restricted",
            data: { input: "public", output: "public", retention: "ephemeral" },
            supportedCallers: ["kiln-runtime"],
            limits: { maxInputBytes: 8_192, maxOutputBytes: 64_000, maxDurationMs: 10_000, maxArtifacts: 1 },
            requiresStructuredOutput: true,
          } },
          source: "project", provenance: {}, connection: { state: "not-tested" }, projection: { state: "not-synchronized" },
        },
      },
    });

    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await mcpConfigCommand(APP_CONFIG, { test: true, server: "fixture" });
    } finally {
      output.mockRestore();
    }

    expect(mocks.discover).toHaveBeenCalledTimes(1);
    expect(mocks.discoverProviderCapabilities).not.toHaveBeenCalled();
    expect(mocks.callTool).not.toHaveBeenCalled();
    expect(mocks.createClient).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fixture" }),
      expect.any(String),
      mocks.authorizationLease.credentialResolver,
      mocks.authorizationLease.environment,
      expect.objectContaining({
        authorizationDigest: mocks.authorizationLease.evidence.digest,
        authorizationRevision: mocks.authorizationLease.evidence.revision,
        bindingDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      }),
    );
    expect(mocks.credentialAccess.acquireAuthorizationContext).toHaveBeenCalledWith(expect.objectContaining({ id: "fixture" }));
    expect(mocks.recordDiscovery).toHaveBeenCalledTimes(1);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("reports safe Core catalog evidence while retaining the raw discovery snapshot", async () => {
    mocks.load.mockReturnValueOnce({
      diagnostics: [],
      servers: {
        fixture: {
          id: "fixture", enabled: true, transport: "stdio", command: "node", admission: { state: "admitted" },
          source: "project", provenance: {}, connection: { state: "not-tested" }, projection: { state: "not-synchronized" },
        },
      },
    });
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await mcpConfigCommand(APP_CONFIG, { test: true, server: "fixture" });
    const jsonLine = output.mock.calls
      .map(([value]) => value)
      .find((value): value is string => typeof value === "string" && value.startsWith("{"));
    output.mockRestore();
    expect(jsonLine).toBeDefined();
    expect(JSON.parse(jsonLine!)).toMatchObject({
      server: "fixture",
      tools: 1,
      eligibleTools: 0,
      rejectedTools: 1,
      catalogDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "binding_missing" })]),
      decisions: expect.arrayContaining([expect.objectContaining({ status: "ineligible" })]),
    });
    expect(mocks.recordDiscovery).toHaveBeenCalledWith(process.cwd(), expect.objectContaining({
      serverId: "fixture",
      tools: expect.arrayContaining([expect.objectContaining({ selector: "mcp:fixture:tool:search" })]),
    }));
  });

  it("records a discovery failure and disconnects when transport discovery fails", async () => {
    const failure = new Error("synthetic transport failure");
    mocks.discover.mockRejectedValueOnce(failure);
    mocks.load.mockReturnValueOnce({
      diagnostics: [],
      servers: {
        fixture: {
          id: "fixture", enabled: true, transport: "stdio", command: "node", admission: { state: "admitted" },
          source: "project", provenance: {}, connection: { state: "not-tested" }, projection: { state: "not-synchronized" },
        },
      },
    });

    await expect(mcpConfigCommand(APP_CONFIG, { test: true, server: "fixture" })).rejects.toBe(failure);
    expect(mocks.recordDiscovery).not.toHaveBeenCalled();
    expect(mocks.recordFailure).toHaveBeenCalledWith(process.cwd(), "fixture", failure);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });
});

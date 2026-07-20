import { describe, expect, it } from "vitest";
import {
  formatMcpCapabilitySelector,
  resolveMcpConfiguration,
  validateMcpConfigurationSource,
  type McpConfigurationSource,
} from "../../src/mcp/index.js";

const globalSource = (servers: McpConfigurationSource["servers"]): McpConfigurationSource => ({
  scope: "global",
  sourcePath: "C:\\Users\\operator\\.kiln\\config.yaml",
  servers,
});

const projectSource = (servers: McpConfigurationSource["servers"]): McpConfigurationSource => ({
  scope: "project",
  sourcePath: "C:\\workspace\\.kiln\\kiln.yaml",
  servers,
});

describe("canonical MCP configuration", () => {
  it("adds project-only servers and qualifies capability identity", () => {
    const result = resolveMcpConfiguration({
      project: projectSource({
        studio: {
          transport: "stdio",
          command: "cmd.exe",
          args: ["/c", "%LOCALAPPDATA%\\Roblox\\mcp.bat"],
          admission: { state: "admitted" },
        },
      }),
      environment: { LOCALAPPDATA: "C:\\Users\\operator\\AppData\\Local" },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.servers.studio).toMatchObject({
      id: "studio",
      enabled: true,
      transport: "stdio",
      source: "project",
      admission: { state: "admitted" },
      connection: { state: "not-tested" },
      projection: { state: "not-synchronized" },
    });
    expect(result.servers.studio?.args).toEqual([
      "/c",
      "C:\\Users\\operator\\AppData\\Local\\Roblox\\mcp.bat",
    ]);
    expect(formatMcpCapabilitySelector("studio", "tool", "inspect_tree"))
      .toBe("mcp:studio:tool:inspect_tree");
  });

  it("keeps same-named project servers isolated by project source and effective definition", () => {
    const projectA = resolveMcpConfiguration({
      project: { ...projectSource({ shared: { transport: "stdio", command: "fixture-a" } }), sourcePath: "C:\\a\\.kiln\\kiln.yaml" },
    });
    const projectB = resolveMcpConfiguration({
      project: { ...projectSource({ shared: { transport: "stdio", command: "fixture-b" } }), sourcePath: "C:\\b\\.kiln\\kiln.yaml" },
    });

    expect(projectA.servers.shared?.command).toBe("fixture-a");
    expect(projectB.servers.shared?.command).toBe("fixture-b");
    expect(projectA.servers.shared?.provenance.command?.sourcePath).toBe("C:\\a\\.kiln\\kiln.yaml");
    expect(projectB.servers.shared?.provenance.command?.sourcePath).toBe("C:\\b\\.kiln\\kiln.yaml");
  });

  it("inherits a global server and retains per-field provenance", () => {
    const result = resolveMcpConfiguration({
      global: globalSource({
        docs: {
          transport: "streamable-http",
          url: "https://mcp.example.com/mcp",
          requestTimeoutMs: 30_000,
          admission: { state: "admitted", tools: { allow: ["search"] } },
        },
      }),
      project: projectSource({}),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.servers.docs).toMatchObject({
      source: "global",
      transport: "streamable-http",
      requestTimeoutMs: 30_000,
    });
    expect(result.servers.docs?.provenance.transport).toMatchObject({ scope: "global" });
    expect(result.servers.docs?.provenance.url).toMatchObject({ scope: "global" });
  });

  it("lets a project narrow admission and override permitted common fields", () => {
    const result = resolveMcpConfiguration({
      global: globalSource({
        docs: {
          transport: "streamable-http",
          url: "https://mcp.example.com/mcp",
          requestTimeoutMs: 30_000,
          admission: { state: "admitted", tools: { allow: ["search", "write"] } },
        },
      }),
      project: projectSource({
        docs: {
          requestTimeoutMs: 10_000,
          admission: { state: "admitted", tools: { allow: ["search"] } },
        },
      }),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.servers.docs).toMatchObject({
      source: "overridden",
      requestTimeoutMs: 10_000,
      admission: { state: "admitted", tools: { allow: ["search"] } },
    });
    expect(result.servers.docs?.provenance.url).toMatchObject({ scope: "global" });
    expect(result.servers.docs?.provenance.requestTimeoutMs).toMatchObject({ scope: "project" });
    expect(result.servers.docs?.provenance.admission).toMatchObject({ scope: "project" });
  });

  it("disables a global server per project without requiring transport fields", () => {
    const result = resolveMcpConfiguration({
      global: globalSource({
        studio: { transport: "stdio", command: "studio-mcp", args: [] },
      }),
      project: projectSource({ studio: { enabled: false } }),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.servers.studio).toMatchObject({
      enabled: false,
      source: "disabled-by-project",
      connection: { state: "disabled" },
      projection: { state: "not-synchronized" },
    });
    expect(result.servers.studio?.provenance.enabled).toMatchObject({ scope: "project" });
  });

  it("rejects an incomplete transport replacement instead of mixing transports", () => {
    const result = resolveMcpConfiguration({
      global: globalSource({
        docs: { transport: "streamable-http", url: "https://mcp.example.com/mcp" },
      }),
      project: projectSource({
        docs: { transport: "stdio", args: ["server.js"] },
      }),
    });

    expect(result.servers.docs).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "MCP_INCOMPLETE_TRANSPORT_REPLACEMENT",
      serverId: "docs",
      scope: "project",
    }));
  });

  it("reports missing environment and credential references without revealing values", () => {
    const result = resolveMcpConfiguration({
      project: projectSource({
        secure: {
          transport: "streamable-http",
          url: "https://secure.example.com/mcp",
          headers: {
            Authorization: { fromEnv: "SECURE_MCP_TOKEN" },
            "X-Workspace": { fromCredential: "workspace-id" },
          },
        },
      }),
      environment: {},
      credentialExists: () => false,
    });

    expect(result.servers.secure).toBeUndefined();
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MCP_SECRET_REFERENCE_MISSING", reference: "env:SECURE_MCP_TOKEN" }),
      expect.objectContaining({ code: "MCP_SECRET_REFERENCE_MISSING", reference: "credential:workspace-id" }),
    ]));
    expect(JSON.stringify(result)).not.toContain("Bearer ");
  });

  it("rejects malformed identities, mixed transport fields, literal sensitive headers, and invalid timeouts", () => {
    const validation = validateMcpConfigurationSource(projectSource({
      "bad server": {
        transport: "stdio",
        command: "node",
        env: { API_TOKEN: { value: "secret" } },
        url: "https://mixed.example.com/mcp",
        requestTimeoutMs: 0,
        maxCapabilities: 0,
        headers: { Authorization: { value: "Bearer secret" } },
      },
    }));

    expect(validation).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MCP_SERVER_ID_INVALID" }),
      expect.objectContaining({ code: "MCP_TRANSPORT_FIELDS_MIXED" }),
      expect.objectContaining({ code: "MCP_TIMEOUT_INVALID" }),
      expect.objectContaining({ code: "MCP_CATALOG_LIMIT_INVALID" }),
      expect.objectContaining({ code: "MCP_LITERAL_SECRET_FORBIDDEN" }),
      expect.objectContaining({ code: "MCP_LITERAL_SECRET_FORBIDDEN", field: "env.API_TOKEN" }),
    ]));
  });

  it("rejects a project admission override that widens a global allowlist", () => {
    const result = resolveMcpConfiguration({
      global: globalSource({
        docs: {
          transport: "streamable-http",
          url: "https://mcp.example.com/mcp",
          admission: { state: "admitted", tools: { allow: ["search"] } },
        },
      }),
      project: projectSource({
        docs: {
          admission: { state: "admitted", tools: { allow: ["search", "write"] } },
        },
      }),
    });

    expect(result.servers.docs).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "MCP_PROJECT_POLICY_WIDENING",
      serverId: "docs",
    }));
  });

  it("allows projects to narrow but not raise a global capability catalog limit", () => {
    const base = globalSource({
      docs: { transport: "streamable-http", url: "https://mcp.example.com/mcp", maxCapabilities: 32 },
    });
    expect(resolveMcpConfiguration({
      global: base,
      project: projectSource({ docs: { maxCapabilities: 16 } }),
    }).servers.docs?.maxCapabilities).toBe(16);

    const widened = resolveMcpConfiguration({
      global: base,
      project: projectSource({ docs: { maxCapabilities: 64 } }),
    });
    expect(widened.servers.docs).toBeUndefined();
    expect(widened.diagnostics).toContainEqual(expect.objectContaining({ code: "MCP_PROJECT_POLICY_WIDENING" }));
  });

  it("rejects malformed effect policy and project replacement of a global declaration", () => {
    const effect = {
      operation: "observe" as const,
      boundaries: ["external-system" as const],
      reversibility: "reversible" as const,
      dataEgress: "none" as const,
      identityUse: "none" as const,
      consequences: [] as const,
      idempotency: "idempotent" as const,
    };
    const result = resolveMcpConfiguration({
      global: globalSource({
        docs: {
          transport: "streamable-http",
          url: "https://mcp.example.com/mcp",
          admission: { state: "admitted", effects: { search: effect } },
        },
      }),
      project: projectSource({
        docs: {
          admission: {
            state: "admitted",
            effects: { search: { ...effect, operation: "mutate" } },
          },
        },
      }),
    });

    expect(result.servers.docs).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "MCP_PROJECT_POLICY_WIDENING" }));
  });
});

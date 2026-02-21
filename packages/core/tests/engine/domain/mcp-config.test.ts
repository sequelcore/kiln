import { describe, it, expect } from "vitest";
import { validateMcpConfig, type McpConfig } from "../../../src/engine/domain/mcp-config.js";

describe("validateMcpConfig", () => {
  it("returns empty array for valid SSE config", () => {
    const config: McpConfig = {
      servers: [
        { name: "mcp-server", transport: "sse", url: "https://example.com/mcp" },
      ],
    };
    expect(validateMcpConfig(config)).toEqual([]);
  });

  it("returns empty array for valid stdio config", () => {
    const config: McpConfig = {
      servers: [
        { name: "local-mcp", transport: "stdio", command: "node", args: ["server.js"] },
      ],
    };
    expect(validateMcpConfig(config)).toEqual([]);
  });

  it("errors on empty servers array", () => {
    const config: McpConfig = { servers: [] };
    const errors = validateMcpConfig(config);
    expect(errors).toContainEqual({ field: "servers", message: "must be a non-empty array" });
  });

  it("errors on duplicate server names", () => {
    const config: McpConfig = {
      servers: [
        { name: "mcp-server", transport: "sse", url: "https://example.com/mcp" },
        { name: "mcp-server", transport: "stdio", command: "node" },
      ],
    };
    const errors = validateMcpConfig(config);
    expect(errors).toContainEqual({ field: "servers[1].name", message: "duplicate server name" });
  });

  it("errors on missing URL for SSE transport", () => {
    const config: McpConfig = {
      servers: [
        { name: "mcp-server", transport: "sse" },
      ],
    };
    const errors = validateMcpConfig(config);
    expect(errors).toContainEqual({ field: "servers[0].url", message: "required when transport is 'sse'" });
  });

  it("errors on missing command for stdio transport", () => {
    const config: McpConfig = {
      servers: [
        { name: "local-mcp", transport: "stdio" },
      ],
    };
    const errors = validateMcpConfig(config);
    expect(errors).toContainEqual({ field: "servers[0].command", message: "required when transport is 'stdio'" });
  });

  it("errors on invalid transport value", () => {
    const config = {
      servers: [
        { name: "mcp-server", transport: "invalid" },
      ],
    } as unknown as McpConfig;
    const errors = validateMcpConfig(config);
    expect(errors).toContainEqual({ field: "servers[0].transport", message: "must be 'sse' or 'stdio'" });
  });

  it("errors on missing server name", () => {
    const config: McpConfig = {
      servers: [
        { name: "", transport: "sse", url: "https://example.com/mcp" },
      ],
    };
    const errors = validateMcpConfig(config);
    expect(errors).toContainEqual({ field: "servers[0].name", message: "must be a non-empty string" });
  });
});

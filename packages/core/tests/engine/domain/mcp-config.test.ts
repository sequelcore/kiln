import { describe, it, expect } from "vitest";
import { validateMcpConfig, type McpConfig } from "../../../src/engine/domain/mcp-config.js";

describe("validateMcpConfig", () => {
  it("returns empty array for valid config", () => {
    const config: McpConfig = {
      servers: [
        { name: "mcp-server", url: "https://example.com/mcp" },
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
        { name: "mcp-server", url: "https://example.com/mcp" },
        { name: "mcp-server", url: "https://example.com/mcp2" },
      ],
    };
    const errors = validateMcpConfig(config);
    expect(errors).toContainEqual({ field: "servers[1].name", message: "duplicate server name" });
  });

  it("errors on missing URL", () => {
    const config = {
      servers: [
        { name: "mcp-server" },
      ],
    } as unknown as McpConfig;
    const errors = validateMcpConfig(config);
    expect(errors).toContainEqual({ field: "servers[0].url", message: "must be a non-empty string" });
  });

  it("errors on missing server name", () => {
    const config: McpConfig = {
      servers: [
        { name: "", url: "https://example.com/mcp" },
      ],
    };
    const errors = validateMcpConfig(config);
    expect(errors).toContainEqual({ field: "servers[0].name", message: "must be a non-empty string" });
  });
});

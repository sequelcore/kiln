import { describe, it, expect } from "vitest";
import { validateMcpConfig, type McpConfig } from "../../../src/engine/domain/mcp-config.js";

describe("validateMcpConfig", () => {
  it("returns empty array for valid config", () => {
    const config: McpConfig = {
      servers: ["mcp-server"],
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
        "mcp-server",
        "mcp-server",
      ],
    };
    const errors = validateMcpConfig(config);
    expect(errors).toContainEqual({ field: "servers[1]", message: "duplicate canonical server id" });
  });

  it("errors on malformed canonical server ids", () => {
    const config = {
      servers: [
        "bad server",
      ],
    } as unknown as McpConfig;
    const errors = validateMcpConfig(config);
    expect(errors).toContainEqual({ field: "servers[0]", message: "must be a canonical MCP server id" });
  });
});

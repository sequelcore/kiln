import { describe, it, expect } from "vitest";
import { generateConfig } from "../../src/mcp/config-generator.js";

describe("generateConfig", () => {
  it("claude-code + stdio produces valid JSON with mcpServers", () => {
    const result = generateConfig({ client: "claude-code", transport: "stdio", mcpServerName: "kiln", appName: "kiln" });
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers["kiln"]).toBeDefined();
    expect(parsed.mcpServers["kiln"].command).toBe("kiln-mcp");
  });

  it("cursor + stdio produces valid JSON", () => {
    const result = generateConfig({ client: "cursor", transport: "stdio", mcpServerName: "kiln", appName: "kiln" });
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers["kiln"]).toBeDefined();
    expect(parsed.mcpServers["kiln"].command).toBe("kiln-mcp");
  });

  it("generic + sse includes url and port", () => {
    const result = generateConfig({ client: "generic", transport: "sse", port: 4000, mcpServerName: "kiln", appName: "kiln" });
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers["kiln"].url).toContain("4000");
    expect(parsed.mcpServers["kiln"].transportType).toBe("sse");
  });

  it("includes server name as provided mcpServerName", () => {
    const result = generateConfig({ client: "claude-code", transport: "stdio", mcpServerName: "kiln", appName: "kiln" });
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers).toHaveProperty("kiln");
  });

  it("uses appName to generate command binary name", () => {
    const result = generateConfig({ client: "claude-code", transport: "stdio", mcpServerName: "myapp", appName: "myapp" });
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers["myapp"].command).toBe("myapp-mcp");
  });

  it("uses custom mcpServerName as key", () => {
    const result = generateConfig({ client: "cursor", transport: "stdio", mcpServerName: "temper", appName: "temper" });
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers).toHaveProperty("temper");
    expect(parsed.mcpServers["temper"].command).toBe("temper-mcp");
  });
});

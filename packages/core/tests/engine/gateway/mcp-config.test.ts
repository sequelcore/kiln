import { describe, it, expect } from "vitest";
import { validateGatewayMcpConfig } from "../../../src/engine/gateway/mcp-config.js";
import type { GatewayMcpConfig } from "../../../src/engine/gateway/mcp-config.js";

describe("validateGatewayMcpConfig", () => {
  it("accepts valid config with enabled: true and no auth", () => {
    const config: GatewayMcpConfig = { enabled: true };
    expect(validateGatewayMcpConfig(config)).toHaveLength(0);
  });

  it("accepts valid config with enabled: false", () => {
    const config: GatewayMcpConfig = { enabled: false };
    expect(validateGatewayMcpConfig(config)).toHaveLength(0);
  });

  it("accepts valid config with path override", () => {
    const config: GatewayMcpConfig = { enabled: true, path: "/mcp/v1" };
    expect(validateGatewayMcpConfig(config)).toHaveLength(0);
  });

  it("accepts valid config with auth type api-key and keyEnv", () => {
    const config: GatewayMcpConfig = {
      enabled: true,
      auth: { type: "api-key", keyEnv: "MCP_API_KEY" },
    };
    expect(validateGatewayMcpConfig(config)).toHaveLength(0);
  });

  it("accepts valid config with auth type none", () => {
    const config: GatewayMcpConfig = {
      enabled: true,
      auth: { type: "none" },
    };
    expect(validateGatewayMcpConfig(config)).toHaveLength(0);
  });

  it("rejects enabled not boolean", () => {
    const config = { enabled: "yes" } as unknown as GatewayMcpConfig;
    const errors = validateGatewayMcpConfig(config);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("mcp.enabled");
  });

  it("rejects path not starting with /", () => {
    const config: GatewayMcpConfig = { enabled: true, path: "mcp" };
    const errors = validateGatewayMcpConfig(config);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("mcp.path");
  });

  it("rejects auth type api-key without keyEnv", () => {
    const config: GatewayMcpConfig = {
      enabled: true,
      auth: { type: "api-key" },
    };
    const errors = validateGatewayMcpConfig(config);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("mcp.auth.keyEnv");
  });

  it("rejects unknown auth type", () => {
    const config = {
      enabled: true,
      auth: { type: "bearer" },
    } as unknown as GatewayMcpConfig;
    const errors = validateGatewayMcpConfig(config);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("mcp.auth.type");
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GATEWAY_CONFIG_FIELD_DESCRIPTORS,
  GATEWAY_CONFIG_SCHEMA,
  serializeGatewayConfigDescriptors,
  serializeGatewayConfigEditorSchema,
} from "../../../src/engine/gateway/gateway-config-schema.js";
import { GatewayLoaderError, parseGatewayYaml } from "../../../src/engine/gateway/gateway-loader.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const repositoryRoot = join(packageRoot, "..", "..");

const BASE = `
apps:
  - name: app
    config: app.yaml
    channels:
      - type: web
`;

describe("gateway configuration schema", () => {
  it("owns a strict restart-required gateway document contract", () => {
    expect(GATEWAY_CONFIG_SCHEMA.$id).toBe("https://kiln.dev/schemas/gateway-config-v1.json");
    expect(GATEWAY_CONFIG_SCHEMA.additionalProperties).toBe(false);
    expect(GATEWAY_CONFIG_SCHEMA.properties.apps.items.additionalProperties).toBe(false);
    expect(GATEWAY_CONFIG_SCHEMA.properties.apps.items.properties.channels.items.additionalProperties).toBe(false);
    expect("botToken" in GATEWAY_CONFIG_SCHEMA.properties.apps.items.properties.channels.items.properties).toBe(false);
    expect(GATEWAY_CONFIG_FIELD_DESCRIPTORS).toContainEqual(expect.objectContaining({
      identity: "/apps/*/channels/*/accessTokenEnv",
      structuralOwner: "gateway-configuration",
      semanticOwner: "app-gateway-channel-binding",
      scope: "gateway",
      sensitivity: "secret-reference",
      authorityImpact: "authority-bearing",
      activation: "restart-required",
      schemaRevision: 1,
    }));
    expect(GATEWAY_CONFIG_FIELD_DESCRIPTORS).toContainEqual(expect.objectContaining({
      identity: "/port",
      sensitivity: "public",
      authorityImpact: "authority-bearing",
      defaultPosture: "required",
    }));
    expect(GATEWAY_CONFIG_FIELD_DESCRIPTORS).toContainEqual(expect.objectContaining({
      identity: "/observability/serviceName",
      sensitivity: "public",
      authorityImpact: "none",
      defaultPosture: "required",
    }));
    expect(GATEWAY_CONFIG_FIELD_DESCRIPTORS).toContainEqual(expect.objectContaining({
      identity: "/observability",
      defaultPosture: "omitted",
    }));
    expect(GATEWAY_CONFIG_FIELD_DESCRIPTORS).toContainEqual(expect.objectContaining({
      identity: "/modelGateway/replay/hmacKeyEnv",
      sensitivity: "secret-reference",
    }));
    expect(GATEWAY_CONFIG_FIELD_DESCRIPTORS).toContainEqual(expect.objectContaining({
      identity: "/modelGateway/replay/ttlMs",
      sensitivity: "public",
    }));
  });

  it.each([
    ["root", `unexpected: true\n${BASE}`, "unexpected"],
    ["app binding", BASE.replace("    channels:", "    unexpected: true\n    channels:"), "apps[0].unexpected"],
    ["channel binding", BASE.replace("      - type: web", "      - type: web\n        unexpected: true"), "apps[0].channels[0].unexpected"],
    ["observability", `${BASE}observability:\n  serviceName: app\n  unexpected: true\n`, "observability.unexpected"],
    ["auth", `${BASE}auth:\n  algorithm: HS256\n  secretEnv: JWT_SECRET\n  unexpected: true\n`, "auth.unexpected"],
    ["MCP auth", `${BASE}mcp:\n  enabled: true\n  auth:\n    type: none\n    unexpected: true\n`, "mcp.auth.unexpected"],
  ])("rejects unknown nested fields in %s", (_name, yaml, field) => {
    expectGatewayError(yaml, field);
  });

  it("rejects YAML non-finite numbers instead of mapping them into an asserted config", () => {
    expectGatewayError(`port: .nan\n${BASE}`, "port");
  });

  it("rejects the retired raw botToken field and identifies the running schema", () => {
    const yaml = BASE.replace("      - type: web", "      - type: slack\n        botToken: raw-secret");
    try {
      parseGatewayYaml(yaml, "fixtures/gateway.yaml");
      expect.fail("should reject raw gateway credentials");
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayLoaderError);
      expect((error as GatewayLoaderError).errors).toContainEqual(expect.objectContaining({
        field: "apps[0].channels[0].botToken",
      }));
      expect((error as Error).message).toContain("fixtures/gateway.yaml");
      expect((error as Error).message).toContain("gateway-config-v1");
    }
  });

  it("keeps committed editor-schema and descriptor projections current", () => {
    expect(readFileSync(join(packageRoot, "schemas", "gateway-config-v1.json"), "utf8"))
      .toBe(serializeGatewayConfigEditorSchema());
    expect(readFileSync(join(packageRoot, "schemas", "gateway-config-descriptors-v1.json"), "utf8"))
      .toBe(serializeGatewayConfigDescriptors());
  });

  it.each([
    "booking-assistant",
    "hello-agent",
    "incident-triage",
    "multi-app-gateway",
    "research-brief",
    "support-agent",
    "whatsapp-bot",
  ])("admits the public gateway example at %s", (example) => {
    const path = join(repositoryRoot, "docs", "examples", example, "gateway.yaml");
    expect(parseGatewayYaml(readFileSync(path, "utf8"), path)).toBeDefined();
  });
});

function expectGatewayError(yaml: string, field: string): void {
  try {
    parseGatewayYaml(yaml, "fixtures/gateway.yaml");
    expect.fail(`should reject ${field}`);
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayLoaderError);
    expect((error as GatewayLoaderError).errors).toContainEqual(expect.objectContaining({ field }));
  }
}

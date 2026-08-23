import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_CONFIG_FIELD_DESCRIPTORS,
  APP_CONFIG_SCHEMA,
  serializeAppConfigDescriptors,
  serializeAppConfigEditorSchema,
} from "../../../src/engine/loader/app-config-schema.js";
import { AppLoaderError, parseAppYaml } from "../../../src/engine/loader/app-loader.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const repositoryRoot = join(packageRoot, "..", "..");

const BASE = `
name: app
router:
  fallback: assistant
teams:
  assistant:
    agents:
      worker:
        name: Worker
        role: Assistant
        goal: Help the user
        tier: fast
        tools: []
    capabilities: []
`;

describe("app configuration schema", () => {
  it("owns a strict restart-required app document contract", () => {
    expect(APP_CONFIG_SCHEMA.$id).toBe("https://kiln.dev/schemas/app-config-v1.json");
    expect(APP_CONFIG_SCHEMA.additionalProperties).toBe(false);
    const teamSchema = APP_CONFIG_SCHEMA.properties.teams.patternProperties["^(.*)$"]!;
    const agentSchema = teamSchema.properties.agents.patternProperties["^(.*)$"]!;
    expect(teamSchema.additionalProperties).toBe(false);
    expect(agentSchema.additionalProperties).toBe(false);
    expect("quality" in teamSchema.properties).toBe(false);
    expect(APP_CONFIG_FIELD_DESCRIPTORS).toContainEqual(expect.objectContaining({
      identity: "/provider/apiKeyEnv",
      structuralOwner: "app-configuration",
      semanticOwner: "provider-adapter-runtime",
      scope: "app",
      sensitivity: "secret-reference",
      authorityImpact: "authority-bearing",
      activation: "restart-required",
      schemaRevision: 1,
    }));
  });

  it.each([
    ["root", `${BASE}\nunexpected: true\n`, "unexpected"],
    ["team", BASE.replace("    agents:", "    unexpected: true\n    agents:"), "teams.assistant.unexpected"],
    ["agent", BASE.replace("        name: Worker", "        name: Worker\n        unexpected: true"), "teams.assistant.agents.worker.unexpected"],
    ["runtime provider", `${BASE}\nruntime: provider-adapter\nprovider:\n  name: anthropic\n  unexpected: true\n`, "provider.unexpected"],
  ])("rejects unknown fields at the %s boundary", (_name, yaml, field) => {
    expectAppError(yaml, field);
  });

  it("rejects the retired quality alias with source and running-schema identity", () => {
    const yaml = BASE.replace("    capabilities: []", "    capabilities: []\n    quality: []");
    try {
      parseAppYaml(yaml, "fixtures/app.yaml");
      expect.fail("should reject the retired alias");
    } catch (error) {
      expect(error).toBeInstanceOf(AppLoaderError);
      expect((error as AppLoaderError).errors).toContainEqual(expect.objectContaining({
        field: "teams.assistant.quality",
      }));
      expect((error as Error).message).toContain("fixtures/app.yaml");
      expect((error as Error).message).toContain("app-config-v1");
    }
  });

  it.each([
    ["structured", "        structured: true", "teams.assistant.agents.worker.structured"],
    ["sandbox", "        sandbox: true", "teams.assistant.agents.worker.sandbox"],
    ["modalities", "        modalities: [text]", "teams.assistant.agents.worker.modalities"],
  ])("rejects the retired agent %s field", (_name, fieldYaml, field) => {
    expectAppError(BASE.replace("        tools: []", `        tools: []\n${fieldYaml}`), field);
  });

  it("rejects the retired router classifier field", () => {
    const yaml = BASE.replace("  fallback: assistant", `  fallback: assistant
  classifier:
    name: Classifier
    role: Intent Classifier
    goal: Route requests
    tier: fast
    tools: []`);
    expectAppError(yaml, "router.classifier");
  });

  it.each([
    ["channels", BASE.replace("name: app", "name: app\nchannels: [api]"), "channels"],
    ["memory", BASE.replace("router:", "memory: { scopes: [user], backend: sqlite+fts5 }\nrouter:"), "memory"],
    ["router rules", BASE.replace("  fallback: assistant", "  rules: []\n  fallback: assistant"), "router.rules"],
    ["evaluation", BASE.replace("router:", "eval: { datasets: [], scorers: [], experiments: [] }\nrouter:"), "eval"],
    ["tool selection", BASE.replace("router:", "toolSelection: { strategy: all }\nrouter:"), "toolSelection"],
  ])("rejects the retired App %s field", (_name, yaml, field) => {
    expectAppError(yaml, field);
  });

  it.each([
    ["agent count", BASE.replace("        tools: []", "        tools: []\n        count: 2"), "teams.assistant.agents.worker.count"],
    ["team workflow", BASE.replace("    capabilities: []", "    workflow: { phases: [respond], gates: {} }\n    capabilities: []"), "teams.assistant.workflow"],
    ["team quality gates", BASE.replace("    capabilities: []", "    capabilities: []\n    qualityGates: []"), "teams.assistant.qualityGates"],
  ])("rejects the retired preset-bridge %s field", (_name, yaml, field) => {
    expectAppError(yaml, field);
  });

  it("maps provider runtime configuration from the same admitted document", () => {
    const app = parseAppYaml(`${BASE}
runtime: provider-adapter
provider:
  name: anthropic
  model: claude-haiku-4-5-20251001
  apiKeyEnv: ANTHROPIC_API_KEY
billing:
  budgetEndpoint: https://example.test/budget
  overBudgetMessage: Budget exhausted.
  headers:
    Authorization: $BUDGET_API_TOKEN
  tiers:
    free:
      agents: [fast]
`);
    expect(app.runtimeModeConfig).toEqual({
      runtime: "provider-adapter",
      provider: {
        name: "anthropic",
        model: "claude-haiku-4-5-20251001",
        apiKeyEnv: "ANTHROPIC_API_KEY",
      },
      billing: {
        budgetEndpoint: "https://example.test/budget",
        overBudgetMessage: "Budget exhausted.",
        headers: { Authorization: process.env.BUDGET_API_TOKEN ?? "" },
        tiers: { free: { agents: ["fast"] } },
      },
    });
  });

  it("keeps committed editor-schema and descriptor projections current", () => {
    expect(readFileSync(join(packageRoot, "schemas", "app-config-v1.json"), "utf8"))
      .toBe(serializeAppConfigEditorSchema());
    expect(readFileSync(join(packageRoot, "schemas", "app-config-descriptors-v1.json"), "utf8"))
      .toBe(serializeAppConfigDescriptors());
  });

  it.each([
    "booking-assistant/app.yaml",
    "hello-agent/app.yaml",
    "incident-triage/app.yaml",
    "multi-app-gateway/apps/booking/app.yaml",
    "multi-app-gateway/apps/support/app.yaml",
    "research-brief/app.yaml",
    "support-agent/app.yaml",
    "whatsapp-bot/apps/my-shop/app.yaml",
  ])("admits the public app example at %s", (relativePath) => {
    const path = join(repositoryRoot, "docs", "examples", relativePath);
    expect(parseAppYaml(readFileSync(path, "utf8"), path)).toBeDefined();
  });
});

function expectAppError(yaml: string, field: string): void {
  try {
    parseAppYaml(yaml, "fixtures/app.yaml");
    expect.fail(`should reject ${field}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AppLoaderError);
    expect((error as AppLoaderError).errors).toContainEqual(expect.objectContaining({ field }));
  }
}

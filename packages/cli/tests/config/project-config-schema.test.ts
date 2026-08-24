import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { CommunicationIntent } from "@kilnai/core/agents";
import {
  PROJECT_CONFIG_FIELD_DESCRIPTORS,
  PROJECT_CONFIG_SCHEMA,
  serializeProjectConfigDescriptors,
  serializeProjectConfigEditorSchema,
} from "../../src/config/project-config-schema.js";
import type {
  KilnContextGovernanceConfig,
  KilnWorkGovernanceConfig,
  KilnYamlMcp,
  KilnYamlPermissions,
  KilnYamlSkillsConfig,
  KilnYamlWebConfig,
} from "../../src/kiln-yaml-types.js";
import type { KilnProjectConfig } from "../../src/config/project-config-schema.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("project configuration schema", () => {
  it("is the strict runtime and editor contract for the project family", () => {
    expect(PROJECT_CONFIG_SCHEMA.$id).toBe("https://kiln.dev/schemas/project-config-v1.json");
    expect(PROJECT_CONFIG_SCHEMA.additionalProperties).toBe(false);
    expect(PROJECT_CONFIG_SCHEMA.properties.version).toMatchObject({ const: "1" });
    expect("provider" in PROJECT_CONFIG_SCHEMA.properties).toBe(false);
  });

  it("derives path-addressed field descriptors from schema metadata", () => {
    expect(PROJECT_CONFIG_FIELD_DESCRIPTORS).toContainEqual(expect.objectContaining({
      identity: "/permissions/sandbox",
      structuralOwner: "project-configuration",
      semanticOwner: "model-facing-execution-authority",
      scope: "project",
      sensitivity: "public",
      authorityImpact: "authority-bearing",
      projectAdmission: "attenuation-only",
      comparator: "global-permission-narrowing",
      activation: "next-session",
      schemaRevision: 1,
    }));
  });

  it("gives every descriptor an explicit project admission and names every attenuation comparator", () => {
    expect(PROJECT_CONFIG_FIELD_DESCRIPTORS.length).toBeGreaterThan(0);
    for (const descriptor of PROJECT_CONFIG_FIELD_DESCRIPTORS) {
      expect(["project-owned", "attenuation-only", "forbidden"]).toContain(descriptor.projectAdmission);
      if (descriptor.projectAdmission === "attenuation-only") {
        expect(descriptor.comparator, descriptor.identity).toEqual(expect.any(String));
      } else {
        expect(descriptor.comparator, descriptor.identity).toBeUndefined();
      }
    }
  });

  it("does not expose project-only execution owners in the project schema", () => {
    expect(PROJECT_CONFIG_SCHEMA.properties).not.toHaveProperty("teamMode");
    expect(PROJECT_CONFIG_SCHEMA.properties).not.toHaveProperty("requireApproval");
    expect(PROJECT_CONFIG_SCHEMA.properties).not.toHaveProperty("qualityGates");
    expect(PROJECT_CONFIG_SCHEMA.properties).not.toHaveProperty("interactiveUse");

    const mcpServer = PROJECT_CONFIG_SCHEMA.properties.mcp?.properties?.servers?.patternProperties?.["^(.*)$"];
    expect(mcpServer?.properties).not.toHaveProperty("command");
    expect(mcpServer?.properties).not.toHaveProperty("url");
    expect(mcpServer?.properties).not.toHaveProperty("env");
    expect(mcpServer?.properties).not.toHaveProperty("headers");
    expect(mcpServer?.properties?.admission?.properties).not.toHaveProperty("effects");
    expect(PROJECT_CONFIG_SCHEMA.properties.contextGovernance?.properties?.adaptation?.properties)
      .not.toHaveProperty("candidateRecordHash");
    expect(PROJECT_CONFIG_SCHEMA.properties.contextGovernance?.properties?.adaptation?.properties)
      .not.toHaveProperty("evaluationEvidenceHash");
  });

  it("keeps inferred project fields aligned with their existing semantic contracts", () => {
    expectTypeOf<KilnProjectConfig["workGovernance"]>().toMatchTypeOf<KilnWorkGovernanceConfig | undefined>();
    expectTypeOf<KilnProjectConfig["mcp"]>().toMatchTypeOf<KilnYamlMcp | undefined>();
    expectTypeOf<KilnProjectConfig["permissions"]>().toMatchTypeOf<KilnYamlPermissions | undefined>();
    expectTypeOf<KilnProjectConfig["communication"]>().toMatchTypeOf<CommunicationIntent | undefined>();
    expectTypeOf<KilnProjectConfig["web"]>().toMatchTypeOf<KilnYamlWebConfig | undefined>();
    expectTypeOf<KilnProjectConfig["skills"]>().toMatchTypeOf<KilnYamlSkillsConfig | undefined>();
    expectTypeOf<KilnProjectConfig["contextGovernance"]>().toMatchTypeOf<KilnContextGovernanceConfig | undefined>();
  });

  it("keeps committed editor-schema and descriptor projections current", () => {
    expect(readFileSync(join(packageRoot, "schemas", "project-config-v1.json"), "utf8"))
      .toBe(serializeProjectConfigEditorSchema());
    expect(readFileSync(join(packageRoot, "schemas", "project-config-descriptors-v1.json"), "utf8"))
      .toBe(serializeProjectConfigDescriptors());
  });

});

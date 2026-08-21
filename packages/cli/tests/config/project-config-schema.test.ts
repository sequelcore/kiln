import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { CommunicationIntent } from "@kilnai/core";
import {
  PROJECT_CONFIG_FIELD_DESCRIPTORS,
  PROJECT_CONFIG_SCHEMA,
  serializeProjectConfigDescriptors,
  serializeProjectConfigEditorSchema,
} from "../../src/config/project-config-schema.js";
import { readKilnYaml } from "../../src/kiln-yaml.js";
import type {
  KilnContextGovernanceConfig,
  KilnWorkGovernanceConfig,
  KilnYamlInteractiveUseConfig,
  KilnYamlMcp,
  KilnYamlPermissions,
  KilnYamlSkillsConfig,
  KilnYamlWebConfig,
} from "../../src/kiln-yaml-types.js";
import type { KilnProjectConfig } from "../../src/config/project-config-schema.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repositoryRoot = join(packageRoot, "..", "..");

describe("project configuration schema", () => {
  it("is the strict runtime and editor contract for the project family", () => {
    expect(PROJECT_CONFIG_SCHEMA.$id).toBe("https://kiln.dev/schemas/project-config-v1.json");
    expect(PROJECT_CONFIG_SCHEMA.additionalProperties).toBe(false);
    expect(PROJECT_CONFIG_SCHEMA.properties.version).toMatchObject({ const: "1" });
    expect("provider" in PROJECT_CONFIG_SCHEMA.properties).toBe(false);
  });

  it("derives path-addressed field descriptors from schema metadata", () => {
    expect(PROJECT_CONFIG_FIELD_DESCRIPTORS).toContainEqual(expect.objectContaining({
      identity: "/permissions/tools/*/action",
      structuralOwner: "project-configuration",
      semanticOwner: "model-facing-execution-authority",
      scope: "project",
      sensitivity: "public",
      authorityImpact: "authority-bearing",
      activation: "next-session",
      schemaRevision: 1,
    }));
  });

  it("keeps inferred project fields aligned with their existing semantic contracts", () => {
    expectTypeOf<KilnProjectConfig["workGovernance"]>().toMatchTypeOf<KilnWorkGovernanceConfig | undefined>();
    expectTypeOf<KilnProjectConfig["mcp"]>().toMatchTypeOf<KilnYamlMcp | undefined>();
    expectTypeOf<KilnProjectConfig["permissions"]>().toMatchTypeOf<KilnYamlPermissions | undefined>();
    expectTypeOf<KilnProjectConfig["communication"]>().toMatchTypeOf<CommunicationIntent | undefined>();
    expectTypeOf<KilnProjectConfig["web"]>().toMatchTypeOf<KilnYamlWebConfig | undefined>();
    expectTypeOf<KilnProjectConfig["interactiveUse"]>().toMatchTypeOf<KilnYamlInteractiveUseConfig | undefined>();
    expectTypeOf<KilnProjectConfig["skills"]>().toMatchTypeOf<KilnYamlSkillsConfig | undefined>();
    expectTypeOf<KilnProjectConfig["contextGovernance"]>().toMatchTypeOf<KilnContextGovernanceConfig | undefined>();
  });

  it("keeps committed editor-schema and descriptor projections current", () => {
    expect(readFileSync(join(packageRoot, "schemas", "project-config-v1.json"), "utf8"))
      .toBe(serializeProjectConfigEditorSchema());
    expect(readFileSync(join(packageRoot, "schemas", "project-config-descriptors-v1.json"), "utf8"))
      .toBe(serializeProjectConfigDescriptors());
  });

  it.each([
    join(repositoryRoot, ".kiln"),
    join(repositoryRoot, "docs", "examples", "booking-assistant", ".kiln"),
    join(repositoryRoot, "docs", "examples", "incident-triage", ".kiln"),
    join(repositoryRoot, "docs", "examples", "research-brief", ".kiln"),
    join(repositoryRoot, "docs", "examples", "support-agent", ".kiln"),
  ])("admits the public project fixture at %s", (kilnDir) => {
    expect(readKilnYaml(kilnDir)).not.toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KilnYamlError } from "../kiln-yaml-types.js";
import {
  GLOBAL_CONFIG_FIELD_DESCRIPTORS,
  GLOBAL_CONFIG_SCHEMA,
  parseGlobalConfigStructure,
  serializeGlobalConfigDescriptors,
  serializeGlobalConfigEditorSchema,
} from "./global-config-schema.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("global configuration schema", () => {
  it.each([
    { formal: { dafny: { executable: "C:/tools/Dafny.exe", installationRoot: "C:/tools", expectedVersion: "4.11.0", expectedInstallationDigest: `sha256:${"ab".repeat(32)}` } } },
    { inferential: { gentleAi: { executable: "C:/tools/gentle-ai.exe", expectedVersion: "2.5.0-rc.1", expectedExecutableDigest: `sha256:${"ab".repeat(32)}` } } },
  ])("rejects verifier approval pins in operator configuration", (verification) => {
    expect(() => parseGlobalConfigStructure({ version: "7", verification }, "config.yaml")).toThrow(KilnYamlError);
  });

  it("owns one strict versioned global document boundary", () => {
    expect(GLOBAL_CONFIG_SCHEMA.$id).toBe("https://kiln.dev/schemas/global-config-v3.json");
    expect(GLOBAL_CONFIG_SCHEMA.additionalProperties).toBe(false);
    expect(parseGlobalConfigStructure({ version: "7" }, "fixtures/config.yaml")).toEqual({ version: "7" });
    expect(() => parseGlobalConfigStructure(
      { version: "7", unexpected: true },
      "fixtures/config.yaml",
    )).toThrow(KilnYamlError);
  });

  it("publishes schema-derived field ownership", () => {
    expect(GLOBAL_CONFIG_FIELD_DESCRIPTORS).toContainEqual(expect.objectContaining({
      identity: "/version",
      structuralOwner: "global-configuration",
      semanticOwner: "global-configuration",
      scope: "global",
      activation: "next-session",
      schemaRevision: 3,
    }));
    expect(GLOBAL_CONFIG_FIELD_DESCRIPTORS).toContainEqual(expect.objectContaining({
      identity: "/modelGateway",
      authorityImpact: "authority-bearing",
    }));
    expect(GLOBAL_CONFIG_FIELD_DESCRIPTORS).toContainEqual(expect.objectContaining({
      identity: "/interactiveUse",
      semanticOwner: "interactive-use",
      scope: "global",
      authorityImpact: "authority-bearing",
    }));
  });

  it("owns physical interactive-use providers globally", () => {
    expect(parseGlobalConfigStructure({
      version: "7",
      interactiveUse: {
        enabled: true,
        browserProvider: "playwright",
        allowedDomains: ["docs.example.com"],
      },
    }, "fixtures/config.yaml")).toMatchObject({
      interactiveUse: { browserProvider: "playwright" },
    });
  });

  it("keeps committed editor-schema and descriptor projections current", () => {
    expect(readFileSync(join(packageRoot, "schemas", "global-config-v3.json"), "utf8"))
      .toBe(serializeGlobalConfigEditorSchema());
    expect(readFileSync(join(packageRoot, "schemas", "global-config-descriptors-v3.json"), "utf8"))
      .toBe(serializeGlobalConfigDescriptors());
  });
});

import { describe, it, expect } from "vitest";
import { DomainRegistry } from "../../src/domain/domain-registry.js";
import { validateDomainYaml } from "../../src/domain/yaml-schema.js";
import { loadDomainYaml } from "../../src/domain/yaml-parser.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DOMAINS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/domains",
);

const EXPECTED_KITS = [
  "react-ts",
  "python",
  "docs",
  "support",
  "data-pipeline",
];

describe("DomainRegistry.loadBuiltinDomains()", () => {
  it("returns an array of DomainConfig objects", () => {
    const configs = DomainRegistry.loadBuiltinDomains();
    expect(Array.isArray(configs)).toBe(true);
    expect(configs.length).toBeGreaterThan(0);
  });

  it("contains exactly 5 built-in kits", () => {
    const configs = DomainRegistry.loadBuiltinDomains();
    expect(configs).toHaveLength(5);
  });

  it("contains all expected kit names", () => {
    const configs = DomainRegistry.loadBuiltinDomains();
    const names = configs.map((c) => c.name);
    for (const expected of EXPECTED_KITS) {
      expect(names).toContain(expected);
    }
  });

  it("each kit has non-empty name and displayName", () => {
    const configs = DomainRegistry.loadBuiltinDomains();
    for (const config of configs) {
      expect(config.name.length).toBeGreaterThan(0);
      expect(config.displayName.length).toBeGreaterThan(0);
    }
  });

  it("each kit has valid qualityGates with required fields", () => {
    const configs = DomainRegistry.loadBuiltinDomains();
    for (const config of configs) {
      for (const gate of config.qualityGates) {
        expect(gate.name.length).toBeGreaterThan(0);
        expect(gate.command.length).toBeGreaterThan(0);
        expect(gate.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("react-ts kit detects tsconfig.json", () => {
    const configs = DomainRegistry.loadBuiltinDomains();
    const reactTs = configs.find((c) => c.name === "react-ts");
    expect(reactTs).toBeDefined();
    expect(reactTs!.detectPatterns).toContain("tsconfig.json");
  });

  it("python kit detects requirements.txt", () => {
    const configs = DomainRegistry.loadBuiltinDomains();
    const python = configs.find((c) => c.name === "python");
    expect(python).toBeDefined();
    expect(python!.detectPatterns).toContain("requirements.txt");
  });

  it("data-pipeline kit detects dbt_project.yml", () => {
    const configs = DomainRegistry.loadBuiltinDomains();
    const pipeline = configs.find((c) => c.name === "data-pipeline");
    expect(pipeline).toBeDefined();
    expect(pipeline!.detectPatterns).toContain("dbt_project.yml");
  });

  it("support kit has empty detectPatterns (not file-based)", () => {
    const configs = DomainRegistry.loadBuiltinDomains();
    const support = configs.find((c) => c.name === "support");
    expect(support).toBeDefined();
    expect(support!.detectPatterns).toHaveLength(0);
  });

  it("all kits pass validateDomainYaml() (loaded from actual files)", () => {
    for (const name of EXPECTED_KITS) {
      const fileName = name === "react-ts" ? "react-ts.yaml" : `${name}.yaml`;
      const config = loadDomainYaml(join(DOMAINS_DIR, fileName));
      // validateDomainYaml expects the raw parsed YAML object, so we test
      // that loadDomainYaml does not throw (it internally calls validateDomainYaml)
      expect(config.name).toBe(name);
    }
  });

  it("react-ts kit has toolTags including filesystem and testing", () => {
    const configs = DomainRegistry.loadBuiltinDomains();
    const reactTs = configs.find((c) => c.name === "react-ts");
    expect(reactTs!.toolTags.has("filesystem")).toBe(true);
    expect(reactTs!.toolTags.has("testing")).toBe(true);
  });

  it("data-pipeline kit has required qualityGates", () => {
    const configs = DomainRegistry.loadBuiltinDomains();
    const pipeline = configs.find((c) => c.name === "data-pipeline");
    const requiredGates = pipeline!.qualityGates.filter((g) => g.required);
    expect(requiredGates.length).toBeGreaterThan(0);
  });
});

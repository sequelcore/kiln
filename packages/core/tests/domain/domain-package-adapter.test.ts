import { describe, it, expect } from "vitest";
import {
  parseDomainPackageYaml,
} from "../../src/domain/domain-package-adapter.js";
import {
  computeContentHash,
  validatePackageSecurity,
  validatePackageFiles,
} from "../../src/package/security.js";
import { DomainYamlError } from "../../src/domain/yaml-parser.js";

const VALID_PACKAGE_YAML = `
name: python
displayName: Python
detectPatterns:
  - pyproject.toml
  - setup.py
toolTags:
  - python
  - testing
qualityGates:
  - name: lint
    command: "ruff check ."
    description: Lint Python source
    required: true
version: "1.2.0"
author: "Test Author"
skills:
  - skills/refactor.md
  - skills/test.md
tools:
  server: tools/server.ts
`;

const MINIMAL_PACKAGE_YAML = `
name: minimal
displayName: Minimal Domain
detectPatterns: []
toolTags: []
qualityGates: []
`;

describe("parseDomainPackageYaml", () => {
  it("parses full package YAML into manifest", () => {
    const manifest = parseDomainPackageYaml(VALID_PACKAGE_YAML, "/install/path");
    expect(manifest.config.name).toBe("python");
    expect(manifest.config.displayName).toBe("Python");
    expect(manifest.config.toolTags.has("python")).toBe(true);
    expect(manifest.config.toolTags.has("testing")).toBe(true);
    expect(manifest.config.qualityGates).toHaveLength(1);
    expect(manifest.version).toBe("1.2.0");
    expect(manifest.author).toBe("Test Author");
    expect(manifest.installPath).toBe("/install/path");
    expect(manifest.skills).toEqual(["skills/refactor.md", "skills/test.md"]);
    expect(manifest.tools).toEqual({ server: "tools/server.ts" });
    expect(manifest.contentHash).toBeTruthy();
  });

  it("defaults version to 0.0.0 when not specified", () => {
    const manifest = parseDomainPackageYaml(MINIMAL_PACKAGE_YAML, "/path");
    expect(manifest.version).toBe("0.0.0");
  });

  it("defaults author to empty string when not specified", () => {
    const manifest = parseDomainPackageYaml(MINIMAL_PACKAGE_YAML, "/path");
    expect(manifest.author).toBe("");
  });

  it("defaults skills to empty array when not specified", () => {
    const manifest = parseDomainPackageYaml(MINIMAL_PACKAGE_YAML, "/path");
    expect(manifest.skills).toEqual([]);
  });

  it("defaults tools to null when not specified", () => {
    const manifest = parseDomainPackageYaml(MINIMAL_PACKAGE_YAML, "/path");
    expect(manifest.tools).toBeNull();
  });

  it("computes content hash", () => {
    const manifest = parseDomainPackageYaml(VALID_PACKAGE_YAML, "/path");
    expect(manifest.contentHash).toBe(computeContentHash(VALID_PACKAGE_YAML));
  });

  it("throws DomainYamlError for invalid YAML", () => {
    expect(() => parseDomainPackageYaml("name: test", "/path")).toThrow(DomainYamlError);
  });

  it("includes filePath in error when provided", () => {
    try {
      parseDomainPackageYaml("name: test", "/path", "test.yaml");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainYamlError);
      expect((err as DomainYamlError).filePath).toBe("test.yaml");
    }
  });

  it("produces consistent hash for same content", () => {
    const m1 = parseDomainPackageYaml(VALID_PACKAGE_YAML, "/path1");
    const m2 = parseDomainPackageYaml(VALID_PACKAGE_YAML, "/path2");
    expect(m1.contentHash).toBe(m2.contentHash);
  });

  it("produces different hash for different content", () => {
    const m1 = parseDomainPackageYaml(VALID_PACKAGE_YAML, "/path");
    const m2 = parseDomainPackageYaml(MINIMAL_PACKAGE_YAML, "/path");
    expect(m1.contentHash).not.toBe(m2.contentHash);
  });
});

describe("computeContentHash", () => {
  it("returns a 64-character hex string (SHA-256)", () => {
    const hash = computeContentHash("test content");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic", () => {
    expect(computeContentHash("hello")).toBe(computeContentHash("hello"));
  });

  it("differs for different content", () => {
    expect(computeContentHash("a")).not.toBe(computeContentHash("b"));
  });
});

describe("validatePackageSecurity", () => {
  it("passes with no package.json and clean files", () => {
    const result = validatePackageSecurity(null, ["domain.yaml", "README.md"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("passes with safe package.json", () => {
    const pkg = JSON.stringify({ name: "test", version: "1.0.0" });
    const result = validatePackageSecurity(pkg, ["domain.yaml"]);
    expect(result.valid).toBe(true);
  });

  it("fails with preinstall script", () => {
    const pkg = JSON.stringify({ scripts: { preinstall: "echo hack" } });
    const result = validatePackageSecurity(pkg, []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("preinstall"))).toBe(true);
  });

  it("fails with install script", () => {
    const pkg = JSON.stringify({ scripts: { install: "echo hack" } });
    const result = validatePackageSecurity(pkg, []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("install"))).toBe(true);
  });

  it("fails with postinstall script", () => {
    const pkg = JSON.stringify({ scripts: { postinstall: "echo hack" } });
    const result = validatePackageSecurity(pkg, []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("postinstall"))).toBe(true);
  });

  it("fails with prepare script", () => {
    const pkg = JSON.stringify({ scripts: { prepare: "echo hack" } });
    const result = validatePackageSecurity(pkg, []);
    expect(result.valid).toBe(false);
  });

  it("fails with prepublish script", () => {
    const pkg = JSON.stringify({ scripts: { prepublish: "echo hack" } });
    const result = validatePackageSecurity(pkg, []);
    expect(result.valid).toBe(false);
  });

  it("reports multiple forbidden scripts", () => {
    const pkg = JSON.stringify({
      scripts: { preinstall: "a", postinstall: "b", prepare: "c" },
    });
    const result = validatePackageSecurity(pkg, []);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3);
  });

  it("allows safe scripts (start, build, test)", () => {
    const pkg = JSON.stringify({
      scripts: { start: "node .", build: "tsc", test: "vitest" },
    });
    const result = validatePackageSecurity(pkg, []);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails with invalid JSON in package.json", () => {
    const result = validatePackageSecurity("not valid json {{{", []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("package.json"))).toBe(true);
  });

  it("warns about non-standard file extensions", () => {
    const result = validatePackageSecurity(null, ["script.sh", "binary.exe"]);
    expect(result.valid).toBe(true); // warnings don't fail validation
    expect(result.warnings.length).toBe(2);
  });

  it("allows standard extensions without warnings", () => {
    const result = validatePackageSecurity(null, [
      "domain.yaml",
      "domain.yml",
      "README.md",
      "index.ts",
      "config.json",
      "notes.txt",
    ]);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("validatePackageFiles", () => {
  it("passes for clean file list", () => {
    const result = validatePackageFiles(["domain.yaml", "README.md", "tools/server.ts"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects path traversal with ..", () => {
    const result = validatePackageFiles(["../../../etc/passwd"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("traversal"))).toBe(true);
  });

  it("detects path traversal in middle of path", () => {
    const result = validatePackageFiles(["tools/../../../etc/passwd"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("traversal"))).toBe(true);
  });

  it("detects absolute Unix paths", () => {
    const result = validatePackageFiles(["/etc/passwd"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Absolute"))).toBe(true);
  });

  it("detects absolute Windows paths", () => {
    const result = validatePackageFiles(["C:\\Windows\\system32\\cmd.exe"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Absolute"))).toBe(true);
  });

  it("warns about non-standard extensions", () => {
    const result = validatePackageFiles(["script.sh", "domain.yaml"]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes(".sh"))).toBe(true);
  });

  it("reports multiple security violations", () => {
    const result = validatePackageFiles([
      "../escape.txt",
      "/etc/shadow",
      "C:\\bad.exe",
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("handles empty file list", () => {
    const result = validatePackageFiles([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

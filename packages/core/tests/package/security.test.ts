import { describe, it, expect } from "vitest";
import {
  computeContentHash,
  verifyContentHash,
  validatePackageSecurity,
  validatePackageFiles,
  applyDefaultAnnotations,
} from "../../src/package/security.js";
import type { CapabilityAnnotations } from "../../src/engine/domain/capability.js";

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

describe("verifyContentHash", () => {
  it("returns true when hash matches content", () => {
    const content = "test content";
    const hash = computeContentHash(content);
    expect(verifyContentHash(content, hash)).toBe(true);
  });

  it("returns false when hash does not match", () => {
    const hash = computeContentHash("different");
    expect(verifyContentHash("original", hash)).toBe(false);
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
  });

  it("fails with postinstall script", () => {
    const pkg = JSON.stringify({ scripts: { postinstall: "echo hack" } });
    const result = validatePackageSecurity(pkg, []);
    expect(result.valid).toBe(false);
  });

  it("reports multiple forbidden scripts", () => {
    const pkg = JSON.stringify({ scripts: { preinstall: "a", postinstall: "b", prepare: "c" } });
    const result = validatePackageSecurity(pkg, []);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3);
  });

  it("allows safe scripts", () => {
    const pkg = JSON.stringify({ scripts: { start: "node .", build: "tsc", test: "vitest" } });
    const result = validatePackageSecurity(pkg, []);
    expect(result.valid).toBe(true);
  });

  it("fails with invalid JSON", () => {
    const result = validatePackageSecurity("not valid json {{{", []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("package.json"))).toBe(true);
  });

  it("warns about non-standard extensions", () => {
    const result = validatePackageSecurity(null, ["script.sh", "binary.exe"]);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBe(2);
  });
});

describe("validatePackageFiles", () => {
  it("passes for clean file list", () => {
    const result = validatePackageFiles(["domain.yaml", "README.md"]);
    expect(result.valid).toBe(true);
  });

  it("detects path traversal", () => {
    const result = validatePackageFiles(["../../../etc/passwd"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("traversal"))).toBe(true);
  });

  it("detects absolute Unix paths", () => {
    const result = validatePackageFiles(["/etc/passwd"]);
    expect(result.valid).toBe(false);
  });

  it("detects absolute Windows paths", () => {
    const result = validatePackageFiles(["C:\\Windows\\system32\\cmd.exe"]);
    expect(result.valid).toBe(false);
  });

  it("handles empty file list", () => {
    const result = validatePackageFiles([]);
    expect(result.valid).toBe(true);
  });
});

describe("applyDefaultAnnotations", () => {
  it("returns destructive defaults for undefined", () => {
    const result = applyDefaultAnnotations();
    expect(result.destructive).toBe(true);
    expect(result.readOnly).toBe(false);
    expect(result.idempotent).toBe(false);
  });

  it("returns destructive defaults for null", () => {
    const result = applyDefaultAnnotations(null);
    expect(result.destructive).toBe(true);
  });

  it("preserves explicit values", () => {
    const annotations: CapabilityAnnotations = { destructive: false, readOnly: true, idempotent: true };
    const result = applyDefaultAnnotations(annotations);
    expect(result.destructive).toBe(false);
    expect(result.readOnly).toBe(true);
    expect(result.idempotent).toBe(true);
  });

  it("defaults missing fields to safe values", () => {
    const result = applyDefaultAnnotations({});
    expect(result.destructive).toBe(true);
    expect(result.readOnly).toBe(false);
    expect(result.idempotent).toBe(false);
  });
});

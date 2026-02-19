import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { createTenantSandbox } from "../../src/sandbox/policies.js";
import { SandboxPolicy } from "../../src/sandbox/policies.js";

describe("createTenantSandbox", () => {
  const basePath = "/var/data";
  const tenantId = "tenant-abc";

  it("restricts to the tenant directory", () => {
    const config = createTenantSandbox(tenantId, basePath);
    const policy = new SandboxPolicy({ config, projectPath: basePath });

    const tenantFile = resolve(basePath, "tenants", tenantId, "data.txt");
    expect(policy.canRead(tenantFile)).toBe(true);
    expect(policy.canWrite(tenantFile)).toBe(true);
  });

  it("blocks access to other tenant directories", () => {
    const config = createTenantSandbox(tenantId, basePath);
    const policy = new SandboxPolicy({ config, projectPath: basePath });

    const otherTenantFile = resolve(basePath, "tenants", "other-tenant", "secret.txt");
    // The tenants root is denied, so traversal to other tenants is blocked
    expect(policy.canRead(otherTenantFile)).toBe(false);
    expect(policy.canWrite(otherTenantFile)).toBe(false);
  });

  it("default net policy is 'none'", () => {
    const config = createTenantSandbox(tenantId, basePath);
    expect(config.netPolicy).toBe("none");
  });

  it("inherits base policy net settings", () => {
    const basePolicy = {
      fsPolicy: "read-only" as const,
      netPolicy: "package-managers" as const,
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: ["registry.npmjs.org"],
    };
    const config = createTenantSandbox(tenantId, basePath, basePolicy);
    expect(config.netPolicy).toBe("package-managers");
    expect(config.allowedDomains).toContain("registry.npmjs.org");
  });

  it("default allowedDomains is empty", () => {
    const config = createTenantSandbox(tenantId, basePath);
    expect(config.allowedDomains).toHaveLength(0);
  });

  it("fs policy is read-write", () => {
    const config = createTenantSandbox(tenantId, basePath);
    expect(config.fsPolicy).toBe("read-write");
  });

  it("allowedPaths contains the tenant-specific directory", () => {
    const config = createTenantSandbox(tenantId, basePath);
    const expectedPath = resolve(basePath, "tenants", tenantId);
    expect(config.allowedPaths).toContain(expectedPath);
  });

  it("deniedPaths contains the parent tenants directory", () => {
    const config = createTenantSandbox(tenantId, basePath);
    const expectedDenied = resolve(basePath, "tenants");
    expect(config.deniedPaths).toContain(expectedDenied);
  });

  it("blocks access to the base path itself", () => {
    const config = createTenantSandbox(tenantId, basePath);
    const policy = new SandboxPolicy({ config, projectPath: basePath });

    const baseFile = resolve(basePath, "config.json");
    expect(policy.canRead(baseFile)).toBe(false);
  });
});

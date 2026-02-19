import { describe, it, expect } from "vitest";
import { SelfAudit } from "../../src/security/self-audit.js";
import type { AuditLog, AuditEntry, AuditFilter, AuditChainResult } from "../../src/security/types.js";
import type { SelfAuditOptions } from "../../src/security/self-audit.js";

// --- Helpers ---

class MockAuditLog implements AuditLog {
  private readonly chainValid: boolean;
  private readonly chainError?: string;
  private readonly entryCount: number;

  constructor(options?: { chainValid?: boolean; chainError?: string; entryCount?: number }) {
    this.chainValid = options?.chainValid ?? true;
    this.chainError = options?.chainError;
    this.entryCount = options?.entryCount ?? 3;
  }

  append(entry: Omit<AuditEntry, "id" | "hash" | "previousHash">): AuditEntry {
    return { ...entry, id: crypto.randomUUID() };
  }

  query(_filter: AuditFilter): readonly AuditEntry[] {
    return [];
  }

  verifyChain(): AuditChainResult {
    if (!this.chainValid) {
      return {
        valid: false,
        entriesChecked: this.entryCount,
        brokenAt: 1,
        error: this.chainError ?? "Chain broken at index 1: hash mismatch",
      };
    }
    return { valid: true, entriesChecked: this.entryCount };
  }

  count(): number {
    return this.entryCount;
  }
}

type TenantEntry = { tenantId: string; whatsappAccessToken?: string; whatsappVerifyToken?: string };

function makeTenantRegistry(tenants: TenantEntry[]) {
  return { list: () => tenants };
}

function makeHealthyOptions(): SelfAuditOptions {
  return {
    auditLog: new MockAuditLog(),
    tenantRegistry: makeTenantRegistry([
      { tenantId: "t1", whatsappAccessToken: "[encrypted]", whatsappVerifyToken: "[encrypted]" },
      { tenantId: "t2", whatsappAccessToken: "[encrypted]" },
    ]),
    configValidator: () => [],
  };
}

// --- Tests ---

describe("SelfAudit", () => {
  describe("runAudit - all pass", () => {
    it("returns pass when all checks succeed", async () => {
      const audit = new SelfAudit(makeHealthyOptions());
      const report = await audit.runAudit();

      expect(report.overallStatus).toBe("pass");
      expect(report.checks).toHaveLength(4);
      expect(report.checks.every((c) => c.passed)).toBe(true);
      expect(report.summary).toBe("4/4 checks passed");
    });

    it("includes a timestamp in the report", async () => {
      const audit = new SelfAudit(makeHealthyOptions());
      const report = await audit.runAudit();
      expect(report.timestamp).toBeInstanceOf(Date);
    });
  });

  describe("runAudit - fail cases", () => {
    it("overall status is fail when any check fails", async () => {
      const audit = new SelfAudit({
        ...makeHealthyOptions(),
        configValidator: () => ["MISSING_API_KEY"],
      });
      const report = await audit.runAudit();
      expect(report.overallStatus).toBe("fail");
    });

    it("summary includes failed check names", async () => {
      const audit = new SelfAudit({
        auditLog: new MockAuditLog({ chainValid: false }),
        tenantRegistry: makeTenantRegistry([
          { tenantId: "t1", whatsappAccessToken: "raw_token" },
        ]),
        configValidator: () => [],
      });
      const report = await audit.runAudit();
      expect(report.overallStatus).toBe("fail");
      expect(report.summary).toContain("failed");
      expect(report.summary).toMatch(/secrets_encryption|audit_integrity/);
    });
  });

  describe("runAudit - no options", () => {
    it("works with no options (all pass with not-configured details)", async () => {
      const audit = new SelfAudit({});
      const report = await audit.runAudit();
      expect(report.overallStatus).toBe("pass");
      expect(report.checks.every((c) => c.passed)).toBe(true);
    });
  });

  describe("secrets_encryption", () => {
    it("passes when all tokens are [encrypted]", async () => {
      const audit = new SelfAudit({
        tenantRegistry: makeTenantRegistry([
          { tenantId: "t1", whatsappAccessToken: "[encrypted]", whatsappVerifyToken: "[encrypted]" },
        ]),
      });
      const result = await audit.runCheck("secrets_encryption");
      expect(result.passed).toBe(true);
    });

    it("passes when tokens are absent (undefined)", async () => {
      const audit = new SelfAudit({
        tenantRegistry: makeTenantRegistry([{ tenantId: "t1" }]),
      });
      const result = await audit.runCheck("secrets_encryption");
      expect(result.passed).toBe(true);
    });

    it("fails when whatsappAccessToken is plaintext", async () => {
      const audit = new SelfAudit({
        tenantRegistry: makeTenantRegistry([
          { tenantId: "t1", whatsappAccessToken: "EAAG...plaintext" },
        ]),
      });
      const result = await audit.runCheck("secrets_encryption");
      expect(result.passed).toBe(false);
      expect(result.details).toContain("t1");
    });

    it("fails when whatsappVerifyToken is plaintext", async () => {
      const audit = new SelfAudit({
        tenantRegistry: makeTenantRegistry([
          { tenantId: "t2", whatsappVerifyToken: "my-verify-token" },
        ]),
      });
      const result = await audit.runCheck("secrets_encryption");
      expect(result.passed).toBe(false);
      expect(result.details).toContain("t2");
    });

    it("passes with no tenant registry", async () => {
      const audit = new SelfAudit({});
      const result = await audit.runCheck("secrets_encryption");
      expect(result.passed).toBe(true);
    });
  });

  describe("audit_integrity", () => {
    it("passes on valid chain", async () => {
      const audit = new SelfAudit({ auditLog: new MockAuditLog({ chainValid: true }) });
      const result = await audit.runCheck("audit_integrity");
      expect(result.passed).toBe(true);
      expect(result.details).toContain("3 entries checked");
    });

    it("fails when chain is broken", async () => {
      const audit = new SelfAudit({
        auditLog: new MockAuditLog({ chainValid: false, chainError: "Chain broken at index 1: hash mismatch (tampered entry)" }),
      });
      const result = await audit.runCheck("audit_integrity");
      expect(result.passed).toBe(false);
      expect(result.details).toContain("Chain broken");
    });

    it("passes with no audit log", async () => {
      const audit = new SelfAudit({});
      const result = await audit.runCheck("audit_integrity");
      expect(result.passed).toBe(true);
      expect(result.details).toContain("not configured");
    });
  });

  describe("tenant_isolation", () => {
    it("passes when all tenant IDs are unique", async () => {
      const audit = new SelfAudit({
        tenantRegistry: makeTenantRegistry([
          { tenantId: "t1" },
          { tenantId: "t2" },
          { tenantId: "t3" },
        ]),
      });
      const result = await audit.runCheck("tenant_isolation");
      expect(result.passed).toBe(true);
    });

    it("fails when duplicate tenant IDs exist", async () => {
      const audit = new SelfAudit({
        tenantRegistry: makeTenantRegistry([
          { tenantId: "t1" },
          { tenantId: "t1" }, // duplicate
        ]),
      });
      const result = await audit.runCheck("tenant_isolation");
      expect(result.passed).toBe(false);
      expect(result.details).toContain("t1");
    });

    it("passes with no tenant registry", async () => {
      const audit = new SelfAudit({});
      const result = await audit.runCheck("tenant_isolation");
      expect(result.passed).toBe(true);
    });
  });

  describe("config_validation", () => {
    it("passes when no errors returned", async () => {
      const audit = new SelfAudit({ configValidator: () => [] });
      const result = await audit.runCheck("config_validation");
      expect(result.passed).toBe(true);
    });

    it("fails when errors are returned", async () => {
      const audit = new SelfAudit({
        configValidator: () => ["MISSING_API_KEY", "MISSING_DB_URL"],
      });
      const result = await audit.runCheck("config_validation");
      expect(result.passed).toBe(false);
      expect(result.details).toContain("MISSING_API_KEY");
    });

    it("passes with no config validator", async () => {
      const audit = new SelfAudit({});
      const result = await audit.runCheck("config_validation");
      expect(result.passed).toBe(true);
      expect(result.details).toContain("no validator");
    });
  });

  describe("checkedAt", () => {
    it("includes a checkedAt Date in each result", async () => {
      const audit = new SelfAudit({});
      const result = await audit.runCheck("config_validation");
      expect(result.checkedAt).toBeInstanceOf(Date);
    });
  });
});

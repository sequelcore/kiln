// SelfAudit: periodic security health checks

import type { AuditLog, SecretStore } from "./types.js";

export type SecurityCheckName =
  | "secrets_encryption"
  | "audit_integrity"
  | "tenant_isolation"
  | "config_validation";

export interface SecurityCheckResult {
  readonly check: SecurityCheckName;
  readonly passed: boolean;
  readonly details: string;
  readonly checkedAt: Date;
}

export interface SecurityAuditReport {
  readonly timestamp: Date;
  readonly overallStatus: "pass" | "warn" | "fail";
  readonly checks: readonly SecurityCheckResult[];
  readonly summary: string;
}

export interface SelfAuditOptions {
  readonly auditLog?: AuditLog;
  readonly secretStore?: SecretStore;
  readonly tenantRegistry?: {
    list(): readonly { tenantId: string; whatsappAccessToken?: string; whatsappVerifyToken?: string }[];
  };
  readonly configValidator?: () => string[];
}

export class SelfAudit {
  private readonly options: SelfAuditOptions;

  constructor(options: SelfAuditOptions) {
    this.options = options;
  }

  async runAudit(): Promise<SecurityAuditReport> {
    const checkNames: SecurityCheckName[] = [
      "secrets_encryption",
      "audit_integrity",
      "tenant_isolation",
      "config_validation",
    ];

    const checks = await Promise.all(checkNames.map((name) => this.runCheck(name)));

    const failedChecks = checks.filter((c) => !c.passed).map((c) => c.check);
    const passedCount = checks.filter((c) => c.passed).length;
    const total = checks.length;

    let overallStatus: "pass" | "warn" | "fail";
    if (failedChecks.length > 0) {
      overallStatus = "fail";
    } else if (total === 0) {
      overallStatus = "warn";
    } else {
      overallStatus = "pass";
    }

    let summary: string;
    if (failedChecks.length === 0) {
      summary = `${passedCount}/${total} checks passed`;
    } else {
      summary = `${passedCount}/${total} checks passed (${failedChecks.join(", ")} failed)`;
    }

    return {
      timestamp: new Date(),
      overallStatus,
      checks,
      summary,
    };
  }

  async runCheck(check: SecurityCheckName): Promise<SecurityCheckResult> {
    const checkedAt = new Date();

    switch (check) {
      case "secrets_encryption": {
        const { tenantRegistry } = this.options;
        if (!tenantRegistry) {
          return { check, passed: true, details: "tenant registry not configured", checkedAt };
        }
        const tenants = tenantRegistry.list();
        const plaintextTenants: string[] = [];
        for (const tenant of tenants) {
          const hasPlaintext =
            (tenant.whatsappAccessToken !== undefined &&
              tenant.whatsappAccessToken !== "[encrypted]") ||
            (tenant.whatsappVerifyToken !== undefined &&
              tenant.whatsappVerifyToken !== "[encrypted]");
          if (hasPlaintext) {
            plaintextTenants.push(tenant.tenantId);
          }
        }
        if (plaintextTenants.length > 0) {
          return {
            check,
            passed: false,
            details: `Plaintext tokens found in tenants: ${plaintextTenants.join(", ")}`,
            checkedAt,
          };
        }
        return { check, passed: true, details: "All tenant tokens are encrypted", checkedAt };
      }

      case "audit_integrity": {
        const { auditLog } = this.options;
        if (!auditLog) {
          return { check, passed: true, details: "audit log not configured", checkedAt };
        }
        const result = auditLog.verifyChain();
        if (!result.valid) {
          return {
            check,
            passed: false,
            details: result.error ?? `Chain broken at index ${result.brokenAt ?? "unknown"}`,
            checkedAt,
          };
        }
        return {
          check,
          passed: true,
          details: `Audit chain valid (${result.entriesChecked} entries checked)`,
          checkedAt,
        };
      }

      case "tenant_isolation": {
        const { tenantRegistry } = this.options;
        if (!tenantRegistry) {
          return { check, passed: true, details: "tenant registry not configured", checkedAt };
        }
        const tenants = tenantRegistry.list();
        const seen = new Set<string>();
        const duplicates: string[] = [];
        for (const tenant of tenants) {
          if (seen.has(tenant.tenantId)) {
            duplicates.push(tenant.tenantId);
          } else {
            seen.add(tenant.tenantId);
          }
        }
        if (duplicates.length > 0) {
          return {
            check,
            passed: false,
            details: `Duplicate tenant IDs detected: ${duplicates.join(", ")}`,
            checkedAt,
          };
        }
        return {
          check,
          passed: true,
          details: `All ${tenants.length} tenant IDs are unique`,
          checkedAt,
        };
      }

      case "config_validation": {
        const { configValidator } = this.options;
        if (!configValidator) {
          return { check, passed: true, details: "no validator configured", checkedAt };
        }
        const errors = configValidator();
        if (errors.length > 0) {
          return {
            check,
            passed: false,
            details: `Config errors: ${errors.join("; ")}`,
            checkedAt,
          };
        }
        return { check, passed: true, details: "Config validation passed", checkedAt };
      }
    }
  }
}

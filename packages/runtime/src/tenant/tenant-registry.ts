import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { TenantConfig } from "@kiln/core";
import { validateTenantConfig } from "@kiln/core";

export class TenantNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`Tenant not found: ${tenantId}`);
    this.name = "TenantNotFoundError";
  }
}

export class TenantValidationFailedError extends Error {
  readonly errors: readonly { field: string; message: string }[];
  constructor(errors: readonly { field: string; message: string }[]) {
    super(`Tenant validation failed: ${errors.map((e) => `${e.field}: ${e.message}`).join(", ")}`);
    this.name = "TenantValidationFailedError";
    this.errors = errors;
  }
}

export class TenantRegistry {
  private readonly storageDir: string;
  private readonly tenants = new Map<string, TenantConfig>();

  constructor(storageDir: string) {
    this.storageDir = storageDir;
  }

  load(): void {
    if (!existsSync(this.storageDir)) return;
    const files = readdirSync(this.storageDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const content = readFileSync(join(this.storageDir, file), "utf-8");
      const config = JSON.parse(content) as TenantConfig;
      this.tenants.set(config.tenantId, config);
    }
  }

  get(tenantId: string): TenantConfig | undefined {
    return this.tenants.get(tenantId);
  }

  list(appName?: string): readonly TenantConfig[] {
    const all = [...this.tenants.values()];
    return appName ? all.filter((t) => t.appName === appName) : all;
  }

  create(config: TenantConfig): TenantConfig {
    if (this.tenants.has(config.tenantId)) {
      throw new TenantValidationFailedError([
        { field: "tenantId", message: `duplicate tenantId "${config.tenantId}"` },
      ]);
    }
    const errors = validateTenantConfig(config);
    if (errors.length > 0) {
      throw new TenantValidationFailedError(errors);
    }
    this.tenants.set(config.tenantId, config);
    this.persist(config);
    return config;
  }

  update(tenantId: string, patch: Partial<Omit<TenantConfig, "tenantId" | "appName" | "createdAt">>): TenantConfig {
    const existing = this.tenants.get(tenantId);
    if (!existing) throw new TenantNotFoundError(tenantId);

    const updated: TenantConfig = {
      ...existing,
      ...patch,
      tenantId: existing.tenantId,
      appName: existing.appName,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    const errors = validateTenantConfig(updated);
    if (errors.length > 0) {
      throw new TenantValidationFailedError(errors);
    }

    this.tenants.set(tenantId, updated);
    this.persist(updated);
    return updated;
  }

  remove(tenantId: string): boolean {
    if (!this.tenants.has(tenantId)) return false;
    this.tenants.delete(tenantId);
    const filePath = join(this.storageDir, `${tenantId}.json`);
    if (existsSync(filePath)) unlinkSync(filePath);
    return true;
  }

  resolveByPhone(phoneNumberId: string, appName: string): TenantConfig | undefined {
    for (const tenant of this.tenants.values()) {
      if (
        tenant.appName === appName &&
        tenant.whatsappPhoneNumberId === phoneNumberId &&
        tenant.enabled
      ) {
        return tenant;
      }
    }
    return undefined;
  }

  private persist(config: TenantConfig): void {
    mkdirSync(this.storageDir, { recursive: true });
    const filePath = join(this.storageDir, `${config.tenantId}.json`);
    writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
  }
}

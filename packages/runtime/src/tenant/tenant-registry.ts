import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { KilnError } from "@kilnai/core";
import type { TenantConfig, SecretStore } from "@kilnai/core";
import { validateTenantConfig } from "@kilnai/core";

const SENSITIVE_FIELDS = ["whatsappAccessToken", "whatsappVerifyToken"] as const;
type SensitiveField = (typeof SENSITIVE_FIELDS)[number];
const ENCRYPTED_PLACEHOLDER = "[encrypted]";

export class TenantNotFoundError extends KilnError {
  constructor(tenantId: string) {
    super("TENANT_NOT_FOUND", `Tenant not found: ${tenantId}`, {
      context: { tenantId },
      retryable: false,
    });
    this.name = "TenantNotFoundError";
  }
}

export class TenantValidationFailedError extends KilnError {
  readonly errors: readonly { field: string; message: string }[];
  constructor(errors: readonly { field: string; message: string }[]) {
    super("TENANT_VALIDATION_FAILED", `Tenant validation failed: ${errors.map((e) => `${e.field}: ${e.message}`).join(", ")}`, {
      context: { errors },
      retryable: false,
    });
    this.name = "TenantValidationFailedError";
    this.errors = errors;
  }
}

export class TenantRegistry {
  private readonly storageDir: string;
  private readonly secretStore: SecretStore | undefined;
  private readonly tenants = new Map<string, TenantConfig>();

  constructor(storageDir: string, secretStore?: SecretStore) {
    this.storageDir = storageDir;
    this.secretStore = secretStore;
  }

  private encryptSensitiveFields(config: TenantConfig): TenantConfig {
    if (!this.secretStore) return config;
    const result: Record<string, unknown> = { ...config };
    for (const field of SENSITIVE_FIELDS) {
      const value = config[field as keyof TenantConfig];
      if (typeof value === "string" && value !== ENCRYPTED_PLACEHOLDER) {
        const secretKey = `tenant:${config.tenantId}:${field}`;
        this.secretStore.set(secretKey, value);
        result[field] = ENCRYPTED_PLACEHOLDER;
      }
    }
    return result as unknown as TenantConfig;
  }

  private hydrateSecrets(config: TenantConfig): TenantConfig {
    if (!this.secretStore) return config;
    const result: Record<string, unknown> = { ...config };
    for (const field of SENSITIVE_FIELDS) {
      const value = config[field as keyof TenantConfig];
      if (value === ENCRYPTED_PLACEHOLDER) {
        const secretKey = `tenant:${config.tenantId}:${field as SensitiveField}`;
        const decrypted = this.secretStore.get(secretKey);
        if (decrypted !== null) result[field] = decrypted;
      }
    }
    return result as unknown as TenantConfig;
  }

  private deleteSecrets(tenantId: string): void {
    if (!this.secretStore) return;
    for (const field of SENSITIVE_FIELDS) {
      this.secretStore.delete(`tenant:${tenantId}:${field}`);
    }
  }

  load(): void {
    if (!existsSync(this.storageDir)) return;
    const files = readdirSync(this.storageDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const content = readFileSync(join(this.storageDir, file), "utf-8");
      const config = JSON.parse(content) as TenantConfig;
      // Store the persisted (potentially encrypted) config in memory map
      this.tenants.set(config.tenantId, config);
    }
  }

  get(tenantId: string): TenantConfig | undefined {
    const config = this.tenants.get(tenantId);
    if (!config) return undefined;
    return this.hydrateSecrets(config);
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
    const encrypted = this.encryptSensitiveFields(config);
    this.tenants.set(config.tenantId, encrypted);
    this.persist(encrypted);
    return this.hydrateSecrets(encrypted);
  }

  update(tenantId: string, patch: Partial<Omit<TenantConfig, "tenantId" | "appName" | "createdAt">>): TenantConfig {
    const existing = this.tenants.get(tenantId);
    if (!existing) throw new TenantNotFoundError(tenantId);

    // Hydrate existing secrets before merging patch so we can re-encrypt properly
    const hydrated = this.hydrateSecrets(existing);
    const updated: TenantConfig = {
      ...hydrated,
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

    const encrypted = this.encryptSensitiveFields(updated);
    this.tenants.set(tenantId, encrypted);
    this.persist(encrypted);
    return this.hydrateSecrets(encrypted);
  }

  remove(tenantId: string): boolean {
    if (!this.tenants.has(tenantId)) return false;
    this.tenants.delete(tenantId);
    this.deleteSecrets(tenantId);
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

  resolveByWidgetId(widgetId: string, appName: string): TenantConfig | undefined {
    for (const tenant of this.tenants.values()) {
      if (
        tenant.widgetId === widgetId &&
        tenant.appName === appName &&
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

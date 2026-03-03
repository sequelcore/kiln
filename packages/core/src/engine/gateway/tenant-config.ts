// Engine type: TenantConfig -- multi-tenant business configuration
// Pure TypeScript, zero external dependencies. Follows mode-b-config.ts pattern.

/** A service offered by the tenant business */
export interface TenantService {
  readonly name: string;
  readonly description?: string;
  readonly price?: string;
  readonly duration?: string;
}

/** A contact person for escalation */
export interface TenantContact {
  readonly name: string;
  readonly phone?: string;
  readonly email?: string;
}

/** Business operating hours, keyed by day name */
export interface TenantHours {
  readonly [day: string]: string;
}

/** FAQ entry: question and response */
export interface TenantFaqEntry {
  readonly q: string;
  readonly r: string;
}

/** Tone of the AI assistant's responses */
export type TenantTone = "formal" | "friendly" | "casual";

/** Per-tenant billing configuration (overrides App-level billing) */
export interface TenantBilling {
  readonly budgetEndpoint?: string;
  readonly usageEndpoint?: string;
  readonly overBudgetMessage?: string;
}

/** Full tenant configuration for a business within a multi-tenant App */
export interface TenantConfig {
  readonly tenantId: string;
  readonly appName: string;
  readonly name: string;
  readonly businessName?: string;
  readonly description?: string;
  readonly services?: readonly TenantService[];
  readonly hours?: TenantHours;
  readonly faqEntries?: readonly TenantFaqEntry[];
  readonly escalationContact?: TenantContact;
  readonly tone?: TenantTone;
  readonly language?: string;
  readonly whatsappPhoneNumberId?: string;
  readonly whatsappAccessToken?: string;
  readonly whatsappVerifyToken?: string;
  readonly widgetId?: string;
  readonly greeting?: string;
  readonly billing?: TenantBilling;
  readonly idleTimeoutMs?: number;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Validation error for tenant configuration */
export interface TenantValidationError {
  readonly field: string;
  readonly message: string;
}

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
const VALID_TONES: readonly TenantTone[] = ["formal", "friendly", "casual"];

/** Validate a TenantConfig. Returns array of errors; empty means valid. */
export function validateTenantConfig(config: TenantConfig): TenantValidationError[] {
  const errors: TenantValidationError[] = [];

  // tenantId: lowercase slug, 2-64 chars
  if (!config.tenantId || typeof config.tenantId !== "string") {
    errors.push({ field: "tenantId", message: "must be a non-empty string" });
  } else if (!TENANT_ID_PATTERN.test(config.tenantId)) {
    errors.push({
      field: "tenantId",
      message: "must be a lowercase slug (a-z, 0-9, hyphens, 2-64 chars, no leading/trailing hyphens)",
    });
  }

  // appName: non-empty string
  if (!config.appName || typeof config.appName !== "string") {
    errors.push({ field: "appName", message: "must be a non-empty string" });
  }

  // name: non-empty string
  if (!config.name || typeof config.name !== "string") {
    errors.push({ field: "name", message: "must be a non-empty string" });
  }

  // tone: if present, must be valid
  if (config.tone !== undefined && !VALID_TONES.includes(config.tone as TenantTone)) {
    errors.push({ field: "tone", message: `must be one of: ${VALID_TONES.join(", ")}` });
  }

  // enabled: must be boolean
  if (typeof config.enabled !== "boolean") {
    errors.push({ field: "enabled", message: "must be a boolean" });
  }

  // createdAt: non-empty string
  if (!config.createdAt || typeof config.createdAt !== "string") {
    errors.push({ field: "createdAt", message: "must be a non-empty string" });
  }

  // updatedAt: non-empty string
  if (!config.updatedAt || typeof config.updatedAt !== "string") {
    errors.push({ field: "updatedAt", message: "must be a non-empty string" });
  }

  return errors;
}

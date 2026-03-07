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

/** Webhook tool definition for tenant-specific external integrations */
export interface TenantWebhookTool {
  readonly name: string;
  readonly description?: string;
  readonly url: string;
  readonly secret: string;
  readonly timeout?: number;
  readonly inputSchema?: Record<string, unknown>;
}

/** Per-tenant tool execution configuration */
export interface TenantToolConfig {
  readonly maxIterationsPerSession?: number;
  readonly rateLimits?: import("../domain/rate-limiter.js").RateLimitConfig;
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
  readonly instagramPageId?: string;
  readonly instagramAccessToken?: string;
  readonly messengerPageId?: string;
  readonly messengerAccessToken?: string;
  readonly widgetId?: string;
  readonly allowedOrigins?: readonly string[];
  readonly greeting?: string;
  readonly billing?: TenantBilling;
  readonly idleTimeoutMs?: number;
  readonly tools?: readonly string[];
  readonly toolConfig?: TenantToolConfig;
  readonly webhookTools?: readonly TenantWebhookTool[];
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

  // allowedOrigins: if present, must be array of valid origin strings
  if (config.allowedOrigins !== undefined) {
    if (!Array.isArray(config.allowedOrigins)) {
      errors.push({ field: "allowedOrigins", message: "must be an array of origin strings" });
    } else {
      for (let i = 0; i < config.allowedOrigins.length; i++) {
        const origin = config.allowedOrigins[i];
        if (typeof origin !== "string" || (!origin.startsWith("http://") && !origin.startsWith("https://"))) {
          errors.push({ field: `allowedOrigins[${i}]`, message: "must be an HTTP or HTTPS origin" });
        }
      }
    }
  }

  // tools: if present, must be array of non-empty strings
  if (config.tools !== undefined) {
    if (!Array.isArray(config.tools)) {
      errors.push({ field: "tools", message: "must be an array of tool name strings" });
    } else {
      for (let i = 0; i < config.tools.length; i++) {
        if (typeof config.tools[i] !== "string" || !config.tools[i]) {
          errors.push({ field: `tools[${i}]`, message: "must be a non-empty string" });
        }
      }
    }
  }

  // toolConfig: if present, validate sub-fields
  if (config.toolConfig !== undefined) {
    if (
      config.toolConfig.maxIterationsPerSession !== undefined &&
      (!Number.isInteger(config.toolConfig.maxIterationsPerSession) ||
        config.toolConfig.maxIterationsPerSession < 1 ||
        config.toolConfig.maxIterationsPerSession > 50)
    ) {
      errors.push({
        field: "toolConfig.maxIterationsPerSession",
        message: "must be a positive integer <= 50",
      });
    }
    if (
      config.toolConfig.rateLimits?.defaultPerMinute !== undefined &&
      (!Number.isInteger(config.toolConfig.rateLimits.defaultPerMinute) ||
        config.toolConfig.rateLimits.defaultPerMinute < 1)
    ) {
      errors.push({
        field: "toolConfig.rateLimits.defaultPerMinute",
        message: "must be a positive integer",
      });
    }
  }

  // webhookTools: if present, must be array with valid entries and unique names
  if (config.webhookTools !== undefined) {
    if (!Array.isArray(config.webhookTools)) {
      errors.push({ field: "webhookTools", message: "must be an array of webhook tool definitions" });
    } else {
      const seenNames = new Set<string>();
      for (let i = 0; i < config.webhookTools.length; i++) {
        const wt = config.webhookTools[i];
        if (typeof wt.name !== "string" || !wt.name) {
          errors.push({ field: `webhookTools[${i}].name`, message: "must be a non-empty string" });
        } else {
          if (seenNames.has(wt.name)) {
            errors.push({ field: `webhookTools[${i}].name`, message: `duplicate webhook tool name: "${wt.name}"` });
          }
          seenNames.add(wt.name);
        }
        if (
          typeof wt.url !== "string" ||
          (!wt.url.startsWith("http://") && !wt.url.startsWith("https://"))
        ) {
          errors.push({ field: `webhookTools[${i}].url`, message: "must be an HTTP or HTTPS URL" });
        }
        if (typeof wt.secret !== "string" || !wt.secret) {
          errors.push({ field: `webhookTools[${i}].secret`, message: "must be a non-empty string" });
        }
      }
    }
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

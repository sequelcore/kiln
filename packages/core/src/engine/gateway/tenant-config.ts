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

/** Agent definition for multi-agent tenants */
export interface TenantAgentConfig {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly goal: string;
  readonly backstory?: string;
  readonly instructions?: string;
  readonly tools?: readonly string[];
  readonly isDefault?: boolean;
}

/** Regex-based routing rule */
export interface TenantRoutingRule {
  readonly match: string;
  readonly agent: string;
}

/** Multi-agent routing configuration */
export interface TenantRoutingConfig {
  readonly rules?: readonly TenantRoutingRule[];
  readonly fallback: string;
  readonly embeddingThreshold?: number;
  readonly rerouteAfterTurns?: number;
  readonly maxHandoffs?: number;
}

/** Email transport provider configuration */
export interface EmailTransportConfig {
  readonly provider: "postmark" | "resend" | "sendgrid" | "generic";
  readonly apiKey?: string;
  readonly endpoint?: string;
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
  readonly emailAddress?: string;
  readonly emailFromAddress?: string;
  readonly emailFromName?: string;
  readonly emailTransportConfig?: EmailTransportConfig;
  readonly widgetId?: string;
  readonly allowedOrigins?: readonly string[];
  readonly greeting?: string;
  readonly billing?: TenantBilling;
  readonly idleTimeoutMs?: number;
  readonly tools?: readonly string[];
  readonly toolConfig?: TenantToolConfig;
  readonly webhookTools?: readonly TenantWebhookTool[];
  readonly agents?: readonly TenantAgentConfig[];
  readonly routing?: TenantRoutingConfig;
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

  // agents: if present, validate each agent and cross-references
  if (config.agents !== undefined) {
    if (!Array.isArray(config.agents)) {
      errors.push({ field: "agents", message: "must be an array of agent configurations" });
    } else {
      const seenAgentIds = new Set<string>();
      const allToolNames = new Set<string>([
        ...(config.tools ?? []),
        ...(config.webhookTools ?? []).map((wt) => wt.name),
      ]);

      for (let i = 0; i < config.agents.length; i++) {
        const agent = config.agents[i]!;

        if (typeof agent.id !== "string" || !agent.id) {
          errors.push({ field: `agents[${i}].id`, message: "must be a non-empty string" });
        } else {
          if (seenAgentIds.has(agent.id)) {
            errors.push({ field: `agents[${i}].id`, message: `duplicate agent ID: "${agent.id}"` });
          }
          seenAgentIds.add(agent.id);
        }

        if (typeof agent.name !== "string" || !agent.name) {
          errors.push({ field: `agents[${i}].name`, message: "must be a non-empty string" });
        }
        if (typeof agent.role !== "string" || !agent.role) {
          errors.push({ field: `agents[${i}].role`, message: "must be a non-empty string" });
        }
        if (typeof agent.goal !== "string" || !agent.goal) {
          errors.push({ field: `agents[${i}].goal`, message: "must be a non-empty string" });
        }

        // Agent tools must be subset of tenant tools + webhookTools
        if (agent.tools && allToolNames.size > 0) {
          for (let j = 0; j < agent.tools.length; j++) {
            if (!allToolNames.has(agent.tools[j]!)) {
              errors.push({
                field: `agents[${i}].tools[${j}]`,
                message: `tool "${agent.tools[j]}" is not in tenant tools or webhookTools`,
              });
            }
          }
        }
      }

      // Multi-agent requires routing
      if (config.agents.length > 1) {
        if (!config.routing) {
          errors.push({ field: "routing", message: "required when agents.length > 1" });
        }
      }

      // Validate routing
      if (config.routing) {
        if (typeof config.routing.fallback !== "string" || !config.routing.fallback) {
          errors.push({ field: "routing.fallback", message: "must be a non-empty string" });
        } else if (seenAgentIds.size > 0 && !seenAgentIds.has(config.routing.fallback)) {
          errors.push({ field: "routing.fallback", message: `references unknown agent: "${config.routing.fallback}"` });
        }

        if (config.routing.rules) {
          for (let i = 0; i < config.routing.rules.length; i++) {
            const rule = config.routing.rules[i]!;

            // Validate regex
            try {
              new RegExp(rule.match, "i");
            } catch {
              errors.push({ field: `routing.rules[${i}].match`, message: `invalid regex: "${rule.match}"` });
            }

            // Validate agent ref
            if (typeof rule.agent !== "string" || !rule.agent) {
              errors.push({ field: `routing.rules[${i}].agent`, message: "must be a non-empty string" });
            } else if (seenAgentIds.size > 0 && !seenAgentIds.has(rule.agent)) {
              errors.push({ field: `routing.rules[${i}].agent`, message: `references unknown agent: "${rule.agent}"` });
            }
          }
        }

        // rerouteAfterTurns: non-negative integer
        if (config.routing.rerouteAfterTurns !== undefined) {
          if (!Number.isInteger(config.routing.rerouteAfterTurns) || config.routing.rerouteAfterTurns < 0) {
            errors.push({ field: "routing.rerouteAfterTurns", message: "must be a non-negative integer" });
          }
        }

        // maxHandoffs: positive integer
        if (config.routing.maxHandoffs !== undefined) {
          if (!Number.isInteger(config.routing.maxHandoffs) || config.routing.maxHandoffs < 1) {
            errors.push({ field: "routing.maxHandoffs", message: "must be a positive integer" });
          }
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

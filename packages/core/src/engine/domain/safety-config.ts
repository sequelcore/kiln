// SafetyConfig types -- YAML configuration for enterprise safety (PII, content, rails)

export type PiiType = "email" | "phone" | "ssn" | "credit_card" | "ip_address" | "date_of_birth";

export type PiiAction = "detect" | "redact" | "block";

export interface PiiConfig {
  readonly detect: readonly PiiType[];
  readonly action: PiiAction;
  readonly allowlist?: readonly string[];
}

export type ContentCategory = "hate" | "violence" | "sexual" | "self_harm" | "harassment" | "misinformation";

export type ContentAction = "block" | "warn" | "log";

export interface ContentCategoryConfig {
  readonly threshold: number;
  readonly action: ContentAction;
}

export interface ContentConfig {
  readonly enabled: boolean;
  readonly categories: Partial<Record<ContentCategory, ContentCategoryConfig>>;
}

export type RailType = "topic" | "competitor" | "escalation" | "compliance";

export interface TopicRailConfig {
  readonly type: "topic";
  readonly block?: readonly string[];
  readonly escalate?: readonly string[];
}

export interface CompetitorRailConfig {
  readonly type: "competitor";
  readonly competitors: readonly string[];
  readonly response: string;
}

export interface EscalationRailConfig {
  readonly type: "escalation";
  readonly triggers: readonly string[];
}

export interface ComplianceRailConfig {
  readonly type: "compliance";
  readonly required?: readonly string[];
  readonly forbid?: readonly string[];
}

export type RailConfig = TopicRailConfig | CompetitorRailConfig | EscalationRailConfig | ComplianceRailConfig;

export interface SafetyConfig {
  readonly pii?: PiiConfig;
  readonly content?: ContentConfig;
  readonly rails?: readonly RailConfig[];
}

export interface SafetyValidationError {
  readonly field: string;
  readonly message: string;
}

const VALID_PII_TYPES: readonly PiiType[] = ["email", "phone", "ssn", "credit_card", "ip_address", "date_of_birth"];
const VALID_PII_ACTIONS: readonly PiiAction[] = ["detect", "redact", "block"];
const VALID_CONTENT_ACTIONS: readonly ContentAction[] = ["block", "warn", "log"];
const VALID_CONTENT_CATEGORIES: readonly ContentCategory[] = ["hate", "violence", "sexual", "self_harm", "harassment", "misinformation"];

export function validateSafetyConfig(config: SafetyConfig): SafetyValidationError[] {
  const errors: SafetyValidationError[] = [];

  if (config.pii) {
    const pii = config.pii;

    if (!Array.isArray(pii.detect) || pii.detect.length === 0) {
      errors.push({ field: "pii.detect", message: "must be a non-empty array" });
    } else {
      for (let i = 0; i < pii.detect.length; i++) {
        if (!VALID_PII_TYPES.includes(pii.detect[i]!)) {
          errors.push({ field: `pii.detect[${i}]`, message: `must be one of: ${VALID_PII_TYPES.join(", ")}` });
        }
      }
    }

    if (!pii.action) {
      errors.push({ field: "pii.action", message: "required" });
    } else if (!VALID_PII_ACTIONS.includes(pii.action)) {
      errors.push({ field: "pii.action", message: `must be one of: ${VALID_PII_ACTIONS.join(", ")}` });
    }
  }

  if (config.content) {
    const content = config.content;

    for (const category of VALID_CONTENT_CATEGORIES) {
      const catConfig = content.categories[category];
      if (catConfig) {
        if (typeof catConfig.threshold !== "number" || catConfig.threshold < 0 || catConfig.threshold > 1) {
          errors.push({ field: `content.categories.${category}.threshold`, message: "must be a number between 0 and 1" });
        }
        if (!VALID_CONTENT_ACTIONS.includes(catConfig.action)) {
          errors.push({ field: `content.categories.${category}.action`, message: `must be one of: ${VALID_CONTENT_ACTIONS.join(", ")}` });
        }
      }
    }
  }

  if (config.rails) {
    for (let i = 0; i < config.rails.length; i++) {
      const rail = config.rails[i]!;

      if (rail.type === "topic") {
        if ((!rail.block || rail.block.length === 0) && (!rail.escalate || rail.escalate.length === 0)) {
          errors.push({ field: `rails[${i}]`, message: "topic rail must have at least 'block' or 'escalate'" });
        }
      } else if (rail.type === "competitor") {
        if (!Array.isArray(rail.competitors) || rail.competitors.length === 0) {
          errors.push({ field: `rails[${i}].competitors`, message: "must be a non-empty array" });
        }
        if (!rail.response || typeof rail.response !== "string" || rail.response.trim() === "") {
          errors.push({ field: `rails[${i}].response`, message: "must be a non-empty string" });
        }
      } else if (rail.type === "escalation") {
        if (!Array.isArray(rail.triggers) || rail.triggers.length === 0) {
          errors.push({ field: `rails[${i}].triggers`, message: "must be a non-empty array" });
        }
      } else if (rail.type === "compliance") {
        if ((!rail.required || rail.required.length === 0) && (!rail.forbid || rail.forbid.length === 0)) {
          errors.push({ field: `rails[${i}]`, message: "compliance rail must have at least 'required' or 'forbid'" });
        }
      } else {
        errors.push({ field: `rails[${i}].type`, message: `unknown rail type: ${(rail as { type: string }).type}` });
      }
    }
  }

  return errors;
}

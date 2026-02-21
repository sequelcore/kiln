// Error catalog: maps KilnErrorCode to developer-friendly suggestions and doc links
// Pure functions -- no side effects, no external dependencies

import type { KilnErrorCode } from "./errors.js";

export interface ErrorSuggestion {
  readonly suggestion: string;
  readonly docUrl?: string;
}

function docUrl(code: KilnErrorCode): string {
  return `https://kilnai.dev/docs/errors/${code.toLowerCase().replace(/_/g, "-")}`;
}

/** Returns a developer-friendly suggestion and doc link for a given error code. */
export function getErrorSuggestion(
  code: KilnErrorCode,
  context?: Record<string, unknown>,
): ErrorSuggestion {
  switch (code) {
    case "APP_YAML_INVALID":
      return {
        suggestion:
          "Check your app.yaml syntax. Ensure all required fields (name, teams, router) are present.",
        docUrl: docUrl(code),
      };

    case "PRESET_LOAD_FAILED":
      return {
        suggestion:
          "The app configuration could not be loaded. Verify the YAML file exists and is valid.",
        docUrl: docUrl(code),
      };

    case "GATEWAY_YAML_INVALID":
      return {
        suggestion:
          "Check your gateway.yaml syntax. Ensure port and apps[] are configured correctly.",
        docUrl: docUrl(code),
      };

    case "MODE_B_CONFIG_INVALID":
      return {
        suggestion:
          "Check Mode B configuration. Ensure provider name, model, and apiKeyEnv are set.",
        docUrl: docUrl(code),
      };

    case "DOMAIN_YAML_INVALID":
      return {
        suggestion:
          "Check your domain.yaml syntax. Required fields: name, displayName, detectPatterns, toolTags, qualityGates.",
        docUrl: docUrl(code),
      };

    case "DOMAIN_KIT_INVALID":
      return {
        suggestion:
          "The domain kit file is invalid. Ensure it follows the DomainYaml schema.",
        docUrl: docUrl(code),
      };

    case "TENANT_NOT_FOUND": {
      const tenantId = context?.tenantId;
      const base =
        "The specified tenant was not found. Use the admin API to list available tenants.";
      return {
        suggestion: tenantId ? `${base} Tenant ID: ${tenantId}` : base,
        docUrl: docUrl(code),
      };
    }

    case "TENANT_VALIDATION_FAILED":
      return {
        suggestion:
          "Tenant configuration is invalid. Check required fields: id, appId, name.",
        docUrl: docUrl(code),
      };

    case "PROVIDER_UNAVAILABLE":
      return {
        suggestion:
          "The LLM provider is not responding. Check your network connection and try again.",
        docUrl: docUrl(code),
      };

    case "PROVIDER_RATE_LIMITED": {
      let suggestion =
        "Rate limited by the LLM provider. Wait a moment and retry.";
      if (context?.provider === "anthropic") {
        suggestion += " Check your Anthropic usage dashboard.";
      }
      return { suggestion, docUrl: docUrl(code) };
    }

    case "PROVIDER_AUTH_FAILED": {
      let suggestion: string;
      switch (context?.provider) {
        case "anthropic":
          suggestion = "Set ANTHROPIC_API_KEY environment variable.";
          break;
        case "openai":
          suggestion = "Set OPENAI_API_KEY environment variable.";
          break;
        case "deepseek":
          suggestion = "Set DEEPSEEK_API_KEY environment variable.";
          break;
        default:
          suggestion = "Check your API key configuration.";
      }
      return { suggestion, docUrl: docUrl(code) };
    }

    case "BUDGET_CHECK_FAILED":
      return {
        suggestion:
          "Budget check failed. Verify billing configuration in your gateway.yaml.",
        docUrl: docUrl(code),
      };

    case "BUDGET_EXCEEDED":
      return {
        suggestion:
          "Token budget exceeded. Increase the budget limit in billing config or optimize your prompts.",
        docUrl: docUrl(code),
      };

    case "CONFIG_MISSING_ENV": {
      const envVar = context?.envVar;
      const base = "Required environment variable is missing.";
      return {
        suggestion: envVar ? `${base} Set ${envVar} in your environment.` : base,
        docUrl: docUrl(code),
      };
    }

    case "CONFIG_INVALID":
      return {
        suggestion:
          "Configuration is invalid. Check the relevant YAML file for syntax errors.",
        docUrl: docUrl(code),
      };

    case "CIRCUIT_OPEN":
      return {
        suggestion:
          "Service circuit breaker is open due to repeated failures. The service will retry automatically.",
        docUrl: docUrl(code),
      };

    case "GUARDRAIL_FAILED":
      return {
        suggestion:
          "Structured output failed validation. The agent's response did not match the expected schema.",
        docUrl: docUrl(code),
      };

    case "STRUCTURED_OUTPUT_INVALID":
      return {
        suggestion:
          "The LLM returned output that doesn't match the JSON schema. Try simplifying the schema or using a more capable model.",
        docUrl: docUrl(code),
      };

    case "HANDOFF_FAILED":
      return {
        suggestion:
          "Agent handoff failed. Verify that the target agent exists and can accept handoffs.",
        docUrl: docUrl(code),
      };

    case "INTERRUPT_TIMEOUT":
      return {
        suggestion:
          "The interrupt timed out waiting for external input. Resume the session or increase the timeout.",
        docUrl: docUrl(code),
      };

    case "INJECTION_DETECTED":
      return {
        suggestion:
          "Potential prompt injection detected in user input. The input was blocked for safety.",
        docUrl: docUrl(code),
      };

    case "GUARDIAN_BLOCKED":
      return {
        suggestion:
          "Guardian review blocked a destructive operation. Review the capability's risk level.",
        docUrl: docUrl(code),
      };

    case "GUARDIAN_UNAVAILABLE":
      return {
        suggestion:
          "Guardian review service is unavailable. Destructive operations are blocked until the Guardian is reachable.",
        docUrl: docUrl(code),
      };

    case "SECRET_DECRYPTION_FAILED":
      return {
        suggestion:
          "Failed to decrypt a secret. The encryption key may have changed. Try rotating keys.",
        docUrl: docUrl(code),
      };

    case "SECRET_NOT_FOUND":
      return {
        suggestion:
          "The requested secret was not found in the secret store.",
        docUrl: docUrl(code),
      };

    case "AUDIT_WRITE_FAILED":
      return {
        suggestion:
          "Failed to write audit log entry. Check file permissions on the audit log path.",
        docUrl: docUrl(code),
      };

    case "AUDIT_CHAIN_BROKEN":
      return {
        suggestion:
          "Audit log hash chain verification failed. The log may have been tampered with.",
        docUrl: docUrl(code),
      };

    case "TENANT_ISOLATION_VIOLATED":
      return {
        suggestion:
          "A tenant isolation boundary was violated. This is a security event.",
        docUrl: docUrl(code),
      };

    case "UNAUTHORIZED":
      return {
        suggestion:
          "Authentication required. Provide a valid API key or token.",
        docUrl: docUrl(code),
      };

    case "FORBIDDEN":
      return {
        suggestion: "You don't have permission to perform this action.",
        docUrl: docUrl(code),
      };

    case "RATE_LIMIT_EXCEEDED":
      return {
        suggestion: "Too many requests. Wait before trying again.",
        docUrl: docUrl(code),
      };

    case "SKILL_YAML_INVALID":
      return {
        suggestion:
          "The skill YAML file is invalid. Ensure it follows the skill schema with required fields: name, description, steps.",
        docUrl: docUrl(code),
      };

    case "SKILL_NOT_FOUND":
      return {
        suggestion:
          "The requested skill was not found. Check the skill name and ensure it is registered.",
        docUrl: docUrl(code),
      };

    case "PACKAGE_YAML_INVALID":
      return {
        suggestion:
          "The package YAML is invalid. Ensure it has type (\"domain\" or \"skill\"), version, and author fields.",
        docUrl: docUrl(code),
      };

    case "TRIGGER_FAILED":
      return {
        suggestion:
          "A trigger failed to execute. Check the trigger configuration and target team.",
        docUrl: docUrl(code),
      };

    case "WEBHOOK_VALIDATION_FAILED":
      return {
        suggestion:
          "Webhook signature validation failed. Verify the HMAC secret matches the sender's configuration.",
        docUrl: docUrl(code),
      };

    case "SCHEDULE_PARSE_FAILED":
      return {
        suggestion:
          "Invalid cron expression. Use 5-field format: minute hour day-of-month month day-of-week (e.g., \"0 2 * * *\").",
        docUrl: docUrl(code),
      };

    case "EVAL_YAML_INVALID":
      return {
        suggestion:
          "Check your eval.yaml against the schema. Ensure datasets, scorers, and experiments are all valid.",
        docUrl: docUrl(code),
      };

    case "EVAL_DATASET_NOT_FOUND":
      return {
        suggestion:
          "Verify the dataset JSONL file exists and each line is valid JSON with 'id' and 'input' fields.",
        docUrl: docUrl(code),
      };

    case "EVAL_SCORER_FAILED":
      return {
        suggestion:
          "Check scorer configuration. LLM scorers require a ScorerLLM instance.",
        docUrl: docUrl(code),
      };

    case "EVAL_EXPERIMENT_FAILED":
      return {
        suggestion:
          "Ensure the experiment references valid datasets and scorers.",
        docUrl: docUrl(code),
      };

    case "INTERNAL_ERROR":
      return {
        suggestion:
          "An unexpected internal error occurred. If this persists, please file an issue.",
        docUrl: docUrl(code),
      };
  }
}

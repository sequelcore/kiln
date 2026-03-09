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

    case "SKILL_MD_INVALID":
      return {
        suggestion:
          "Invalid skill file (SKILL.md). Use YAML frontmatter (---) with required fields: name, description. The markdown body provides instructions.",
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

    case "EVAL_DATASET_INVALID":
      return {
        suggestion:
          "The dataset file exists but has invalid content. Check JSON syntax and ensure all entries have 'id' and 'input' fields.",
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

    case "A2A_INVALID_REQUEST":
      return {
        suggestion:
          "The incoming A2A JSON-RPC request is malformed. Check the request body against the A2A specification.",
        docUrl: docUrl(code),
      };

    case "A2A_TASK_NOT_FOUND":
      return {
        suggestion:
          "The requested A2A task ID does not exist. Tasks are ephemeral and may have been cleaned up.",
        docUrl: docUrl(code),
      };

    case "A2A_TASK_FAILED":
      return {
        suggestion:
          "The A2A task failed during execution. Check the target team and orchestrator logs.",
        docUrl: docUrl(code),
      };

    case "A2A_CLIENT_FAILED":
      return {
        suggestion:
          "Failed to communicate with a remote A2A agent. Verify the agent URL and network connectivity.",
        docUrl: docUrl(code),
      };

    case "MCP_CONNECTION_FAILED":
      return {
        suggestion:
          "Cannot connect to MCP server. Check the server URL/command and ensure the server is running.",
        docUrl: docUrl(code),
      };

    case "MCP_DISCOVERY_FAILED":
      return {
        suggestion:
          "Failed to discover tools from MCP server. The server may not implement tools/list correctly.",
        docUrl: docUrl(code),
      };

    case "MCP_SERVER_ERROR":
      return {
        suggestion:
          "The MCP server returned an error. Check server logs for details.",
        docUrl: docUrl(code),
      };

    case "TOOL_RAG_FAILED":
      return {
        suggestion:
          "Tool retrieval failed. Check the embedding adapter configuration and vector store availability.",
        docUrl: docUrl(code),
      };

    case "UNSUPPORTED_MODALITY": {
      const modality = context?.modality;
      const provider = context?.provider;
      let suggestion = "The requested content modality is not supported by the provider.";
      if (modality && provider) {
        suggestion = `${provider} does not support "${modality}" content. Use a provider that supports this modality or remove it from the agent's modalities.`;
      }
      return { suggestion, docUrl: docUrl(code) };
    }

    case "CONTENT_PART_INVALID":
      return {
        suggestion:
          "A content part is invalid. Binary parts (image, audio, file) must have exactly one of 'data' or 'url'.",
        docUrl: docUrl(code),
      };

    case "VOICE_CONFIG_INVALID":
      return {
        suggestion:
          "Voice configuration is invalid. Check STT/TTS provider settings and ensure required fields (provider, apiKeyEnv) are set.",
        docUrl: docUrl(code),
      };

    case "STT_FAILED":
      return {
        suggestion:
          "Speech-to-text transcription failed. Check the audio format, API key, and provider availability.",
        docUrl: docUrl(code),
      };

    case "TTS_FAILED":
      return {
        suggestion:
          "Text-to-speech synthesis failed. Check the TTS provider configuration and API key.",
        docUrl: docUrl(code),
      };

    case "ENRICHMENT_FAILED":
      return {
        suggestion:
          "Contextual enrichment failed for one or more chunks. Check the LLM provider configuration and API key in chunking.contextual.",
        docUrl: docUrl(code),
      };

    case "SOURCE_NOT_FOUND": {
      const sourceId = context?.sourceId;
      const base = "The specified knowledge source was not found.";
      return {
        suggestion: sourceId ? `${base} Source ID: ${sourceId}` : base,
        docUrl: docUrl(code),
      };
    }

    case "SOURCE_EXTRACTION_FAILED": {
      const uri = context?.uri;
      let suggestion = "Failed to extract content from the knowledge source.";
      if (uri) {
        suggestion += ` URI: ${uri}. Check the file path or URL and ensure it is accessible.`;
      }
      return { suggestion, docUrl: docUrl(code) };
    }

    case "SOURCE_ALREADY_EXISTS":
      return {
        suggestion:
          "A knowledge source with this name already exists for this app. Use a different name or remove the existing source first.",
        docUrl: docUrl(code),
      };

    case "CONTACT_MEMORY_EXTRACTION_FAILED":
      return {
        suggestion:
          "Contact memory fact extraction failed. Check the LLM provider configuration and API key in knowledge.contactMemory.",
        docUrl: docUrl(code),
      };

    case "TOOL_AUTHORIZATION_DENIED": {
      const toolName = context?.toolName;
      let suggestion = "Tool execution was denied by the authorization policy.";
      if (toolName) {
        suggestion += ` Tool: "${toolName}". Check the capability's annotations (readOnly, destructive) and the authorization policy.`;
      }
      return { suggestion, docUrl: docUrl(code) };
    }

    case "TOOL_EXECUTION_TIMEOUT": {
      const toolName = context?.toolName;
      const timeoutMs = context?.timeoutMs;
      let suggestion = "Tool execution timed out.";
      if (toolName) suggestion += ` Tool: "${toolName}".`;
      if (timeoutMs) suggestion += ` Timeout: ${timeoutMs}ms.`;
      suggestion += " Increase the timeout in the capability's retry config or optimize the tool.";
      return { suggestion, docUrl: docUrl(code) };
    }

    case "TOOL_RETRY_EXHAUSTED": {
      const toolName = context?.toolName;
      const attempts = context?.attempts;
      let suggestion = "Tool execution failed after all retry attempts.";
      if (toolName) suggestion += ` Tool: "${toolName}".`;
      if (attempts) suggestion += ` Attempts: ${attempts}.`;
      suggestion += " Check the tool's health and the retry config in the capability.";
      return { suggestion, docUrl: docUrl(code) };
    }

    case "TOOL_RESULT_SANITIZED":
      return {
        suggestion:
          "A tool result was sanitized or blocked by the safety pipeline. The result may contain PII or policy-violating content. Review the safety config.",
        docUrl: docUrl(code),
      };

    case "TOOL_RATE_LIMITED": {
      const toolName = context?.toolName;
      let suggestion = "Tool call rate limit exceeded.";
      if (toolName) suggestion += ` Tool: "${toolName}".`;
      suggestion += " Wait before retrying or adjust rate limits in tenant toolConfig.";
      return { suggestion, docUrl: docUrl(code) };
    }

    case "WEBHOOK_TOOL_FAILED": {
      const toolName = context?.toolName;
      const url = context?.url;
      let suggestion = "Webhook tool execution failed.";
      if (toolName) suggestion += ` Tool: "${toolName}".`;
      if (url) suggestion += ` URL: ${url}.`;
      suggestion += " Check the webhook endpoint availability and response format.";
      return { suggestion, docUrl: docUrl(code) };
    }

    case "PII_DETECTED":
      return {
        suggestion:
          "Personally identifiable information was detected in the message. Configure allowlist in safety.pii.allowlist or adjust the action.",
        docUrl: docUrl(code),
      };

    case "CONTENT_POLICY_VIOLATED":
      return {
        suggestion:
          "Message content violated the content safety policy. Review the content categories and thresholds in safety.content.categories.",
        docUrl: docUrl(code),
      };

    case "SAFETY_RAIL_BLOCKED":
      return {
        suggestion:
          "A safety rail blocked the message. Check the rail configuration in safety.rails to adjust blocked topics or responses.",
        docUrl: docUrl(code),
      };

    case "SAFETY_SCAN_FAILED":
      return {
        suggestion:
          "The safety scan encountered an error. This is non-fatal -- the pipeline uses fail-open behavior for deep scans.",
        docUrl: docUrl(code),
      };

    case "INVALID_SESSION_TRANSITION":
      return {
        suggestion:
          "The requested session mode transition is not allowed. Valid transitions: ai_active -> queued/human_active, queued -> human_active/ai_active, human_active -> ai_active/resolved, resolved -> ai_active.",
        docUrl: docUrl(code),
      };

    case "CONCURRENT_SESSION_MODIFICATION":
      return {
        suggestion:
          "The session was modified by another request between read and save. Retry the operation. This typically happens when two handoff or message requests target the same session simultaneously.",
        docUrl: docUrl(code),
      };

    case "ROUTING_FAILED":
      return {
        suggestion:
          "Multi-agent routing failed. Verify routing rules and fallback agent ID in tenant config.",
        docUrl: docUrl(code),
      };

    case "ROUTING_AGENT_NOT_FOUND":
      return {
        suggestion:
          "Routing resolved to an agent ID that doesn't exist. Verify agents[] and routing config.",
        docUrl: docUrl(code),
      };

    case "AGENT_RAG_FAILED":
      return {
        suggestion:
          "Agent retrieval failed. Check the embedding adapter configuration and vector store availability.",
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

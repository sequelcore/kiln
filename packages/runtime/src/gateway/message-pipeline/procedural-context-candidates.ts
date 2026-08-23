// Extracted from the gateway message pipeline; behavior is intentionally unchanged.
import type {
  ContentPart,
  ContextCandidate
} from "@kilnai/core";
import {
  extractText,
  textParts
} from "@kilnai/core";
import type {
  PerCallToolConfig,
  ToolExecutionSummary
} from "../../session/runtime-session-orchestrator.js";
import {
  describeEffectiveTurnAuthorityActionability,
  formatEffectiveTurnAuthorityGuidance,
  projectEffectiveTurnAuthorityPerCallConfig
} from "../../session/effective-turn-authority.js";
import type {
  OperatorExecutionMode,
  OperatorTurnRequestedAuthority
} from "@kilnai/gateway-contracts";
import {
  authorityFromCapability
} from "../tool-authority.js";
import {
  readExecutionToolAllowlist,
  readExecutionTurnAuthority,
} from "../../session/effective-authority-admission-bundle.js";

const WEB_TOOL_NAMES = ["web_search", "web_fetch", "web_extract"] as const;

export function buildAuthorityGuidanceContextCandidate(perCallConfig: PerCallToolConfig | undefined, input: {
  readonly executionMode: OperatorExecutionMode;
  readonly requestedAuthority: import("@kilnai/core").EffectiveTurnAuthoritySnapshot["requestedAuthority"] | undefined;
}): ContextCandidate {
  return {
    kind: "procedural",
    modelFacingSemantics: "directive",
    source: "runtime-authority-guidance",
    required: true,
    score: 1,
    content: formatEffectiveTurnAuthorityGuidance(describeEffectiveTurnAuthorityActionability({
      authority: readExecutionTurnAuthority(perCallConfig),
      executionMode: input.executionMode,
      requestedAuthority: input.requestedAuthority,
    })),
  };
}

export function buildGovernedWorkCloseoutContextCandidate(): ContextCandidate {
  return {
    kind: "procedural",
    modelFacingSemantics: "directive",
    source: "runtime-governed-work-closeout",
    required: true,
    score: 1,
    content: [
      "Governed work closeout:",
      "Use shared work tools for operator-requested implementation, refactoring, mutation, commit, or other executable governed work.",
      "Materialize governed work with the shared work tools, then either start execution, finish execution, complete the work item, submit a structured plan when planning is the terminal deliverable, or record a concrete pending pause requirement.",
      "After a successful managed_agent.invoke for an open work item, continue with the same work item until it is started, finished, completed, or explicitly blocked with a pause requirement.",
      "A pending, in_progress, or blocked work item without terminal closeout projects as failed in CLI, TUI, and GUI.",
    ].join("\n"),
  };
}

export function buildGovernedWorkMaterializationContextCandidate(
  requirement: NonNullable<PerCallToolConfig["governedWorkRequirement"]>,
): ContextCandidate {
  return {
    kind: "procedural",
    modelFacingSemantics: "directive",
    source: "runtime-governed-work-requirement",
    required: true,
    score: 1,
    content: [
      "[KILN GOVERNED WORK REQUIREMENT]",
      `Before any repository inspection or execution, materialize exactly ${requirement.requiredWorkItemCount} distinct governed work items with work_item.update.`,
      "Then call goal.create and link exactly those work-item ids; runtime turn context supplies canonical operator provenance.",
      "The runtime supplies ownerSessionId and operatorTurnId. Repository, shell, web, managed-agent, and execution tools remain blocked until the goal is created.",
    ].join("\n"),
  };
}

export function buildWebSourceAttributionContextCandidate(): ContextCandidate {
  return {
    kind: "procedural",
    modelFacingSemantics: "directive",
    source: "runtime-web-source-attribution",
    required: true,
    score: 1,
    content: [
      "Web source attribution:",
      "When web_search, web_fetch, or web_extract informs the answer, include a final sources section with the exact source URLs used.",
      "Do not rely on tool artifacts as the only citation surface; user-facing answers must carry the relevant URLs directly.",
    ].join("\n"),
  };
}

export function hasWebToolAvailable(perCallConfig: PerCallToolConfig | undefined): boolean {
  const toolNames = new Set<string>([
    ...(readExecutionToolAllowlist(perCallConfig) ? Array.from(readExecutionToolAllowlist(perCallConfig)!) : []),
    ...(perCallConfig?.additionalTools?.map((tool) => tool.name) ?? []),
    ...(perCallConfig?.perCallCapabilities ? Array.from(perCallConfig.perCallCapabilities.keys()) : []),
  ]);
  return WEB_TOOL_NAMES.some((toolName) => toolNames.has(toolName));
}

export function shouldIncludeGovernedWorkCloseoutContext(userText: string): boolean {
  const normalized = userText.toLocaleLowerCase();
  return [
    /\b(implement|fix|fixes|fixing|patch|edit|modify|change|refactor|commit|build|write tests|add tests|delete|remove)\b/u,
    /\b(implementa|corrige|arregla|edita|modifica|cambia|refactoriza|comitea|construye|borra|elimina)\b/u,
  ].some((pattern) => pattern.test(normalized));
}

export function appendWebSourceAttributionIfMissing(
  parts: readonly ContentPart[],
  toolExecutions: readonly ToolExecutionSummary[] | undefined,
): readonly ContentPart[] {
  const responseText = extractText(parts);
  if (!responseText.trim()) {
    return parts;
  }

  const sources = collectWebAttributionSources(toolExecutions);
  if (sources.length === 0) {
    return parts;
  }
  if (sources.some((source) => responseText.includes(source.url))) {
    return parts;
  }

  const attribution = [
    "",
    "## Fuentes",
    "",
    ...sources.map((source) => `- ${source.title ? `${source.title}: ` : ""}${source.url}`),
  ].join("\n");

  let appended = false;
  const nextParts = parts.map((part) => {
    if (part.type !== "text" || appended) {
      return part;
    }
    appended = true;
    return { ...part, text: `${part.text.trimEnd()}${attribution}` };
  });

  return appended ? nextParts : textParts(attribution.trimStart());
}

function collectWebAttributionSources(
  toolExecutions: readonly ToolExecutionSummary[] | undefined,
): readonly { readonly title?: string; readonly url: string }[] {
  const sources: { title?: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const execution of toolExecutions ?? []) {
    if (!WEB_TOOL_NAMES.includes(execution.toolName as (typeof WEB_TOOL_NAMES)[number])) {
      continue;
    }
    for (const source of readWebSourcesFromExecution(execution)) {
      const normalizedUrl = normalizeAttributionUrl(source.url);
      if (!normalizedUrl || seen.has(normalizedUrl)) {
        continue;
      }
      seen.add(normalizedUrl);
      sources.push({
        ...(source.title ? { title: truncateAttributionTitle(source.title) } : {}),
        url: normalizedUrl,
      });
      if (sources.length >= 8) {
        return sources;
      }
    }
  }
  return sources;
}

function readWebSourcesFromExecution(
  execution: ToolExecutionSummary,
): readonly { readonly title?: string; readonly url: string }[] {
  const sources: { title?: string; url: string }[] = [];
  const metadata = execution.metadata;
  const metadataSources = Array.isArray(metadata?.["sources"]) ? metadata["sources"] : [];
  for (const source of metadataSources) {
    const record = readAttributionRecord(source);
    const url = readAttributionText(record?.["url"]);
    if (url) {
      const title = readAttributionText(record?.["title"]);
      sources.push({ ...(title ? { title } : {}), url });
    }
  }

  const metadataPages = Array.isArray(metadata?.["pages"]) ? metadata["pages"] : [];
  for (const page of metadataPages) {
    const record = readAttributionRecord(page);
    const url = readAttributionText(record?.["url"]);
    if (url) {
      const title = readAttributionText(record?.["title"]);
      sources.push({ ...(title ? { title } : {}), url });
    }
  }

  const metadataUrl = readAttributionText(metadata?.["url"]);
  if (metadataUrl) {
    sources.push({ url: metadataUrl });
  }

  if (sources.length > 0) {
    return sources;
  }

  return extractUrlsFromText(`${execution.output ?? ""}\n${execution.resultSummary ?? ""}`)
    .map((url) => ({ url }));
}

function readAttributionRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readAttributionText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractUrlsFromText(text: string): readonly string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s<>)\]]+/gi), (match) => match[0]);
}

function normalizeAttributionUrl(url: string): string | undefined {
  const trimmed = url.trim().replace(/[.,;:!?]+$/u, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function truncateAttributionTitle(title: string): string {
  const compact = title.replace(/\s+/gu, " ").trim();
  if (compact.length <= 120) {
    return compact;
  }
  return `${compact.slice(0, 117).trimEnd()}...`;
}

export function projectRequestedAuthorityPerCallConfig(
  config: PerCallToolConfig | undefined,
  executionMode: OperatorExecutionMode,
  requestedAuthority: OperatorTurnRequestedAuthority | undefined,
  reason: string,
): PerCallToolConfig | undefined {
  return projectEffectiveTurnAuthorityPerCallConfig({
    config,
    executionMode,
    requestedAuthority,
    reason,
    authorityDescriptorFromCapability: authorityFromCapability,
  });
}

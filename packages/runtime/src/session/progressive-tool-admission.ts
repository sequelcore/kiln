import type { ToolDefinition } from "@kilnai/core";

export type ProgressiveToolAdmissionDecision =
  | "admitted"
  | "already_materialized"
  | "outside_authority"
  | "not_found"
  | "not_materializable";

export interface ProgressiveToolAdmissionResult {
  readonly tools: readonly ToolDefinition[];
  readonly decision: ProgressiveToolAdmissionDecision;
}

export interface ProgressiveToolCatalogSearchMetadata {
  readonly kind: "catalog";
  readonly toolName: "tool_catalog_search";
  readonly operation: "search";
  readonly stale: false;
  readonly materializableToolName: string;
  readonly exact?: string;
  readonly resultCount?: number;
  readonly totalIndexed?: number;
  readonly includedSchemas?: boolean;
}

export function admitProgressiveTool(
  tools: readonly ToolDefinition[],
  materializableTools: ReadonlyMap<string, ToolDefinition>,
  turnToolAllowlist: ReadonlySet<string>,
  metadata: unknown,
): ProgressiveToolAdmissionResult {
  const catalogMetadata = readProgressiveToolCatalogSearchMetadata(metadata);
  if (!catalogMetadata) {
    return { tools, decision: "not_materializable" };
  }

  const toolName = catalogMetadata.materializableToolName;
  const canonicalTool = materializableTools.get(toolName);
  if (canonicalTool === undefined) {
    return { tools, decision: "not_found" };
  }

  if (!turnToolAllowlist.has(toolName)) {
    return { tools, decision: "outside_authority" };
  }

  if (tools.some((tool) => tool.name === toolName)) {
    return { tools, decision: "already_materialized" };
  }

  return { tools: [...tools, canonicalTool], decision: "admitted" };
}

export function readProgressiveToolCatalogSearchMetadata(
  metadata: unknown,
): ProgressiveToolCatalogSearchMetadata | undefined {
  if (typeof metadata !== "object" || metadata === null) {
    return undefined;
  }

  const candidate = metadata as Record<string, unknown>;
  if (!(candidate.kind === "catalog"
    && candidate.toolName === "tool_catalog_search"
    && candidate.operation === "search"
    && candidate.stale === false
    && typeof candidate.materializableToolName === "string")) {
    return undefined;
  }
  return {
    kind: "catalog",
    toolName: "tool_catalog_search",
    operation: "search",
    stale: false,
    materializableToolName: candidate.materializableToolName,
    ...(typeof candidate.exact === "string" ? { exact: candidate.exact } : {}),
    ...(typeof candidate.resultCount === "number" ? { resultCount: candidate.resultCount } : {}),
    ...(typeof candidate.totalIndexed === "number" ? { totalIndexed: candidate.totalIndexed } : {}),
    ...(typeof candidate.includedSchemas === "boolean" ? { includedSchemas: candidate.includedSchemas } : {}),
  };
}

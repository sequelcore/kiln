import { createHash } from "node:crypto";
import { getInvalidToolInputDetails } from "@kilnai/core/agents";
import type { TurnProgressEvidence } from "@kilnai/core/agents";
import { readProgressiveToolCatalogSearchMetadata } from "./progressive-tool-admission.js";
import type { ToolExecutionSummary } from "./runtime-session-orchestrator.types.js";

const MAX_FINGERPRINT_TEXT_LENGTH = 256;
const MAX_FINGERPRINT_DEPTH = 4;
const MAX_FINGERPRINT_ENTRIES = 32;
const MAX_FINGERPRINT_ITEMS = 24;
const OUTPUT_METADATA_KEYS = new Set([
  "content",
  "output",
  "raw",
  "rawoutput",
  "result",
  "resultvalue",
  "durationms",
  "timestamp",
  "observedat",
  "toolcallid",
  "requestid",
]);

/** The execution records and explicit non-execution outcomes for one model batch. */
export interface RuntimeTurnProgressBatch {
  readonly executions: readonly ToolExecutionSummary[];
  readonly invalidToolCallIds?: readonly string[];
  readonly blockedToolCallIds?: readonly string[];
}

/**
 * Pure, turn-local tool progress classifier.
 *
 * Construct one instance for each turn. It records only material-result
 * identity and progress/no-progress evidence; it cannot establish completion.
 */
export class RuntimeTurnProgressClassifier {
  readonly #seenSuccessfulMaterialFingerprints = new Set<string>();
  readonly #chronologicalEvidence: TurnProgressEvidence[] = [];

  classify(batch: RuntimeTurnProgressBatch): TurnProgressEvidence {
    const invalidToolCallIds = uniqueStrings(batch.invalidToolCallIds ?? []);
    const blockedToolCallIds = uniqueStrings(batch.blockedToolCallIds ?? []);
    const executionIds = new Set(
      batch.executions.flatMap((execution) => execution.toolCallId === undefined ? [] : [execution.toolCallId]),
    );
    const invalidToolCallIdSet = new Set(invalidToolCallIds);
    const blockedToolCallIdSet = new Set(blockedToolCallIds);

    const classifications = batch.executions.map((execution) => this.#classifyExecution(
      execution,
      invalidToolCallIdSet,
      blockedToolCallIdSet,
    ));
    this.#chronologicalEvidence.push(...classifications);

    const unrepresentedInvalidIds = invalidToolCallIds.filter((id) => !executionIds.has(id));
    if (unrepresentedInvalidIds.length > 0) {
      this.#chronologicalEvidence.push(buildBatchNoProgressEvidence("invalid_input", unrepresentedInvalidIds));
    }

    const unrepresentedBlockedIds = blockedToolCallIds.filter((id) => !executionIds.has(id));
    if (unrepresentedBlockedIds.length > 0) {
      this.#chronologicalEvidence.push(buildBatchNoProgressEvidence("blocked_batch", unrepresentedBlockedIds));
    }

    if (
      classifications.length === 0
      && unrepresentedInvalidIds.length === 0
      && unrepresentedBlockedIds.length === 0
    ) {
      throw new TypeError("A turn progress batch must include an execution or explicit invalid/blocked tool call IDs");
    }

    const progressEvidence = classifications.filter((evidence): evidence is ProgressEvidence => (
      evidence.kind === "progress"
    ));
    if (progressEvidence.length > 0) {
      return freezeProgressEvidence({
        kind: "progress",
        reason: "new_material_result",
        evidenceFingerprint: batchProgressFingerprint(progressEvidence),
        supportingToolCallIds: uniqueStrings(progressEvidence.flatMap((evidence) => evidence.supportingToolCallIds)),
      });
    }

    if (unrepresentedInvalidIds.length > 0 || classifications.some(isInvalidEvidence)) {
      const supportingToolCallIds = uniqueStrings([
        ...unrepresentedInvalidIds,
        ...classifications.filter(isInvalidEvidence).flatMap((evidence) => evidence.supportingToolCallIds),
      ]);
      return buildBatchNoProgressEvidence("invalid_input", supportingToolCallIds);
    }

    const firstClassification = classifications[0];
    if (firstClassification !== undefined) return firstClassification;

    return buildBatchNoProgressEvidence("blocked_batch", unrepresentedBlockedIds);
  }

  /** Evidence in the exact order in which this classifier observed it. */
  get chronologicalEvidence(): readonly TurnProgressEvidence[] {
    return Object.freeze([...this.#chronologicalEvidence]);
  }

  #classifyExecution(
    execution: ToolExecutionSummary,
    invalidToolCallIds: ReadonlySet<string>,
    blockedToolCallIds: ReadonlySet<string>,
  ): TurnProgressEvidence {
    const supportingToolCallIds = execution.toolCallId === undefined ? [] : [execution.toolCallId];
    const evidenceFingerprint = fingerprintExecution(execution);
    if (blockedToolCallIds.has(execution.toolCallId ?? "")) {
      return freezeNoProgressEvidence({
        kind: "no_progress",
        reason: "blocked_batch",
        strategyFingerprint: blockedExecutionStrategyFingerprint(execution),
        supportingToolCallIds,
      });
    }
    const invalidInputReason = invalidToolCallIds.has(execution.toolCallId ?? "")
      ? "invalid_tool_call_id"
      : readInvalidInputReason(execution);

    if (invalidInputReason !== undefined) {
      return freezeNoProgressEvidence({
        kind: "no_progress",
        reason: "invalid_input",
        strategyFingerprint: strategyFingerprint("invalid_input", execution, invalidInputReason),
        supportingToolCallIds,
      });
    }

    if (!execution.success) {
      return freezeNoProgressEvidence({
        kind: "no_progress",
        reason: "failed_execution",
        strategyFingerprint: strategyFingerprint("failed_execution", execution),
        supportingToolCallIds,
      });
    }

    if (isEmptyDiscovery(execution)) {
      return freezeNoProgressEvidence({
        kind: "no_progress",
        reason: "empty_discovery",
        strategyFingerprint: strategyFingerprint("empty_discovery", execution),
        supportingToolCallIds,
      });
    }

    if (execution.resultSummary.trim().length === 0) {
      return freezeNoProgressEvidence({
        kind: "no_progress",
        reason: "empty_result",
        strategyFingerprint: strategyFingerprint("empty_result", execution),
        supportingToolCallIds,
      });
    }

    if (this.#seenSuccessfulMaterialFingerprints.has(evidenceFingerprint)) {
      return freezeNoProgressEvidence({
        kind: "no_progress",
        reason: "repeated_result",
        strategyFingerprint: evidenceFingerprint,
        supportingToolCallIds,
      });
    }

    this.#seenSuccessfulMaterialFingerprints.add(evidenceFingerprint);
    return freezeProgressEvidence({
      kind: "progress",
      reason: "new_material_result",
      evidenceFingerprint,
      supportingToolCallIds,
    });
  }
}

type ProgressEvidence = Extract<TurnProgressEvidence, { readonly kind: "progress" }>;
type NoProgressEvidence = Extract<TurnProgressEvidence, { readonly kind: "no_progress" }>;
type NoProgressReason = NoProgressEvidence["reason"];

function isInvalidEvidence(evidence: TurnProgressEvidence): evidence is NoProgressEvidence {
  return evidence.kind === "no_progress" && evidence.reason === "invalid_input";
}

function isEmptyDiscovery(execution: ToolExecutionSummary): boolean {
  return execution.toolName.trim() === "tool_catalog_search"
    && readProgressiveToolCatalogSearchMetadata(execution.metadata)?.resultCount === 0;
}

function readInvalidInputReason(execution: ToolExecutionSummary): string | undefined {
  const inputReason = execution.input === undefined
    ? undefined
    : getInvalidToolInputDetails(execution.input)?.reason;
  if (inputReason !== undefined) return inputReason;

  return execution.metadata?.["errorCode"] === "invalid_input" ? "invalid_input" : undefined;
}

function fingerprintExecution(execution: ToolExecutionSummary): string {
  return sha256Digest({
    tool: execution.toolName.trim(),
    metadata: compactForFingerprint(execution.metadata),
    resultSummary: compactText(execution.resultSummary),
  });
}

function strategyFingerprint(reason: Exclude<NoProgressReason, "blocked_batch">, execution: ToolExecutionSummary, detail?: string): string {
  return sha256Digest({
    reason,
    tool: execution.toolName.trim(),
    detail: detail === undefined ? undefined : compactText(detail),
    metadata: compactForFingerprint(execution.metadata),
    resultSummary: compactText(execution.resultSummary),
  });
}

function blockedExecutionStrategyFingerprint(execution: ToolExecutionSummary): string {
  return sha256Digest({
    reason: "blocked_batch",
    tool: execution.toolName.trim(),
    metadata: compactForFingerprint(execution.metadata),
    resultSummary: compactText(execution.resultSummary),
  });
}

function buildBatchNoProgressEvidence(
  reason: NoProgressReason,
  supportingToolCallIds: readonly string[],
): NoProgressEvidence {
  return freezeNoProgressEvidence({
    kind: "no_progress",
    reason,
    strategyFingerprint: sha256Digest({
      reason,
      supportingToolCallIds: uniqueStrings(supportingToolCallIds),
    }),
    supportingToolCallIds: uniqueStrings(supportingToolCallIds),
  });
}

function batchProgressFingerprint(progressEvidence: readonly ProgressEvidence[]): string {
  return sha256Digest({
    kind: "new_material_result_batch",
    evidenceFingerprints: progressEvidence.map((evidence) => evidence.evidenceFingerprint).sort(compareCodeUnits),
  });
}

function sha256Digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

function freezeProgressEvidence(evidence: ProgressEvidence): ProgressEvidence {
  return Object.freeze({
    ...evidence,
    supportingToolCallIds: Object.freeze([...evidence.supportingToolCallIds]),
  });
}

function freezeNoProgressEvidence(evidence: NoProgressEvidence): NoProgressEvidence {
  return Object.freeze({
    ...evidence,
    supportingToolCallIds: Object.freeze([...evidence.supportingToolCallIds]),
  });
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function compactText(value: string): string {
  const compact = value.trim().replace(/\s+/gu, " ");
  return compact.length > MAX_FINGERPRINT_TEXT_LENGTH
    ? `${compact.slice(0, MAX_FINGERPRINT_TEXT_LENGTH)}...`
    : compact;
}

function compactForFingerprint(value: unknown, depth = 0, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return compactText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value !== "object") return String(value);
  if (depth >= MAX_FINGERPRINT_DEPTH) return "[depth-limit]";
  if (ancestors.has(value)) return "[cycle]";

  ancestors.add(value);
  let compact: unknown;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_FINGERPRINT_ITEMS).map((item) => compactForFingerprint(item, depth + 1, ancestors));
    compact = value.length > MAX_FINGERPRINT_ITEMS ? [...items, "[truncated]"] : items;
  } else {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !OUTPUT_METADATA_KEYS.has(key.toLowerCase()))
      .sort(([left], [right]) => compareCodeUnits(left, right));
    const selected = entries.slice(0, MAX_FINGERPRINT_ENTRIES);
    const record: Record<string, unknown> = {};
    for (const [key, item] of selected) {
      record[compactText(key)] = compactForFingerprint(item, depth + 1, ancestors);
    }
    if (entries.length > MAX_FINGERPRINT_ENTRIES) record["[truncated]"] = true;
    compact = record;
  }
  ancestors.delete(value);
  return compact;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  if (value === undefined) return "undefined";
  return JSON.stringify(value) ?? String(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

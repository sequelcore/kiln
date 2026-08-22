import { z } from "zod";
import {
  OperatorCockpitActionTargetSchema,
  type OperatorCockpitActionTarget,
} from "./operator-cockpit-target.js";

export const OPERATOR_RESOURCE_CONTENT_KINDS = [
  "text",
  "blob",
] as const;

export type OperatorResourceContentKind = typeof OPERATOR_RESOURCE_CONTENT_KINDS[number];

/**
 * Resource reads are an authority-scoped operation.  The session id is the
 * narrowest existing durable identity that lets a gateway select only the
 * committed turn surfaces belonging to the caller's logical session.
 */
const OperatorResourceReadTargetSchema = OperatorCockpitActionTargetSchema.extend({
  sessionId: z.string().min(1),
});

export const OperatorResourceReadRequestSchema = z.object({
  uri: z.string().min(1),
  target: OperatorResourceReadTargetSchema,
  cursor: z.string().min(1).optional(),
  limit: z.number().int().positive().optional(),
});

export type OperatorResourceReadRequest = z.infer<typeof OperatorResourceReadRequestSchema>;

export const OperatorResourceReadContentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    uri: z.string().min(1),
    mimeType: z.string().min(1).optional(),
    text: z.string(),
    meta: z.record(z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal("blob"),
    uri: z.string().min(1),
    mimeType: z.string().min(1).optional(),
    blob: z.string().min(1),
    meta: z.record(z.unknown()).optional(),
  }),
]);

export type OperatorResourceReadContent = z.infer<typeof OperatorResourceReadContentSchema>;

export const OperatorResourceReadSummarySchema = z.object({
  kind: z.string().min(1),
  totalCount: z.number().int().nonnegative().optional(),
  counts: z.record(z.number().int().nonnegative()).optional(),
  facets: z.record(z.array(z.string())).optional(),
  meta: z.record(z.unknown()).optional(),
});

export type OperatorResourceReadSummary = z.infer<typeof OperatorResourceReadSummarySchema>;

export const OperatorResourceReadResultSchema = z.object({
  uri: z.string().min(1),
  target: OperatorCockpitActionTargetSchema.optional(),
  summary: OperatorResourceReadSummarySchema.optional(),
  contents: z.array(OperatorResourceReadContentSchema),
  nextCursor: z.string().min(1).optional(),
});

export type OperatorResourceReadResult = z.infer<typeof OperatorResourceReadResultSchema>;

export interface OperatorResourceReadPresentationRow {
  readonly label: string;
  readonly value: number;
}

export interface OperatorResourceReadPresentationList {
  readonly label: string;
  readonly values: readonly string[];
}

export interface OperatorResourceReadPresentationMeta {
  readonly label: string;
  readonly value: unknown;
}

export interface OperatorResourceReadPresentation {
  readonly uri: string;
  readonly title: string;
  readonly total?: OperatorResourceReadPresentationRow;
  readonly counts: readonly OperatorResourceReadPresentationRow[];
  readonly facets: readonly OperatorResourceReadPresentationList[];
  readonly meta: readonly OperatorResourceReadPresentationMeta[];
  readonly contentCount: number;
  readonly hasMore: boolean;
}

export type OperatorResourceProviderReadResult = {
  readonly summary?: OperatorResourceReadSummary;
  readonly contents: readonly (
    | {
      readonly uri: string;
      readonly mimeType?: string;
      readonly text: string;
      readonly _meta?: Record<string, unknown>;
    }
    | {
      readonly uri: string;
      readonly mimeType?: string;
      readonly blob: string;
      readonly _meta?: Record<string, unknown>;
    }
  )[];
  readonly nextCursor?: string;
};

export function projectOperatorResourceReadResult(input: {
  readonly uri: string;
  readonly target?: OperatorCockpitActionTarget;
  readonly readResult: OperatorResourceProviderReadResult;
}): OperatorResourceReadResult {
  return OperatorResourceReadResultSchema.parse({
    uri: input.uri,
    ...(input.target ? { target: input.target } : {}),
    ...(input.readResult.summary ? { summary: input.readResult.summary } : {}),
    contents: input.readResult.contents.map(projectOperatorResourceContent),
    ...(input.readResult.nextCursor ? { nextCursor: input.readResult.nextCursor } : {}),
  });
}

export function projectOperatorResourceReadPresentation(
  result: OperatorResourceReadResult,
): OperatorResourceReadPresentation | undefined {
  if (!result.summary) {
    return undefined;
  }
  return {
    uri: result.uri,
    title: result.summary.kind,
    ...(result.summary.totalCount !== undefined
      ? { total: { label: "total", value: result.summary.totalCount } }
      : {}),
    counts: sortedEntries(result.summary.counts ?? {}).map(([label, value]) => ({ label, value })),
    facets: sortedEntries(result.summary.facets ?? {}).map(([label, values]) => ({ label, values })),
    meta: sortedEntries(result.summary.meta ?? {}).map(([label, value]) => ({ label, value })),
    contentCount: result.contents.length,
    hasMore: result.nextCursor !== undefined,
  };
}

function projectOperatorResourceContent(
  content: OperatorResourceProviderReadResult["contents"][number],
): OperatorResourceReadContent {
  if ("blob" in content) {
    return {
      kind: "blob",
      uri: content.uri,
      ...(content.mimeType ? { mimeType: content.mimeType } : {}),
      blob: content.blob,
      ...(content._meta ? { meta: content._meta } : {}),
    };
  }
  return {
    kind: "text",
    uri: content.uri,
    ...(content.mimeType ? { mimeType: content.mimeType } : {}),
    text: content.text,
    ...(content._meta ? { meta: content._meta } : {}),
  };
}

function sortedEntries<T>(value: Record<string, T>): Array<[string, T]> {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right, "en"));
}

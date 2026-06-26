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

export const OperatorResourceReadRequestSchema = z.object({
  uri: z.string().min(1),
  target: OperatorCockpitActionTargetSchema.optional(),
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

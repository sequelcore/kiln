import { z } from "zod";

/** The first stable, harness-neutral ingress wire contract. */
export const HARNESS_INGRESS_PROTOCOL_VERSION = "1" as const;

/** Maximum UTF-16 code units allowed in any public text field. */
export const HARNESS_INGRESS_MAX_TEXT_LENGTH = 16_384;
/** Maximum parts accepted in one ingress frame. */
export const HARNESS_INGRESS_MAX_PARTS = 16;
/**
 * Maximum canonical base64 characters in an inline binary part (1 MiB decoded).
 * Inline data is intentionally bounded before any downstream decoding occurs.
 */
export const HARNESS_INGRESS_MAX_INLINE_DATA_LENGTH = 1_398_104;

export const HARNESS_INGRESS_REQUESTED_AUTHORITIES = [
  "auto",
  "read_only",
  "audited",
  "destructive",
] as const;

export const HARNESS_INGRESS_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

const identifier = z.string().regex(
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
  "must be a non-empty portable identifier",
);
const nonEmptyText = z.string().trim().min(1).max(HARNESS_INGRESS_MAX_TEXT_LENGTH);
const mimeType = z.string().regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/);
const artifactUri = z.string().regex(/^kiln:\/\/artifacts\/[A-Za-z0-9._~:/-]+$/);
const canonicalBase64 = z.string()
  .min(1)
  .max(HARNESS_INGRESS_MAX_INLINE_DATA_LENGTH)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);

const HarnessIngressTextPartSchema = z.object({
  type: z.literal("text"),
  text: nonEmptyText,
}).strict();

function safeBinaryPartSchema<T extends "image" | "audio" | "file">(type: T) {
  return z.object({
    type: z.literal(type),
    mimeType,
    data: canonicalBase64.optional(),
    artifactUri: artifactUri.optional(),
    ...(type === "audio" ? { durationMs: z.number().finite().nonnegative().optional() } : {}),
    ...(type === "file" ? { filename: nonEmptyText.optional() } : {}),
  }).strict().superRefine((part, context) => {
    if ((part.data === undefined) === (part.artifactUri === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${type} parts require exactly one of data or artifactUri`,
      });
    }
  });
}

/** Safe user-supplied subset of the core ContentPart representation. */
export const HarnessIngressContentPartSchema = z.union([
  HarnessIngressTextPartSchema,
  safeBinaryPartSchema("image"),
  safeBinaryPartSchema("audio"),
  safeBinaryPartSchema("file"),
]);

export type HarnessIngressContentPart = z.infer<typeof HarnessIngressContentPartSchema>;

const baseClientFrame = {
  protocolVersion: z.literal(HARNESS_INGRESS_PROTOCOL_VERSION),
  requestId: identifier,
  sessionId: identifier.optional(),
};

export const HarnessIngressTurnStartSchema = z.object({
  ...baseClientFrame,
  type: z.literal("turn_start"),
  content: nonEmptyText.optional(),
  parts: z.array(HarnessIngressContentPartSchema).min(1).max(HARNESS_INGRESS_MAX_PARTS).optional(),
  requestedAuthority: z.enum(HARNESS_INGRESS_REQUESTED_AUTHORITIES).optional(),
  reasoningEffort: z.enum(HARNESS_INGRESS_REASONING_EFFORTS).optional(),
}).strict().superRefine((frame, context) => {
  if ((frame.content === undefined) === (frame.parts === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "turn_start requires exactly one of content or parts",
    });
  }
});

export const HarnessIngressTurnCancelSchema = z.object({
  ...baseClientFrame,
  type: z.literal("turn_cancel"),
  turnId: identifier,
  reason: nonEmptyText.optional(),
}).strict();

export const HarnessIngressUntrustedClientFrameSchema = z.union([
  HarnessIngressTurnStartSchema,
  HarnessIngressTurnCancelSchema,
]);

export type HarnessIngressUntrustedClientFrame = z.infer<typeof HarnessIngressUntrustedClientFrameSchema>;
export const HarnessIngressTransportIdentitySchema = z.object({
  callerId: identifier,
  appName: identifier,
  userId: identifier,
  tenantId: identifier.optional(),
}).strict();

export type HarnessIngressTransportIdentity = z.infer<typeof HarnessIngressTransportIdentitySchema>;
export type HarnessIngressClientFrame = HarnessIngressUntrustedClientFrame & HarnessIngressTransportIdentity;

/**
 * Parses a payload received from a harness and adds caller identity supplied by
 * the authenticated transport. callerId is deliberately absent from the wire schema.
 */
export function parseHarnessIngressClientFrame(
  payload: unknown,
  trustedIdentity: unknown,
): HarnessIngressClientFrame {
  requirePlainData(payload);
  requirePlainData(trustedIdentity);
  const frame = HarnessIngressUntrustedClientFrameSchema.parse(payload);
  return { ...frame, ...HarnessIngressTransportIdentitySchema.parse(trustedIdentity) };
}

const baseServerFrame = {
  protocolVersion: z.literal(HARNESS_INGRESS_PROTOCOL_VERSION),
  requestId: identifier,
};

export const HarnessIngressTurnAcceptedSchema = z.object({
  ...baseServerFrame,
  type: z.literal("turn_accepted"),
  turnId: identifier,
  sessionId: identifier.optional(),
}).strict();

export const HarnessIngressTurnCancelResultSchema = z.object({
  ...baseServerFrame,
  type: z.literal("turn_cancel_result"),
  turnId: identifier,
  status: z.enum(["accepted", "not_active", "failed"]),
  reason: nonEmptyText.optional(),
}).strict();

export const HarnessIngressTurnCompletedSchema = z.object({
  ...baseServerFrame,
  type: z.literal("turn_completed"),
  turnId: identifier,
  sessionId: identifier,
  outcome: z.enum(["completed", "cancelled", "failed"]),
  content: nonEmptyText.optional(),
  parts: z.array(HarnessIngressContentPartSchema).min(1).max(HARNESS_INGRESS_MAX_PARTS).optional(),
}).strict().superRefine((frame, context) => {
  if (frame.content !== undefined && frame.parts !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "turn_completed cannot contain both content and parts",
    });
  }
});

export const HarnessIngressErrorSchema = z.object({
  ...baseServerFrame,
  type: z.literal("error"),
  code: z.enum(["invalid_request", "unauthorized", "unsupported", "unavailable", "internal"]),
  redacted: z.literal(true),
}).strict();

export const HarnessIngressServerFrameSchema = z.union([
  HarnessIngressTurnAcceptedSchema,
  HarnessIngressTurnCancelResultSchema,
  HarnessIngressTurnCompletedSchema,
  HarnessIngressErrorSchema,
]);

export type HarnessIngressServerFrame = z.infer<typeof HarnessIngressServerFrameSchema>;

export function parseHarnessIngressServerFrame(payload: unknown): HarnessIngressServerFrame {
  requirePlainData(payload);
  return HarnessIngressServerFrameSchema.parse(payload);
}

function requirePlainData(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) requirePlainData(item);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("Harness ingress payloads must be plain data objects.");
  }
  for (const nestedValue of Object.values(value)) requirePlainData(nestedValue);
}

export const EXECUTION_DATA_CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const;
export type ExecutionDataClassification = typeof EXECUTION_DATA_CLASSIFICATIONS[number];

export function defineExecutionDataClassification(value: unknown): ExecutionDataClassification {
  return classification(value, "dataClassification");
}

export interface ExecutionRouteDataPolicyEvidence {
  readonly providerId: string;
  readonly providerModelId: string;
  readonly dataUse: "not-used" | "service-operation";
  readonly trainingPosture: "prohibited" | "permitted";
  readonly retention: { readonly posture: "zero" | "bounded"; readonly days: number };
  readonly permittedMaximumClassification: ExecutionDataClassification;
  readonly permittedClassifications: readonly ExecutionDataClassification[];
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly sourceDigest: `sha256:${string}`;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export type ExecutionRouteDataPolicyReason =
  | "policy-admitted"
  | "missing-evidence"
  | "malformed-evidence"
  | "not-yet-current"
  | "expired-evidence"
  | "provider-mismatch"
  | "model-mismatch"
  | "classification-not-permitted";

export interface ExecutionRouteDataPolicyDecision {
  readonly status: "admitted" | "denied";
  readonly freshness: "current" | "missing" | "invalid" | "not-yet-current" | "expired";
  readonly reason: ExecutionRouteDataPolicyReason;
  readonly sourceRevision?: string;
  readonly sourceDigest?: `sha256:${string}`;
}

export function defineExecutionRouteDataPolicyEvidence(input: ExecutionRouteDataPolicyEvidence): ExecutionRouteDataPolicyEvidence {
  if (!input || typeof input !== "object") invalid("evidence is required");
  const providerId = canonical(input.providerId, "providerId");
  const providerModelId = required(input.providerModelId, "providerModelId");
  if (input.dataUse !== "not-used" && input.dataUse !== "service-operation") invalid("dataUse is invalid");
  if (input.trainingPosture !== "prohibited" && input.trainingPosture !== "permitted") invalid("trainingPosture is invalid");
  if (!input.retention || (input.retention.posture !== "zero" && input.retention.posture !== "bounded")) invalid("retention posture is invalid");
  if (!Number.isSafeInteger(input.retention.days) || input.retention.days < 0 || input.retention.days > 3650) invalid("retention days are invalid");
  if (input.retention.posture === "zero" && input.retention.days !== 0) invalid("zero retention requires 0 days");
  if (input.retention.posture === "bounded" && input.retention.days < 1) invalid("bounded retention requires at least 1 day");
  const maximum = classification(input.permittedMaximumClassification, "permittedMaximumClassification");
  if (!Array.isArray(input.permittedClassifications) || input.permittedClassifications.length === 0) invalid("permittedClassifications must be non-empty");
  const classifications = input.permittedClassifications.map((value, index) => classification(value, `permittedClassifications[${index}]`));
  if (new Set(classifications).size !== classifications.length) invalid("permittedClassifications must be unique");
  const maximumIndex = EXECUTION_DATA_CLASSIFICATIONS.indexOf(maximum);
  const expected = EXECUTION_DATA_CLASSIFICATIONS.slice(0, maximumIndex + 1);
  if (classifications.length !== expected.length || classifications.some((value, index) => value !== expected[index])) {
    invalid("permittedClassifications must be ordered and downward-closed through the maximum");
  }
  const sourceIdentity = canonical(input.sourceIdentity, "sourceIdentity");
  const sourceRevision = canonical(input.sourceRevision, "sourceRevision");
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.sourceDigest)) invalid("sourceDigest must be a sha256 digest");
  const observedAt = instant(input.observedAt, "observedAt");
  const expiresAt = instant(input.expiresAt, "expiresAt");
  if (expiresAt <= observedAt) invalid("expiresAt must be after observedAt");
  return deepFreeze({
    providerId, providerModelId, dataUse: input.dataUse, trainingPosture: input.trainingPosture,
    retention: { posture: input.retention.posture, days: input.retention.days },
    permittedMaximumClassification: maximum, permittedClassifications: classifications,
    sourceIdentity, sourceRevision, sourceDigest: input.sourceDigest,
    observedAt: input.observedAt, expiresAt: input.expiresAt,
  });
}

export function decideExecutionRouteDataPolicy(input: {
  readonly evidence?: ExecutionRouteDataPolicyEvidence;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly requestedClassification: ExecutionDataClassification;
  readonly now: Date;
}): ExecutionRouteDataPolicyDecision {
  if (!input.evidence) return denied("missing", "missing-evidence");
  let evidence: ExecutionRouteDataPolicyEvidence;
  try { evidence = defineExecutionRouteDataPolicyEvidence(input.evidence); }
  catch { return denied("invalid", "malformed-evidence"); }
  const proof = { sourceRevision: evidence.sourceRevision, sourceDigest: evidence.sourceDigest };
  const now = input.now.getTime();
  if (!Number.isFinite(now)) return { ...denied("invalid", "malformed-evidence"), ...proof };
  if (now < Date.parse(evidence.observedAt)) return { ...denied("not-yet-current", "not-yet-current"), ...proof };
  if (now >= Date.parse(evidence.expiresAt)) return { ...denied("expired", "expired-evidence"), ...proof };
  if (evidence.providerId !== input.providerId) return { ...denied("current", "provider-mismatch"), ...proof };
  if (evidence.providerModelId !== input.providerModelId) return { ...denied("current", "model-mismatch"), ...proof };
  if (!EXECUTION_DATA_CLASSIFICATIONS.includes(input.requestedClassification)
    || !evidence.permittedClassifications.includes(input.requestedClassification)) {
    return { ...denied("current", "classification-not-permitted"), ...proof };
  }
  return { status: "admitted", freshness: "current", reason: "policy-admitted", ...proof };
}

function denied(freshness: ExecutionRouteDataPolicyDecision["freshness"], reason: Exclude<ExecutionRouteDataPolicyReason, "policy-admitted">): ExecutionRouteDataPolicyDecision {
  return { status: "denied", freshness, reason };
}
function canonical(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) invalid(`${field} must be a canonical id`);
  return value;
}
function required(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(`${field} is required`);
  return value;
}
function instant(value: unknown, field: string): number {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid(`${field} must be an ISO timestamp`);
  return Date.parse(value);
}
function classification(value: unknown, field: string): ExecutionDataClassification {
  if (!EXECUTION_DATA_CLASSIFICATIONS.includes(value as ExecutionDataClassification)) invalid(`${field} is invalid`);
  return value as ExecutionDataClassification;
}
function invalid(message: string): never { throw new TypeError(`Execution route data policy ${message}.`); }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
}

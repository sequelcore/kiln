import { z } from "zod";
import { AvailableModelCatalogSchema } from "./available-models.js";
import { ExecutionRouteCatalogSchema } from "./execution-route.js";

const text = z.string().trim().min(1).max(512);
const canonical = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u);
const instant = z.string().datetime({ offset: true });
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const scheme = z.discriminatedUnion("kind", [z.object({ kind: z.literal("unit") }).strict(), z.object({ kind: z.literal("currency"), currency: canonical }).strict(), z.object({ kind: z.literal("credit"), creditSchemeId: canonical }).strict()]);
const amount = z.object({ atoms: z.string().regex(/^(?:0|[1-9][0-9]*)$/u), scale: z.number().int().min(0).max(30), unit: canonical, scheme }).strict();
const evidence = z.object({ sourceIdentity: text, sourceRevision: text, sourceDigest: digest, observedAt: instant, validUntil: instant, confidence: z.enum(["high", "medium", "low"]), authority: z.enum(["provider-reported", "configured", "calculated-estimate"]) }).strict();
const priceBase = { rateCardId: canonical, rateCardRevision: canonical, evidence };
const priceEvidence = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("subscription"), ...priceBase }).strict(),
  z.object({ kind: z.literal("included"), allowanceId: canonical, ...priceBase }).strict(),
  z.object({ kind: z.literal("free"), ...priceBase }).strict(),
  z.object({ kind: z.literal("metered"), unitPrices: z.array(z.object({ usageUnit: canonical, price: amount }).strict()).min(1).max(128), ...priceBase }).strict(),
  z.object({ kind: z.literal("unknown"), reason: text, ...priceBase }).strict(),
  z.object({ kind: z.literal("estimated"), estimationMethod: canonical, unitPrices: z.array(z.object({ usageUnit: canonical, price: amount }).strict()).min(1).max(128), ...priceBase }).strict(),
]);
const dataPolicyEvidence = z.object({ providerId: canonical, providerModelId: text, dataUse: z.enum(["not-used", "service-operation"]), trainingPosture: z.enum(["prohibited", "permitted"]), retention: z.object({ posture: z.enum(["zero", "bounded"]), days: z.number().int().min(0).max(3650) }).strict(), permittedMaximumClassification: z.enum(["public", "internal", "confidential", "restricted"]), permittedClassifications: z.array(z.enum(["public", "internal", "confidential", "restricted"])).min(1).max(4), sourceIdentity: canonical, sourceRevision: canonical, sourceDigest: digest, observedAt: instant, expiresAt: instant }).strict().superRefine((value, context) => { if ((value.retention.posture === "zero" && value.retention.days !== 0) || (value.retention.posture === "bounded" && value.retention.days === 0)) context.addIssue({ code: z.ZodIssueCode.custom, message: "retention posture and days conflict" }); });
const economics = z.object({ adapterCapabilityId: canonical, adapterCapabilityVersion: canonical, authBillingChannel: canonical, executionMode: canonical, serviceTier: canonical, rateCardBasis: canonical, envelopeSemantics: canonical, fallbackPosture: z.enum(["disabled", "committed"]), overagePosture: z.enum(["disabled", "committed"]), contextClass: canonical, cacheClass: canonical, priceEvidence, auxiliaryCharges: z.array(z.object({ id: canonical, amount }).strict()).max(128), executionEnvelope: z.object({ limits: z.array(amount).max(128) }).strict() }).strict();

export const ExecutionRouteCreationRequestSchema = z.object({
  requestId: canonical,
  expectedRevision: digest,
  discoveryIdentity: z.object({ providerId: canonical, providerRouteId: text, providerModelId: text }).strict(),
  material: z.object({ routeId: canonical, label: text, accountSelection: z.discriminatedUnion("mode", [z.object({ mode: z.literal("exact"), accountId: canonical }).strict(), z.object({ mode: z.literal("automatic"), accountPolicyId: canonical }).strict()]), dataClassification: z.enum(["public", "internal", "confidential", "restricted"]), dataPolicyEvidence, economics }).strict(),
}).strict();
export type ExecutionRouteCreationRequest = z.infer<typeof ExecutionRouteCreationRequestSchema>;

const resultBase = { type: z.literal("execution_route_create_result"), requestId: canonical, message: text };
const created = z.object({ ...resultBase, status: z.literal("created"), code: z.literal("EXECUTION_ROUTE_CREATED"), revision: digest, executionRouteCatalog: ExecutionRouteCatalogSchema, availableModels: AvailableModelCatalogSchema }).strict();
const committedRefreshFailed = z.object({ ...resultBase, status: z.literal("committed-refresh-failed"), code: z.literal("EXECUTION_ROUTE_COMMITTED_REFRESH_FAILED"), revision: digest }).strict();
const rejected = z.object({ ...resultBase, status: z.literal("rejected"), code: z.enum(["EXECUTION_ROUTE_CREATE_DENIED", "EXECUTION_ROUTE_CREATE_REJECTED"]) }).strict();

export const ExecutionRouteCreateResultSchema = z.discriminatedUnion("status", [created, committedRefreshFailed, rejected]);
export type ExecutionRouteCreateResult = z.infer<typeof ExecutionRouteCreateResultSchema>;

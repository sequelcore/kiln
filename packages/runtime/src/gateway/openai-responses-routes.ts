import { Hono } from "hono";
import { createHash } from "node:crypto";
import type { ModelGatewayRoute } from "@kilnai/core";
import {
  GovernedOneRoundCommittedError,
  GovernedOneRoundInvocationError,
  type GovernedOneRoundAffinityPolicy,
  type GovernedOneRoundBudgetEvidence,
  type GovernedOneRoundInvocationPorts,
  invokeGovernedOneRound,
} from "../model-gateway/governed-one-round-invocation.js";
import type {
  ModelGatewayReplayDecision,
  ModelGatewayReplayGuard,
} from "../model-gateway/replay-guard.js";
import {
  OpenAIResponsesProtocolError,
  encodeSseEvent,
  parseOpenAIResponsesRequest,
  type OpenAIResponsesRequest,
} from "./openai-responses-protocol.js";
import {
  OpenAIResponsesModelTurnError,
  inspectOpenAIResponsesModelTurnCapabilities,
  mapModelTurnResultToOpenAIResponsesEvents,
  mapOpenAIResponsesRequestToModelTurn,
  preflightOpenAIResponsesModelTurn,
  type OpenAIResponsesEventProjection,
  type OpenAIResponsesModelTurnCapability,
  type OpenAIResponsesModelTurnCapabilitySummary,
  type OpenAIResponsesProjectionOmission,
} from "./openai-responses-model-turn.js";

/** Raw JSON envelope cap; larger than the parser's aggregate string budget to allow JSON syntax overhead. */
export const OPENAI_RESPONSES_RAW_BODY_MAX_BYTES = 64 * 1024 * 1024;

export interface OpenAIResponsesTrustedPrincipal {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly callerId: string;
  readonly capabilityId: string;
  readonly scopes: readonly string[];
  readonly budgetEvidence: GovernedOneRoundBudgetEvidence;
}

export interface OpenAIResponsesResolvedVirtualModel {
  readonly route: ModelGatewayRoute;
  readonly capabilities: ReadonlySet<OpenAIResponsesModelTurnCapability>;
  readonly affinity:
    | { readonly continuity: "none" }
    | { readonly continuity: "prefer" | "require"; readonly scope: "session" | "turn"; readonly allowRebind?: boolean };
}

export interface OpenAIResponsesObservedCorrelation {
  readonly sessionId?: string;
  readonly threadId?: string;
  readonly turnId?: string;
  readonly rawBodyDigest: string;
}

export interface OpenAIResponsesCompatibilityEvidence {
  readonly stage: "request" | "response";
  readonly status: "compatible" | "degraded" | "rejected";
  readonly tenantId: string;
  readonly applicationId: string;
  readonly callerId: string;
  readonly requestedModel: string;
  readonly route: ModelGatewayRoute;
  readonly required: readonly OpenAIResponsesModelTurnCapability[];
  readonly optionalRequested: readonly OpenAIResponsesModelTurnCapability[];
  readonly unavailableOptional: readonly OpenAIResponsesModelTurnCapability[];
  readonly rejectedCapability?: OpenAIResponsesModelTurnCapability;
  readonly omissionCodes?: readonly OpenAIResponsesProjectionOmission["code"][];
}

export interface OpenAIResponsesIngressConfig {
  readonly authenticateBearer: (token: string) => Promise<OpenAIResponsesTrustedPrincipal | undefined>;
  readonly resolveVirtualModel: (input: { readonly principal: OpenAIResponsesTrustedPrincipal; readonly requestedModel: string }) => Promise<OpenAIResponsesResolvedVirtualModel | undefined>;
  readonly namespaceCorrelation: (input: { readonly principal: OpenAIResponsesTrustedPrincipal; readonly observed: OpenAIResponsesObservedCorrelation }) => Promise<{ readonly sessionId: string; readonly turnId: string }>;
  readonly compatibilityEvidence: { record(evidence: OpenAIResponsesCompatibilityEvidence): Promise<void> };
  readonly invocationPorts: GovernedOneRoundInvocationPorts;
  readonly createAttemptId: () => string;
  readonly createResponseId: () => string;
  /** Optional process-local protection; terminal TTL expiry or restart permits redispatch. */
  readonly replayGuard?: ModelGatewayReplayGuard;
  readonly maxBodyBytes?: number;
  readonly maxConcurrentRequests?: number;
}

class ResponsesIngressError extends Error {
  constructor(readonly status: number, readonly code: string, readonly safeMessage: string) { super(safeMessage); }
}

export function createOpenAIResponsesRoutes(config: OpenAIResponsesIngressConfig): Hono {
  const app = new Hono();
  const maxBodyBytes = resolveBodyLimit(config.maxBodyBytes);
  const concurrency = createConcurrencyLimiter(config.maxConcurrentRequests);
  app.post("/v1/responses", async (context) => {
    let executed = false;
    let replayDispatch: Extract<ModelGatewayReplayDecision, { kind: "dispatch" }> | undefined;
    let replayCommitAttempted = false;
    let releaseConcurrency: (() => void) | undefined;
    try {
      const token = requireBearer(context.req.header("authorization"));
      const principal = await config.authenticateBearer(token);
      if (principal === undefined) throw new ResponsesIngressError(401, "invalid_authentication", "Authentication failed.");
      validatePrincipal(principal);
      requireJsonContentType(context.req.header("content-type"));
      releaseConcurrency = concurrency.acquire();
      if (releaseConcurrency === undefined) throw new ResponsesIngressError(429, "ingress_overloaded", "The Responses ingress is at capacity.");
      const boundedBody = await readBoundedBody(context.req.raw, maxBodyBytes);
      const rawBody = boundedBody.text;
      let decoded: unknown;
      try { decoded = JSON.parse(rawBody); }
      catch { throw new ResponsesIngressError(400, "invalid_json", "The request body must contain valid JSON."); }
      const request = parseOpenAIResponsesRequest(decoded);
      const resolved = await config.resolveVirtualModel({ principal, requestedModel: request.model });
      if (resolved === undefined) throw new ResponsesIngressError(404, "model_not_found", "The requested model is unavailable.");

      const inspectedCapabilities = inspectOpenAIResponsesModelTurnCapabilities(request);
      let capabilities: OpenAIResponsesModelTurnCapabilitySummary;
      try {
        capabilities = preflightOpenAIResponsesModelTurn(request, resolved.capabilities);
      } catch (error) {
        if (error instanceof OpenAIResponsesModelTurnError) {
          await config.compatibilityEvidence.record({
            stage: "request", status: "rejected", tenantId: principal.tenantId, applicationId: principal.applicationId,
            callerId: principal.callerId, requestedModel: request.model, route: resolved.route,
            required: inspectedCapabilities.required,
            optionalRequested: inspectedCapabilities.optionalRequested,
            unavailableOptional: inspectedCapabilities.optionalRequested.filter((capability) => !resolved.capabilities.has(capability)),
            ...(error.capability === undefined ? {} : { rejectedCapability: error.capability }),
          });
        }
        throw error;
      }
      const turn = mapOpenAIResponsesRequestToModelTurn(request);
      const observed = readCorrelation(context.req.raw.headers, request, boundedBody.sha256);
      const namespaced = await config.namespaceCorrelation({ principal, observed });
      validateNamespacedCorrelation(namespaced, observed);
      const affinity = deriveAffinity(resolved.affinity, namespaced);
      await config.compatibilityEvidence.record({
        stage: "request", status: capabilities.unavailableOptional.length === 0 ? "compatible" : "degraded",
        tenantId: principal.tenantId, applicationId: principal.applicationId, callerId: principal.callerId,
        requestedModel: request.model, route: resolved.route, required: capabilities.required,
        optionalRequested: capabilities.optionalRequested, unavailableOptional: capabilities.unavailableOptional,
      });

      if (config.replayGuard !== undefined) {
        const key = config.replayGuard.fingerprint({
          rawBody,
          ingress: "openai-responses",
          tenantId: principal.tenantId,
          applicationId: principal.applicationId,
          callerId: principal.callerId,
          sessionId: namespaced.sessionId,
          turnId: namespaced.turnId,
          route: resolved.route,
          toolExecutionMode: "caller-owned",
          ...(affinity.continuity === "none" ? {} : { affinityKey: affinity.key }),
        });
        const decision = config.replayGuard.claim(key);
        if (decision.kind === "join-inflight") {
          const response = safeJson(409, "replay_in_progress", "An identical request is already in progress.");
          response.headers.set("retry-after", String(decision.retryAfterSeconds));
          return response;
        }
        if (decision.kind === "committed-unknown") {
          return safeJson(409, "committed_unknown", "The prior request may have committed and must not be dispatched again.");
        }
        if (decision.kind === "replay-completed") {
          return projectSuccessfulResponse(request.model, decision.value.responseId, decision.value.result, true);
        }
        replayDispatch = decision;
      }

      if (context.req.raw.signal.aborted) throw new GovernedOneRoundInvocationError("aborted", "Request aborted.");
      const responseId = requireServerId(config.createResponseId(), "responseId");
      const result = await invokeGovernedOneRound({
        attemptId: requireServerId(config.createAttemptId(), "attemptId"),
        identity: {
          tenantId: principal.tenantId,
          applicationId: principal.applicationId,
          callerId: principal.callerId,
          sessionId: namespaced.sessionId,
          turnId: namespaced.turnId,
        },
        route: resolved.route,
        authority: { status: "admitted", capabilityId: principal.capabilityId, scopes: principal.scopes },
        budget: principal.budgetEvidence,
        affinity,
        toolExecutionMode: "caller-owned",
        turn,
        signal: context.req.raw.signal,
        ...(replayDispatch === undefined ? {} : {
          lifecycle: { afterCommittedBeforeDispatch: () => {
            replayCommitAttempted = true;
            config.replayGuard!.markCommitted(replayDispatch!.key, replayDispatch!.fence);
          } },
        }),
      }, config.invocationPorts);
      executed = true;
      let events: OpenAIResponsesEventProjection;
      try {
        events = mapModelTurnResultToOpenAIResponsesEvents({ responseId, model: request.model, result: result.result });
      } catch {
        throw new ResponsesIngressError(409, "committed_projection_failure", "The committed response could not be represented and must not be retried automatically.");
      }
      if (replayDispatch !== undefined) {
        config.replayGuard!.complete(replayDispatch.key, replayDispatch.fence, { result: result.result, responseId });
      }
      const omissionCodes = events.omissions.map((omission) => omission.code);
      if (omissionCodes.length > 0) {
        try {
          await config.compatibilityEvidence.record({
            stage: "response",
            status: "degraded",
            tenantId: principal.tenantId,
            applicationId: principal.applicationId,
            callerId: principal.callerId,
            requestedModel: request.model,
            route: resolved.route,
            required: capabilities.required,
            optionalRequested: capabilities.optionalRequested,
            unavailableOptional: capabilities.unavailableOptional,
            omissionCodes,
          });
        } catch {
          // Provider effects are committed; response-stage evidence closeout cannot erase a valid response.
        }
      }
      return new Response(events.map(encodeSseEvent).join(""), {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          "x-content-type-options": "nosniff",
          "x-request-id": responseId,
          ...(omissionCodes.length === 0 ? {} : { "x-kiln-projection-omissions": omissionCodes.join(",") }),
        },
      });
    } catch (error) {
      if (replayDispatch !== undefined) {
        try {
          if (replayCommitAttempted) config.replayGuard!.settleUnknown(replayDispatch.key, replayDispatch.fence);
          else config.replayGuard!.abandon(replayDispatch.key, replayDispatch.fence);
        } catch { /* incompatible/stale transitions retain their existing conservative state */ }
      }
      if (executed) return safeJson(409, "committed_projection_failure", "The committed response could not be represented and must not be retried automatically.");
      return projectSafeError(error);
    } finally {
      releaseConcurrency?.();
    }
  });
  return app;
}

function deriveAffinity(
  configured: OpenAIResponsesResolvedVirtualModel["affinity"],
  correlation: { readonly sessionId: string; readonly turnId: string },
): GovernedOneRoundAffinityPolicy {
  if (configured.continuity === "none") return configured;
  return {
    continuity: configured.continuity,
    key: `openai-responses:${configured.scope}:${configured.scope === "session" ? correlation.sessionId : correlation.turnId}`,
    ...(configured.allowRebind === undefined ? {} : { allowRebind: configured.allowRebind }),
  };
}

function projectSuccessfulResponse(model: string, responseId: string, result: import("@kilnai/core").ModelTurnResult, replayed: boolean): Response {
  const events = mapModelTurnResultToOpenAIResponsesEvents({ responseId, model, result });
  const omissionCodes = events.omissions.map((omission) => omission.code);
  return new Response(events.map(encodeSseEvent).join(""), {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
      "x-request-id": responseId,
      ...(replayed ? { "x-kiln-replay": "cached" } : {}),
      ...(omissionCodes.length === 0 ? {} : { "x-kiln-projection-omissions": omissionCodes.join(",") }),
    },
  });
}

function requireBearer(header: string | undefined): string {
  if (header === undefined) throw new ResponsesIngressError(401, "invalid_authentication", "Authentication is required.");
  const match = /^Bearer ([^\s,]+)$/i.exec(header);
  if (!match?.[1]) throw new ResponsesIngressError(401, "invalid_authentication", "Authentication is required.");
  return match[1];
}

function requireJsonContentType(contentType: string | undefined): void {
  if (contentType === undefined || !/^application\/json(?:\s*;|$)/i.test(contentType)) throw new ResponsesIngressError(415, "unsupported_content_type", "Content-Type must be application/json.");
}

function resolveBodyLimit(configured: number | undefined): number {
  if (configured === undefined) return OPENAI_RESPONSES_RAW_BODY_MAX_BYTES;
  if (!Number.isSafeInteger(configured) || configured <= 0) throw new TypeError("maxBodyBytes must be a positive integer.");
  return Math.min(configured, OPENAI_RESPONSES_RAW_BODY_MAX_BYTES);
}

async function readBoundedBody(request: Request, maximum: number): Promise<{ readonly text: string; readonly sha256: string }> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new ResponsesIngressError(413, "request_too_large", "The request body exceeds the supported limit.");
  if (request.body === null) throw new ResponsesIngressError(400, "invalid_json", "The request body is required.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const hash = createHash("sha256");
  let decoded = ""; let total = 0;
  try {
    while (true) {
      if (request.signal.aborted) throw new GovernedOneRoundInvocationError("aborted", "Request aborted.");
      const read = await reader.read(); if (read.done) break; total += read.value.byteLength;
      if (total > maximum) { await reader.cancel(); throw new ResponsesIngressError(413, "request_too_large", "The request body exceeds the supported limit."); }
      hash.update(read.value);
      try { decoded += decoder.decode(read.value, { stream: true }); }
      catch { throw new ResponsesIngressError(400, "invalid_json", "The request body must be UTF-8 JSON."); }
    }
    try { decoded += decoder.decode(); }
    catch { throw new ResponsesIngressError(400, "invalid_json", "The request body must be UTF-8 JSON."); }
  } finally { reader.releaseLock(); }
  return { text: decoded, sha256: hash.digest("hex") };
}

function readCorrelation(headers: Headers, request: OpenAIResponsesRequest, rawBodyDigest: string): OpenAIResponsesObservedCorrelation {
  const metadata = request.client_metadata as Record<string, string> | undefined;
  const headerSession = optionalCorrelation(headers.get("session-id"), "session-id");
  const openCodeSession = optionalCorrelation(headers.get("x-session-id"), "x-session-id");
  const openCodeAffinity = optionalCorrelation(headers.get("x-session-affinity"), "x-session-affinity");
  const headerThread = optionalCorrelation(headers.get("thread-id"), "thread-id");
  const headerClientRequest = optionalCorrelation(headers.get("x-client-request-id"), "x-client-request-id");
  const metadataSession = optionalCorrelation(metadata?.session_id, "client_metadata.session_id");
  const metadataThread = optionalCorrelation(metadata?.thread_id, "client_metadata.thread_id");
  const metadataTurn = optionalCorrelation(metadata?.turn_id, "client_metadata.turn_id");
  const sessionId = consistentHint([headerSession, openCodeSession, openCodeAffinity, metadataSession], "session correlation hints contradict");
  const threadId = consistentHint([headerThread, headerClientRequest, metadataThread], "thread correlation hints contradict");
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(threadId === undefined ? {} : { threadId }),
    ...(metadataTurn === undefined ? {} : { turnId: metadataTurn }),
    rawBodyDigest,
  };
}

function optionalCorrelation(value: string | null | undefined, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value.length === 0 || value.length > 256 || !/^[A-Za-z0-9._:-]+$/.test(value)) throw new ResponsesIngressError(400, "invalid_correlation", `${field} is invalid.`);
  return value;
}

function consistentHint(values: readonly (string | undefined)[], message: string): string | undefined {
  const observed = values.filter((value): value is string => value !== undefined);
  if (new Set(observed).size > 1) throw new ResponsesIngressError(400, "correlation_conflict", message);
  return observed[0];
}

function validateNamespacedCorrelation(value: { readonly sessionId: string; readonly turnId: string }, observed: OpenAIResponsesObservedCorrelation): void {
  requireServerId(value.sessionId, "sessionId"); requireServerId(value.turnId, "turnId");
  const raw = new Set([observed.sessionId, observed.threadId, observed.turnId, observed.rawBodyDigest].filter(Boolean));
  if (raw.has(value.sessionId) || raw.has(value.turnId)) throw new ResponsesIngressError(500, "invalid_namespace", "Correlation namespace resolution failed.");
}

function validatePrincipal(principal: OpenAIResponsesTrustedPrincipal): void {
  requireServerId(principal.tenantId, "tenantId"); requireServerId(principal.applicationId, "applicationId");
  requireServerId(principal.callerId, "callerId"); requireServerId(principal.capabilityId, "capabilityId");
  requireServerId(principal.budgetEvidence.evidenceId, "budgetEvidenceId");
  if (!Array.isArray(principal.scopes)) throw new ResponsesIngressError(500, "invalid_principal", "Authentication evidence is invalid.");
  for (const scope of principal.scopes) requireServerId(scope, "scope");
  if (!principal.scopes.includes("model.invoke")) throw new ResponsesIngressError(403, "insufficient_scope", "The model.invoke scope is required.");
  if (principal.budgetEvidence.status !== "admitted") throw new ResponsesIngressError(403, "budget_denied", "The request budget was not admitted.");
}

function createConcurrencyLimiter(configured: number | undefined): { acquire(): (() => void) | undefined } {
  const maximum = configured ?? 2;
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > 1_024) {
    throw new TypeError("maxConcurrentRequests must be an integer between 1 and 1024.");
  }
  let active = 0;
  return {
    acquire() {
      if (active >= maximum) return undefined;
      active++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active--;
      };
    },
  };
}

function requireServerId(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || !/^[A-Za-z0-9._:-]+$/.test(value)) throw new ResponsesIngressError(500, "invalid_server_identity", `${field} generation failed.`);
  return value;
}

function projectSafeError(error: unknown): Response {
  if (error instanceof ResponsesIngressError) return safeJson(error.status, error.code, error.safeMessage, error.status === 401);
  if (error instanceof OpenAIResponsesProtocolError) return safeJson(400, "invalid_request", "The Responses request is invalid.");
  if (error instanceof OpenAIResponsesModelTurnError) return safeJson(422, "unsupported_request", "The requested Responses capability is unavailable.");
  if (error instanceof GovernedOneRoundCommittedError) return safeJson(409, "committed_failure", "The committed response could not be completed and must not be retried automatically.");
  if (error instanceof GovernedOneRoundInvocationError) {
    if (error.code === "aborted") return safeJson(499, "request_cancelled", "The request was cancelled.");
    if (error.code === "authority-denied" || error.code === "budget-denied" || error.code === "tool-execution-mode") return safeJson(403, "request_denied", "The request was not admitted.");
    if (error.code === "invalid-input") return safeJson(400, "invalid_request", "The admitted request is invalid.");
    return safeJson(503, "service_unavailable", "The model route is temporarily unavailable.");
  }
  if (error instanceof DOMException && error.name === "AbortError") return safeJson(499, "request_cancelled", "The request was cancelled.");
  return safeJson(503, "service_unavailable", "The model route is temporarily unavailable.");
}

function safeJson(status: number, code: string, message: string, authenticate = false): Response {
  return new Response(JSON.stringify({ error: { type: "invalid_request_error", code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...(authenticate ? { "www-authenticate": "Bearer" } : {}) },
  });
}

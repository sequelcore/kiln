import { createHash } from "node:crypto";
import type { ModelDeliberationCapabilities, ModelGatewayRoute } from "@kilnai/core";
import { Hono } from "hono";
import {
  GovernedOneRoundCommittedError,
  GovernedOneRoundInvocationError,
  type GovernedOneRoundAffinityPolicy,
  type GovernedOneRoundBudgetEvidence,
  type GovernedOneRoundInvocationPorts,
} from "./governed-one-round-invocation.js";
import { executeGovernedIngress, GovernedIngressCommittedExecutionError, type ModelGatewayCompatibilityEvidence } from "./governed-ingress-executor.js";
import type { ModelGatewayReplayGuard } from "./replay-guard.js";
import { claimModelGatewayRequestLifetime } from "./model-gateway-request-lifetime.js";
import { ANTHROPIC_MESSAGES_VERSION, AnthropicMessagesProtocolError, encodeAnthropicMessagesSseEvent, parseAnthropicMessagesRequest } from "./anthropic-messages-protocol.js";
import { AnthropicMessagesModelTurnError, inspectAnthropicMessagesCapabilities, mapAnthropicMessagesRequestToModelTurn, mapModelTurnResultToAnthropicMessagesEvents, type AnthropicMessagesModelTurnCapability } from "./anthropic-messages-model-turn.js";

export interface AnthropicMessagesTrustedPrincipal {
  readonly tenantId: string; readonly applicationId: string; readonly callerId: string; readonly capabilityId: string;
  readonly scopes: readonly string[]; readonly budgetEvidence: GovernedOneRoundBudgetEvidence;
}
export interface AnthropicMessagesResolvedVirtualModel {
  readonly route: ModelGatewayRoute;
  readonly capabilities: ReadonlySet<AnthropicMessagesModelTurnCapability>;
  readonly deliberation?: ModelDeliberationCapabilities;
  readonly affinity: { readonly continuity: "none" } | { readonly continuity: "prefer" | "require"; readonly scope: "session" | "turn"; readonly allowRebind?: boolean };
}
export interface AnthropicMessagesObservedCorrelation {
  readonly sessionId: string; readonly agentId?: string; readonly parentAgentId?: string; readonly rawBodyDigest: string;
}
export interface AnthropicMessagesIngressConfig {
  readonly authenticate: (token: string) => Promise<AnthropicMessagesTrustedPrincipal | undefined>;
  readonly resolveVirtualModel: (input: { readonly principal: AnthropicMessagesTrustedPrincipal; readonly requestedModel: string }) => Promise<AnthropicMessagesResolvedVirtualModel | undefined>;
  readonly listVirtualModels: (input: { readonly principal: AnthropicMessagesTrustedPrincipal }) => Promise<readonly { readonly id: string; readonly displayName?: string }[]>;
  readonly namespaceCorrelation: (input: { readonly principal: AnthropicMessagesTrustedPrincipal; readonly observed: AnthropicMessagesObservedCorrelation }) => Promise<{ readonly sessionId: string; readonly turnId: string }>;
  readonly compatibilityEvidence: { record(evidence: ModelGatewayCompatibilityEvidence): Promise<void> };
  readonly invocationPorts: GovernedOneRoundInvocationPorts;
  readonly createAttemptId: () => string; readonly createMessageId: () => string;
  readonly replayGuard?: ModelGatewayReplayGuard;
  readonly maxBodyBytes?: number; readonly maxConcurrentRequests?: number;
}

class MessagesIngressError extends Error {
  constructor(readonly status: number, readonly type: string, readonly safeMessage: string, readonly maxBodyBytes?: number) { super(safeMessage); }
}

export function createAnthropicMessagesRoutes(config: AnthropicMessagesIngressConfig): Hono {
  const app = new Hono();
  const maximum = resolvePositive(config.maxBodyBytes, 64 * 1024 * 1024, "maxBodyBytes");
  const concurrency = limiter(resolvePositive(config.maxConcurrentRequests, 2, "maxConcurrentRequests", 1024));
  app.get("/v1/models", async (context) => {
    try {
      const principal = await authenticate(context.req.raw.headers, config);
      if (context.req.query("limit") !== "1000") throw new MessagesIngressError(400, "invalid_request_error", "Model discovery requires limit=1000.");
      const models = (await config.listVirtualModels({ principal }))
        .filter((model) => /^(?:claude|anthropic)/.test(model.id))
        .map((model) => ({ id: model.id, ...(model.displayName === undefined ? {} : { display_name: model.displayName }) }));
      return json({ data: models });
    } catch (error) { return safeError(error); }
  });
  app.post("/v1/messages", async (context) => {
    let release: (() => void) | undefined;
    try {
      const principal = await authenticate(context.req.raw.headers, config);
      if (context.req.header("anthropic-version") !== ANTHROPIC_MESSAGES_VERSION) throw new MessagesIngressError(400, "invalid_request_error", `anthropic-version must be ${ANTHROPIC_MESSAGES_VERSION}.`);
      requireJson(context.req.header("content-type"));
      release = concurrency.acquire();
      if (!release) throw new MessagesIngressError(429, "rate_limit_error", "The Messages ingress is at capacity.");
      const bounded = await readBounded(context.req.raw, maximum);
      claimModelGatewayRequestLifetime(context.req.raw);
      let decoded: unknown;
      try { decoded = JSON.parse(bounded.text); } catch { throw new MessagesIngressError(400, "invalid_request_error", "The request body must contain valid JSON."); }
      const request = parseAnthropicMessagesRequest(decoded);
      const resolved = await config.resolveVirtualModel({ principal, requestedModel: request.model });
      if (!resolved) throw new MessagesIngressError(404, "not_found_error", "The requested model is unavailable.");
      const required = inspectAnthropicMessagesCapabilities(request);
      const missing = required.find((capability) => !resolved.capabilities.has(capability));
      if (missing) {
        await config.compatibilityEvidence.record({ protocol: "anthropic-messages", stage: "request", status: "rejected", tenantId: principal.tenantId, applicationId: principal.applicationId, callerId: principal.callerId, requestedModel: request.model, route: resolved.route, required, optionalRequested: [], unavailableOptional: [], rejectedCapability: missing });
        throw new MessagesIngressError(422, "invalid_request_error", "The requested Messages capability is unavailable.");
      }
      let turn: import("@kilnai/core").ModelTurn;
      try { turn = mapAnthropicMessagesRequestToModelTurn(request, resolved.deliberation); }
      catch (error) { if (error instanceof TypeError) throw new MessagesIngressError(400, "invalid_request_error", "The Messages request is invalid."); throw error; }
      const observed = correlation(context.req.raw.headers, bounded.sha256);
      const namespaced = await config.namespaceCorrelation({ principal, observed });
      validateNamespace(namespaced, observed);
      await config.compatibilityEvidence.record({ protocol: "anthropic-messages", stage: "request", status: "compatible", tenantId: principal.tenantId, applicationId: principal.applicationId, callerId: principal.callerId, requestedModel: request.model, route: resolved.route, required, optionalRequested: [], unavailableOptional: [] });
      const execution = await executeGovernedIngress({
        protocol: "anthropic-messages", rawBody: bounded.text,
        identity: { tenantId: principal.tenantId, applicationId: principal.applicationId, callerId: principal.callerId, sessionId: namespaced.sessionId, turnId: namespaced.turnId },
        route: resolved.route, affinity: deriveAffinity(resolved.affinity, namespaced), authority: { status: "admitted", capabilityId: principal.capabilityId, scopes: principal.scopes }, budget: principal.budgetEvidence,
        toolExecutionMode: "caller-owned", turn, signal: context.req.raw.signal,
        invocationPorts: config.invocationPorts, createAttemptId: config.createAttemptId, createResponseId: config.createMessageId, replayGuard: config.replayGuard,
        projectSuccess: ({ responseId, result, replayed }) => sse(responseId, request.model, result, replayed),
      });
      if (execution.kind === "join-inflight") { const response = errorResponse(409, "invalid_request_error", "An identical request is already in progress."); response.headers.set("retry-after", String(execution.retryAfterSeconds)); return response; }
      if (execution.kind === "committed-unknown") return errorResponse(409, "invalid_request_error", "committed_unknown: the prior request may have committed and must not be dispatched again.");
      return execution.value;
    } catch (error) {
      if (error instanceof GovernedIngressCommittedExecutionError) return errorResponse(409, "invalid_request_error", "committed_projection_failure: the committed response must not be retried automatically.");
      return safeError(error);
    } finally { release?.(); }
  });
  return app;
}

async function authenticate(headers: Headers, config: AnthropicMessagesIngressConfig): Promise<AnthropicMessagesTrustedPrincipal> {
  const authorization = headers.get("authorization");
  const bearer = authorization && /^Bearer ([^\s,]+)$/i.exec(authorization)?.[1];
  const apiKey = headers.get("x-api-key") || undefined;
  if (authorization && !bearer) throw new MessagesIngressError(401, "authentication_error", "Authentication failed.");
  if (bearer && apiKey && bearer !== apiKey) throw new MessagesIngressError(401, "authentication_error", "Authentication failed.");
  const token = bearer || apiKey;
  if (!token) throw new MessagesIngressError(401, "authentication_error", "Authentication is required.");
  const principal = await config.authenticate(token);
  if (!principal) throw new MessagesIngressError(401, "authentication_error", "Authentication failed.");
  validatePrincipal(principal);
  return principal;
}

function validatePrincipal(principal: AnthropicMessagesTrustedPrincipal): void {
  if (typeof principal !== "object" || principal === null || typeof principal.budgetEvidence !== "object" || principal.budgetEvidence === null) throw new MessagesIngressError(500, "api_error", "Authentication evidence is invalid.");
  for (const value of [principal.tenantId, principal.applicationId, principal.callerId, principal.capabilityId, principal.budgetEvidence.evidenceId]) if (typeof value !== "string" || value.length === 0 || value.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new MessagesIngressError(500, "api_error", "Authentication evidence is invalid.");
  if (!Array.isArray(principal.scopes) || principal.scopes.length === 0 || new Set(principal.scopes).size !== principal.scopes.length || principal.scopes.some((scope) => typeof scope !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(scope))) throw new MessagesIngressError(500, "api_error", "Authentication evidence is invalid.");
  if (!principal.scopes.includes("model.invoke") || principal.budgetEvidence.status !== "admitted") throw new MessagesIngressError(403, "permission_error", "The request was not admitted.");
}

function correlation(headers: Headers, rawBodyDigest: string): AnthropicMessagesObservedCorrelation {
  const sessionId = correlationHeader(headers, "x-claude-code-session-id", true)!;
  const agentId = correlationHeader(headers, "x-claude-code-agent-id", false);
  const parentAgentId = correlationHeader(headers, "x-claude-code-parent-agent-id", false);
  return { sessionId, ...(agentId ? { agentId } : {}), ...(parentAgentId ? { parentAgentId } : {}), rawBodyDigest };
}
function correlationHeader(headers: Headers, name: string, required: boolean): string | undefined {
  const value = headers.get(name) ?? undefined;
  if (!value) { if (required) throw new MessagesIngressError(400, "invalid_request_error", `${name} is required.`); return undefined; }
  if (value.length > 256 || !/^[A-Za-z0-9._:-]+$/.test(value)) throw new MessagesIngressError(400, "invalid_request_error", `${name} is invalid.`);
  return value;
}
function validateNamespace(value: { readonly sessionId: string; readonly turnId: string }, observed: AnthropicMessagesObservedCorrelation): void {
  if (![value.sessionId, value.turnId].every((id) => typeof id === "string" && id.length > 0 && id.length <= 256 && /^[A-Za-z0-9._:-]+$/.test(id))) throw new MessagesIngressError(500, "api_error", "Correlation namespace resolution failed.");
  if ([observed.sessionId, observed.agentId, observed.parentAgentId, observed.rawBodyDigest].includes(value.sessionId) || [observed.sessionId, observed.agentId, observed.parentAgentId, observed.rawBodyDigest].includes(value.turnId)) throw new MessagesIngressError(500, "api_error", "Correlation namespace resolution failed.");
}
function deriveAffinity(configured: AnthropicMessagesResolvedVirtualModel["affinity"], correlationValue: { readonly sessionId: string; readonly turnId: string }): GovernedOneRoundAffinityPolicy {
  if (configured.continuity === "none") return configured;
  return { continuity: configured.continuity, key: `anthropic-messages:${configured.scope}:${configured.scope === "session" ? correlationValue.sessionId : correlationValue.turnId}`, ...(configured.allowRebind === undefined ? {} : { allowRebind: configured.allowRebind }) };
}
async function readBounded(request: Request, maximum: number): Promise<{ readonly text: string; readonly sha256: string }> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new MessagesIngressError(413, "request_too_large", `The request body exceeds Kiln's configured ${maximum}-byte limit.`, maximum);
  if (request.body === null) throw new MessagesIngressError(400, "invalid_request_error", "The request body is required.");
  const reader = request.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true }); const hash = createHash("sha256");
  let text = ""; let total = 0;
  try {
    while (true) {
      if (request.signal.aborted) throw new GovernedOneRoundInvocationError("aborted", "Request aborted.");
      const read = await reader.read(); if (read.done) break;
      total += read.value.byteLength;
      if (total > maximum) { await reader.cancel(); throw new MessagesIngressError(413, "request_too_large", `The request body exceeds Kiln's configured ${maximum}-byte limit.`, maximum); }
      hash.update(read.value);
      try { text += decoder.decode(read.value, { stream: true }); } catch { throw new MessagesIngressError(400, "invalid_request_error", "The request body must be UTF-8 JSON."); }
    }
    try { text += decoder.decode(); } catch { throw new MessagesIngressError(400, "invalid_request_error", "The request body must be UTF-8 JSON."); }
  } finally { reader.releaseLock(); }
  return { text, sha256: hash.digest("hex") };
}
function sse(messageId: string, model: string, result: import("@kilnai/core").ModelTurnResult, replayed: boolean): Response {
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(messageId)) throw new TypeError("message id is invalid");
  return new Response(mapModelTurnResultToAnthropicMessagesEvents({ messageId, model, result }).map(encodeAnthropicMessagesSseEvent).join(""), { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-content-type-options": "nosniff", "request-id": messageId, ...(replayed ? { "x-kiln-replay": "cached" } : {}) } });
}
function requireJson(value: string | undefined): void { if (!value || !/^application\/json(?:\s*;|$)/i.test(value)) throw new MessagesIngressError(415, "invalid_request_error", "Content-Type must be application/json."); }
function resolvePositive(value: number | undefined, fallback: number, name: string, cap = 64 * 1024 * 1024): number { const selected = value ?? fallback; if (!Number.isSafeInteger(selected) || selected <= 0 || selected > cap) throw new TypeError(`${name} is invalid.`); return selected; }
function limiter(maximum: number) { let active = 0; return { acquire(): (() => void) | undefined { if (active >= maximum) return undefined; active++; let released = false; return () => { if (!released) { released = true; active--; } }; } }; }
function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
function errorResponse(status: number, type: string, message: string, maxBodyBytes?: number): Response { const response = json({ type: "error", error: { type, message, ...(maxBodyBytes === undefined ? {} : { max_body_bytes: maxBodyBytes }) } }, status); if (status === 401) response.headers.set("www-authenticate", "Bearer"); if (maxBodyBytes !== undefined) response.headers.set("x-kiln-request-body-limit-bytes", String(maxBodyBytes)); return response; }
function safeError(error: unknown): Response {
  if (error instanceof MessagesIngressError) return errorResponse(error.status, error.type, error.safeMessage, error.maxBodyBytes);
  if (error instanceof AnthropicMessagesProtocolError) return errorResponse(400, "invalid_request_error", "The Messages request is invalid.");
  if (error instanceof AnthropicMessagesModelTurnError) return errorResponse(422, "invalid_request_error", "The Messages response cannot be represented.");
  if (error instanceof GovernedOneRoundCommittedError) return errorResponse(409, "invalid_request_error", "committed_failure: the response must not be retried automatically.");
  if (error instanceof GovernedOneRoundInvocationError) return errorResponse(error.code === "aborted" ? 499 : 503, error.code === "aborted" ? "request_cancelled" : "api_error", error.code === "aborted" ? "The request was cancelled." : "The model route is temporarily unavailable.");
  return errorResponse(503, "api_error", "The model route is temporarily unavailable.");
}
